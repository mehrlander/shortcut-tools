#!/usr/bin/env python3
"""Read a device manifest and say which shortcuts the corpus is behind on.

    python3 tools/manifest-delta.py <manifest.txt>          # report + links
    python3 tools/manifest-delta.py <manifest.txt> --json    # machine output
    python3 tools/manifest-delta.py --latest                 # newest committed

`Sync-Manifest` commits the shape of the library (name, action count, last
modified) to `shortcuts/manifests/<stamp>.txt` in web-tools-private. This
reads one and compares it against the committed corpus, so catching up means
exporting the handful that moved rather than re-dumping 577 shortcuts.

**The manifest is marker text, not JSON, and that is deliberate.** It is the
exact template `Get-ShortcutsInfo` already proves works on the device, and a
shortcut named `Say "hi"` would break a JSON row built by string interpolation
in Shortcuts, where there is no escaping primitive. Parsing moves here, where
there is one.

**And it arrives column-major.** See `parse_manifest` for what the first real
run established, and why the manifest carries three fields rather than four.

Three signals, and only the first two are exact:

    added     in the manifest, absent from index.json
    removed   in index.json, absent from the manifest
    changed   action count differs, or lastModified postdates the corpus

The count comparison is exact. The date comparison inherits whatever
`Last Modified Date` means on the device, which is a file modification date and
so should track edits and not runs. That is an expectation, not a measurement;
two manifests taken either side of a run settle it. Until then a pure parameter
edit that leaves the action count alone is caught only if the date moves.

The corpus cutoff is read from index.json's `from` fields rather than passed in,
so the answer cannot drift from the dump it is about. `--since` overrides it.
"""

import argparse
import json
import os
import re
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Measured over the committed corpus: 71,143,254 bytes of plist across 29,713
# actions. Used only to chunk the dump links, so it wants to be roughly right,
# not exact. A link that asks for more than the API will take fails at the far
# end, where the user is holding the phone.
BYTES_PER_ACTION = 2394
CHUNK_BYTES = 600_000


def find_private(arg):
    """Same resolution order as tools/freshness.py, deliberately."""
    for cand in (arg, os.environ.get("WEB_TOOLS_PRIVATE"), ROOT.parent / "web-tools-private"):
        if cand and (Path(cand) / "shortcuts" / "index.json").exists():
            return Path(cand)
    return None


class ManifestError(Exception):
    """The file parsed, but its columns cannot be trusted to line up."""


def parse_manifest(text):
    """Column-major marker text to records.

    **Measured on the first device run, 2026-08-18, and it settled two open
    questions at once.**

    The Text action evaluates its template ONCE and expands each attachment
    into a newline-joined column, so the file is one `==marker==` followed by
    every value for that field, then the next marker. It is not one record per
    shortcut, which is what the design assumed and what a row-major reading
    would need. Both readings this parser was originally written to accept were
    wrong in the same direction, so the tolerance bought nothing: the real shape
    was a third one.

    Worse, and this is the part no amount of care here would have caught:
    **Shortcuts drops an empty value when it joins a list into text**, rather
    than emitting a blank line. The first run returned 633 names and 578
    folders, because 55 shortcuts sit in no folder, and nothing in the file says
    which 55. A column holding any empty value therefore cannot be aligned with
    its siblings by position, and a silent mis-zip would report edits to
    shortcuts nobody touched.

    So the manifest carries the three fields that cannot be empty (a shortcut
    always has a name, an action count is always a number, a modification date
    always exists) and `folder` was removed from the template. A manifest
    written before that change still parses: `folder` is read when it happens to
    align and dropped when it does not, since nothing downstream uses it.

    The equal-length check on the three required columns is not defensive
    boilerplate. It is the only thing standing between a future empty value and
    a delta report that looks plausible and is wrong throughout.
    """
    blocks = {}
    for key, body in zip(*[re.split(r"^==(name|folder|actions|lastModified)==$",
                                    text, flags=re.M)[i::2] for i in (1, 2)]):
        blocks[key] = [ln for ln in body.split("\n") if ln.strip()]

    required = ("name", "actions", "lastModified")
    missing = [k for k in required if k not in blocks]
    if missing:
        raise ManifestError("no %s column; is this a manifest?" % ", ".join(missing))

    sizes = {k: len(blocks[k]) for k in required}
    if len(set(sizes.values())) != 1:
        raise ManifestError(
            "columns disagree (%s). Shortcuts drops empty values when joining, "
            "so a column with a blank in it cannot be aligned by position; this "
            "manifest cannot be read safely."
            % ", ".join("%s=%d" % kv for kv in sorted(sizes.items())))

    n = sizes["name"]
    folder = blocks.get("folder") if len(blocks.get("folder", [])) == n else None

    rows = []
    for i in range(n):
        try:
            actions = int(blocks["actions"][i].strip())
        except ValueError:
            actions = 0
        rows.append({"name": blocks["name"][i].strip(),
                     "folder": folder[i].strip() if folder else "",
                     "actions": actions,
                     "lastModified": blocks["lastModified"][i].strip()})
    return rows


