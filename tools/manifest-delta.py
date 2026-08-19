#!/usr/bin/env python3
"""Read a device manifest and say which shortcuts the corpus is behind on.

    python3 tools/manifest-delta.py <manifest.txt>          # report + links
    python3 tools/manifest-delta.py <manifest.txt> --json    # machine output
    python3 tools/manifest-delta.py --latest                 # newest committed

`Sync-Manifest` commits the shape of the library (name, folder, action count,
last modified) to `shortcuts/manifests/<stamp>.txt` in web-tools-private. This
reads one and compares it against the committed corpus, so catching up means
exporting the handful that moved rather than re-dumping 577 shortcuts.

**The manifest is marker text, not JSON, and that is deliberate.** It is the
exact template `Get-ShortcutsInfo` already proves works on the device, and a
shortcut named `Say "hi"` would break a JSON row built by string interpolation
in Shortcuts, where there is no escaping primitive. Parsing moves here, where
there is one.

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


def parse_manifest(text):
    """Marker text to records. Tolerant of how the device joined the rows.

    A Text action fed a list may emit one string per item or one concatenated
    string, and which one is not worth depending on: splitting on the leading
    marker reads both the same way. Rows are returned in device order.
    """
    rows = []
    for chunk in text.split("==name==")[1:]:
        rec = {}
        parts = re.split(r"==(folder|actions|lastModified)==", chunk)
        rec["name"] = parts[0].strip()
        for key, val in zip(parts[1::2], parts[2::2]):
            rec[key] = val.strip()
        if not rec["name"]:
            continue
        try:
            rec["actions"] = int(rec.get("actions") or 0)
        except ValueError:
            rec["actions"] = 0
        rows.append(rec)
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


def delta(rows, index, cutoff):
    have = {r["name"]: r for r in index}
    live = {r["name"]: r for r in rows}
    added = [n for n in live if n not in have]
    removed = [n for n in have if n not in live]
    changed = []
    for name, r in live.items():
        if name in added:
            continue
        why = []
        if r["actions"] != (have[name].get("actions") or 0):
            why.append("actions %s to %s" % (have[name].get("actions"), r["actions"]))
        if newer_than(r.get("lastModified"), cutoff):
            why.append("modified " + r["lastModified"][:10])
        if why:
            changed.append((name, ", ".join(why)))
    return sorted(added), sorted(removed), sorted(changed)


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
    rows = parse_manifest(path.read_text())
    if not rows:
        print("%s parsed to zero rows; is it a manifest?" % path, file=sys.stderr)
        return 1

    cutoff = args.since or corpus_cutoff(index)
    added, removed, changed = delta(rows, index, cutoff)
    sizes = {r["name"]: r["actions"] for r in rows}
    want = added + [n for n, _ in changed]
    urls = links(want, sizes)

    if args.json:
        print(json.dumps({"manifest": path.name, "cutoff": cutoff,
                          "device": len(rows), "corpus": len(index),
                          "added": added, "removed": removed,
                          "changed": [{"name": n, "why": w} for n, w in changed],
                          "links": urls}, indent=2))
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