def corpus_cutoff(index):
    """The newest dump date named in index.json, as a date string."""
    stamps = sorted(r["from"][:10] for r in index if r.get("from"))
    return stamps[-1] if stamps else None


def newer_than(iso, cutoff):
    """Is this ISO 8601 stamp after the cutoff date? Unparseable reads as no."""
    if not iso or not cutoff:
        return False
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.date().isoformat() > cutoff


def resolve_names(have, live):
    """Map a corpus name onto the device name it actually is.

    **A dump stores `/` as `:` in an entry name**, the macOS filename swap, and
    `index.json` is built from those entry names. So `Unzip/Re-zip` on the
    device is `Unzip:Re-zip` in the corpus, and a naive comparison reports it as
    one deletion plus one addition: a phantom pair that would cost a needless
    export and hide a real change in the noise. Two of the three apparent
    deletions in the first real run were this.

    The rewrite is deliberately narrow rather than a blanket substitution, since
    a colon can be a real character in a name: `REF: Edit iCloud JSON` exists and
    has no slash form. A corpus name is rewritten only when its plain form is
    absent from the device AND its slash form is present, so the pairing is
    evidence-driven in both directions.
    """
    fixed = {}
    for name, rec in have.items():
        alt = name.replace(":", "/")
        fixed[alt if (name not in live and alt in live) else name] = rec
    return fixed


def unusable(rec):
    """A corpus record that cannot answer 'has this changed?'.

    index-dump records a plist it could not parse as `error` with no action
    count. One such record exists (`Get-YamlFromDictionary`, invalid token).
    Comparing against it would print `actions None to 29`, which reads as a
    change of unknown size rather than as what it is: the corpus never got a
    usable copy, so the shortcut wants re-exporting whatever its date says.
    """
    return rec.get("error") or rec.get("actions") is None


def delta(rows, index, cutoff):
    live = {r["name"]: r for r in rows}
    have = resolve_names({r["name"]: r for r in index}, live)
    added = [n for n in live if n not in have]
    removed = [n for n in have if n not in live]
    changed = []
    for name, r in live.items():
        if name in added:
            continue
        why = []
        if unusable(have[name]):
            why.append("corpus copy unreadable (%s)"
                       % ("parse error" if have[name].get("error") else "no action count"))
        elif r["actions"] != have[name]["actions"]:
            why.append("actions %s to %s" % (have[name]["actions"], r["actions"]))
        if newer_than(r.get("lastModified"), cutoff):
            why.append("modified " + r["lastModified"][:10])
        if why:
            changed.append((name, ", ".join(why)))
    return sorted(added), sorted(removed), sorted(changed)


def repo_owned():
    """Names this repo can already reproduce, so the device is never asked.

    A receiver whose plist is committed here is rebuildable from git, which is
    the same reasoning CLAUDE.md uses to make deleting one before an import
    free. Asking the device to export it back would spend a tap to fetch a copy
    of something the repo authored, and the first real delta wanted eight of
    them, including the two chains that were being installed at the time.
    """
    return {p.stem for p in (ROOT / "plists").glob("*.plist")}


def links(names, sizes):
    """Dump-Named links, chunked so no single tap asks for too much.

    Chunking is by estimated payload, not by count: one 400-action shortcut is
    a bigger ask than thirty small ones, and a count-based split would send the
    first anyway.
    """
    out, batch, total = [], [], 0
    for n in names:
        est = (sizes.get(n) or 20) * BYTES_PER_ACTION
        if batch and total + est > CHUNK_BYTES:
            out.append(batch)
            batch, total = [], 0
        batch.append(n)
        total += est
    if batch:
        out.append(batch)
    return ["shortcuts://run-shortcut?name=Dump-Named&input=text&text=%s"
            % urllib.parse.quote("".join("⟦%s⟧" % n for n in b), safe="")
            for b in out]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", nargs="?", help="a manifest .txt; omit with --latest")
    ap.add_argument("--latest", action="store_true",
                    help="use the newest file in shortcuts/manifests/")
    ap.add_argument("--private", help="path to a web-tools-private checkout")
    ap.add_argument("--since", help="override the corpus cutoff date (YYYY-MM-DD)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    private = find_private(args.private)
    if not private:
        print("no web-tools-private checkout (looked at --private, "
              "$WEB_TOOLS_PRIVATE, ../web-tools-private)", file=sys.stderr)
        return 2

    if args.latest:
        found = sorted((private / "shortcuts" / "manifests").glob("*.txt"))
        if not found:
            print("no manifests yet; run Sync-Manifest on the device", file=sys.stderr)
            return 2
        path = found[-1]
    elif args.manifest:
        path = Path(args.manifest)
    else:
        ap.error("give a manifest path or --latest")

    index = json.loads((private / "shortcuts" / "index.json").read_text())
    try:
        rows = parse_manifest(path.read_text())
    except ManifestError as e:
        print("%s: %s" % (path.name, e), file=sys.stderr)
        return 1
    if not rows:
        print("%s parsed to zero rows; is it a manifest?" % path, file=sys.stderr)
        return 1

    cutoff = args.since or corpus_cutoff(index)
    added, removed, changed = delta(rows, index, cutoff)
    sizes = {r["name"]: r["actions"] for r in rows}
    owned = repo_owned()
    want = [n for n in added + [n for n, _ in changed] if n not in owned]
    skipped = sorted(set(added + [n for n, _ in changed]) & owned)
    urls = links(want, sizes)

    if args.json:
        print(json.dumps({"manifest": path.name, "cutoff": cutoff,
                          "device": len(rows), "corpus": len(index),
                          "added": added, "removed": removed,
                          "changed": [{"name": n, "why": w} for n, w in changed],
                          "repo_owned": skipped, "links": urls}, indent=2))
        return 0

    print("%s: %d on device, %d in corpus (cutoff %s)"
          % (path.name, len(rows), len(index), cutoff))
    for label, items in (("added", added), ("removed", removed)):
        if items:
            print("\n%s (%d):" % (label, len(items)))
            for n in items:
                print("  " + n)
    if changed:
        print("\nchanged (%d):" % len(changed))
        for n, w in changed:
            print("  %-40s %s" % (n, w))
    if not (added or removed or changed):
        print("\nthe corpus is current with the device")
        return 0
    if skipped:
        print("\n%d already reproducible from plists/, not requested: %s"
              % (len(skipped), ", ".join(skipped)))
    if want:
        est = sum((sizes.get(n) or 20) for n in want) * BYTES_PER_ACTION
        print("\n%d to export, roughly %d KB, %d link(s):" % (len(want), est // 1024, len(urls)))
        for u in urls:
            print("\n  " + u)
    if removed:
        print("\n%d removed; nothing to fetch, but the next dump should drop them."
              % len(removed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
