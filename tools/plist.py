#!/usr/bin/env python3
"""Turn a chain file into a complete workflow plist, ready to sign and import.

    python3 tools/plist.py workflows/<chain>.json        # one, to plists/
    python3 tools/plist.py --publish                     # every chain
    python3 tools/plist.py --check                       # fail if plists/ is behind

`pack.py` emits **actions to paste**; this emits **a shortcut to install**. The
difference is not convenience. `WFWorkflowTypes` and
`WFWorkflowInputContentItemClasses` live in the workflow file and nothing on the
clipboard reaches them, so Show in Share Sheet, the accepted input classes, and
the Apple Watch flag can only arrive this way. Confirmed on device 2026-08-15 by
importing `Capture-Link` with its share sheet already configured.

The envelope is copied from a real export rather than invented, `4711` and `900`
being what this device's Shortcuts writes.

**Two fields are derived, not authored.** `WFWorkflowHasShortcutInputVariables`
is true when any action references `ExtensionInput`, because a chain that reads
Shortcut Input and a file that says it does not is the mismatch that makes an
imported shortcut look broken for no visible reason. Everything else comes from
an optional `"workflow"` block in the chain file, which is how `capture-link`
asks for the share sheet.
"""
import argparse, json, plistlib, sys, urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pack import resolve, build_id   # one resolver, shared: see build()

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "plists"
RAW = "https://raw.githubusercontent.com/mehrlander/shortcut-tools"
IMPORT_TARGET = "Library-Import"
# `Library-Replace` deletes by name, then imports. Reach for it only where no
# one is present to answer Apple's import sheet, which otherwise offers to save
# over a name that already exists: --link defaults to Library-Import because
# that is the route a person actually taps, and because a link naming a
# receiver the device lacks fails at the point of use with nothing installed.
REPLACE_TARGET = "Library-Replace"
# Signed here, fetched there: Library-Fetch takes the same two-line payload
# and just names the bytes and opens them, so no device ever calls the worker.
FETCH_TARGET = "Library-Fetch"
SIGNED = ROOT / "signed"

# Observed on a 2026 export. Not guessed: an envelope that disagrees with the
# client is the failure that presents as "the import sheet appeared and nothing
# happened".
ENVELOPE = {
    "WFQuickActionSurfaces": [],
    "WFWorkflowClientVersion": "4711",
    "WFWorkflowHasOutputFallback": False,
    "WFWorkflowIcon": {"WFWorkflowIconGlyphNumber": 61440,
                       "WFWorkflowIconStartColor": -314141441},
    "WFWorkflowImportQuestions": [],
    "WFWorkflowInputContentItemClasses": [],
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowTypes": [],
}


def shortcut_name(chain, path):
    """The name to install under, declared rather than derived.

    Deriving it from the label collided: 27 chains produced 24 files, three
    silently overwriting each other. Most chains are probes and demos meant to
    be pasted, not shortcuts meant to be installed, so a chain opts in by
    declaring `"name"`. `plists/` then holds receivers and nothing else.
    """
    return chain.get("name")


def uses_shortcut_input(actions):
    def walk(o):
        if isinstance(o, dict):
            if o.get("Type") == "ExtensionInput":
                return True
            return any(walk(v) for v in o.values())
        if isinstance(o, list):
            return any(walk(v) for v in o)
        return False
    return walk(actions)


def build(chain, path):
    """The chain as a workflow plist, with every {"$file": path} already read in.

    The resolver is imported from `pack` rather than reimplemented. It was
    missing here entirely until 2026-08-29, and the failure it caused is the
    argument for sharing it: `pack.py` resolved the directive and this did not,
    so a chain carrying a page packed correctly and installed as a shortcut whose
    Text action held the literal dictionary {"$file": "pages/..."}. Nothing
    errored. Probe-InlineBench imported, ran, and returned an empty string, which
    was read as evidence about the rich-text coercion for a day. Two mirrors of
    one chain set have to resolve it the same way or the cheaper one lies.
    """
    stamp = build_id(chain)
    wf = dict(ENVELOPE)
    wf["WFWorkflowActions"] = [
        {"WFWorkflowActionIdentifier": a["id"],
         "WFWorkflowActionParameters": resolve(a["p"], stamp)}
        for a in chain["actions"]]
    wf["WFWorkflowHasShortcutInputVariables"] = uses_shortcut_input(chain["actions"])
    wf.update(chain.get("workflow", {}))
    return wf


def render(path):
    chain = json.loads(Path(path).read_text())
    return shortcut_name(chain, path), plistlib.dumps(build(chain, path), fmt=plistlib.FMT_XML)


def chains(src=None):
    """Only the chains that declare a name: the installable receivers.

    `src` exists for the tests. Probing the duplicate-name failure means having
    two chains that claim one name, and writing those into the real workflows/
    made them briefly visible to every other test globbing that directory,
    which is a race that passes until the day it does not.
    """
    out = []
    for c in sorted((src or ROOT / "workflows").glob("*.json")):
        if json.loads(c.read_text()).get("name"):
            out.append(c)
    return out


def shown(path):
    """A path as the reader will type it: repo-relative where it is in the repo.

    `relative_to` raises rather than falling back, so an --out directory outside
    the tree turned a stale-or-orphan report into a traceback. The message is
    for a person, and an absolute path serves that fine.
    """
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def publish(check=False, src=None, out=None):
    """Render everything, then write. Never the other way round.

    A one-pass loop wrote each plist as it rendered, so a duplicate name was
    caught only after the first claimant had already landed on disk: the
    publish failed, and left behind a file no chain would ever regenerate.
    One did, and sat in plists/ across two pull requests failing the
    receivers-only check. Resolving every name before writing any file is the
    difference between a publish that fails and a publish that fails dirty.

    THE MIRROR IS THE CHAIN SET, WHICH MEANS DELETING TOO. A chain that is
    removed, renamed, or gives up its `name` leaves a plist behind that no
    chain regenerates and nothing here used to notice: the loop above only ever
    asked whether each chain's own file was current. So a withdrawn receiver
    kept serving an install link that worked and delivered something the repo
    had already retracted, which is the failure a stale plist is guarded
    against, arriving by the other door. Publishing now removes what no chain
    claims and --check reports it, so this agrees with the receivers-only test
    rather than passing a tree that test fails.

    PRUNE ONLY WHERE THE DESTINATION BELONGS TO THE SOURCE SET. `--workflows`
    alone aims a foreign set of chains at the real plists/, which is exactly
    what the duplicate-name probe does; deleting every unclaimed file there
    would take the whole receiver mirror with it. Passing both, or neither, is
    a matched pair and safe to prune.

    AND A MANIFEST, BECAUSE A BUILD ID ANSWERS NOTHING ALONE. A chain stamps
    its own id and a run logs it, which says WHICH copy ran and not whether
    that copy is the current one. Answering the second took a checkout and a
    hand-run hash on 2026-08-29, which is the rework the stamp exists to
    prevent. `builds.json` publishes name -> id for the installable set, so a
    reader with no checkout compares the two directly. It is a `.json` beside
    a `*.plist` glob, so the prune above does not see it; --check holds it to
    the chains like everything else here.
    """
    dest = out or OUT
    paired = (src is None) == (out is None)
    dest.mkdir(parents=True, exist_ok=True)
    stale, seen, pending, builds = [], {}, [], {}
    for c in chains(src):
        name, data = render(c)
        if name in seen:
            raise SystemExit("two chains both name themselves %r: %s and %s"
                             % (name, seen[name], c.name))
        seen[name] = c.name
        builds[name] = build_id(json.loads(c.read_text()))
        pending.append((dest / (name + ".plist"), data))
    # Whole-set, so it answers to the same pairing rule as the prune below: an
    # unpaired --workflows aims a foreign chain set at the real plists/, and
    # writing this from that set would replace the real manifest with the
    # probe's two rows. The suite caught exactly that.
    manifest = dest / "builds.json" if paired else None
    want = json.dumps(builds, indent=1, sort_keys=True) + "\n"
    orphans = sorted(p for p in dest.glob("*.plist")
                     if paired and p not in {t for t, _ in pending})
    for target, data in pending:
        if check:
            if not target.exists() or target.read_bytes() != data:
                stale.append(shown(target))
        else:
            target.write_bytes(data)
    if check:
        if manifest and (not manifest.exists() or manifest.read_text() != want):
            stale.append(shown(manifest))
        bad = stale + ["%s (no chain claims it)" % shown(p) for p in orphans]
        if bad:
            raise SystemExit("stale, run `python3 tools/plist.py --publish`:\n  "
                             + "\n  ".join(bad))
        print("plists/ is current (%d)" % len(pending), file=sys.stderr)
        return
    if manifest:
        manifest.write_text(want)
    for p in orphans:
        p.unlink()
    print("wrote %d plists to plists/%s" % (
        len(pending), ", removed %d unclaimed" % len(orphans) if orphans else ""),
        file=sys.stderr)


def link(chain_path, ref, target=IMPORT_TARGET):
    """The tappable install link, emitted rather than assembled by hand.

    `Library-Import` splits Shortcut Input on newlines and reads two lines: the
    name to install under, then the plist to fetch. That form was recorded in
    the README and in the device log, and nowhere emitted, so it was retyped on
    every install. This is the same fix `pack.py --url` already made for the
    paste route: a generated link is one the sender did not type, and a wrong
    character 404s instead of quietly installing the wrong thing.
    """
    chain = json.loads(Path(chain_path).read_text())
    name = shortcut_name(chain, chain_path)
    if not name:
        raise SystemExit("%s declares no name, so there is nothing to install"
                         % Path(chain_path).name)
    if target == FETCH_TARGET:
        if not (SIGNED / (name + ".shortcut")).is_file():
            raise SystemExit("no signed/%s.shortcut yet; run --write-signed first" % name)
    elif not (OUT / (name + ".plist")).is_file():
        raise SystemExit("no plists/%s.plist yet; run --publish first" % name)
    where = "signed/%s.shortcut" if target == FETCH_TARGET else "plists/%s.plist"
    payload = "%s\n%s/%s/%s" % (name, RAW, ref, where % urllib.parse.quote(name))
    return "shortcuts://run-shortcut?name=%s&input=text&text=%s" % (
        target, urllib.parse.quote(payload, safe=""))


SIGNER = "http://shortcuts.gluebyte.workers.dev/"


def sign_bytes(chain_path, tries=4):
    """POST the built plist to the signing worker; True when a shortcut comes back.

    The worker signs by calling Apple's iCloud service, and when that call fails
    it answers **HTTP 200 with a plain-text body**, not an error status. On device
    that lands in Extract as "Unrecognized archive format", which reads like a
    problem with the file and is not one: measured 2026-08-30, the same plist
    that failed signed on all three immediate retries.

    So the retry belongs here rather than on the reader's thumb. Run this before
    handing over an install link; a tap spent on an outage is a tap wasted.
    """
    import gzip, subprocess, tempfile
    name, data = render(chain_path)
    body = gzip.compress(data)
    with tempfile.NamedTemporaryFile(suffix=".gz") as f:
        f.write(body); f.flush()
        for attempt in range(1, tries + 1):
            # curl rather than urllib: this sandbox reaches the network through
            # a proxy curl is configured for and urllib is not, which shows up
            # as a 403 that has nothing to do with the worker.
            got = subprocess.run(
                ["curl", "-sS", "-X", "POST", "-H", "Content-Type: application/gzip",
                 "--data-binary", "@" + f.name, SIGNER],
                capture_output=True, timeout=60).stdout
            # A signed reply is gzip; anything else is the worker talking.
            if got[:2] == b"\x1f\x8b":
                print("%s: signs (%d bytes, attempt %d)" % (name, len(got), attempt),
                      file=sys.stderr)
                import io
                return name, data, gzip.GzipFile(fileobj=io.BytesIO(got)).read()
            print("%s: attempt %d refused: %s"
                  % (name, attempt,
                     got.decode("utf-8", "replace").strip().replace("\n", " ")),
                  file=sys.stderr)
    return None


def write_signed(chain_path):
    """Sign here and keep the result, with the provenance that makes it checkable.

    The signed file is NOT byte-deterministic: the worker stamps a fresh inner
    name every call, so this cannot join packed/ and plists/ under --check. What
    can be checked is where it came from, so the manifest records the sha256 of
    the plist each one was signed from. A signed file whose recorded hash no
    longer matches its plist is stale, and stale here means an install link that
    works and delivers the wrong shortcut.
    """
    import hashlib, json as _json, datetime
    got = sign_bytes(chain_path)
    if not got:
        return None
    name, plist_bytes, signed = got
    SIGNED.mkdir(exist_ok=True)
    (SIGNED / (name + ".shortcut")).write_bytes(signed)
    man_path = SIGNED / "manifest.json"
    man = _json.loads(man_path.read_text()) if man_path.is_file() else {}
    man[name] = {"plist_sha256": hashlib.sha256(plist_bytes).hexdigest(),
                 "bytes": len(signed),
                 "signed": datetime.date.today().isoformat()}
    man_path.write_text(_json.dumps(dict(sorted(man.items())), indent=1) + "\n")
    print("wrote signed/%s.shortcut (%d bytes)" % (name, len(signed)), file=sys.stderr)
    # A write git will not carry is a silent miss: the commit succeeds, the push
    # succeeds, and the install link 404s. Ask git rather than assuming.
    import subprocess
    if subprocess.run(["git", "check-ignore", "-q", str(SIGNED / (name + ".shortcut"))],
                      cwd=ROOT).returncode == 0:
        print("  WARNING: git ignores that path, so it will not be committed",
              file=sys.stderr)
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("chain", nargs="?")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--workflows", help="read chains from here instead of workflows/")
    ap.add_argument("--out", help="write plists here instead of plists/; pair it with "
                                  "--workflows, since only a matched pair is pruned")
    ap.add_argument("--link", action="store_true", help="emit the Library-Import link")
    ap.add_argument("--ref", default="main", help="the ref --link points at")
    ap.add_argument("--replace", action="store_true",
                    help="--link through Library-Replace: delete by name, then import")
    ap.add_argument("--sign", action="store_true",
                    help="pre-flight: check the worker will sign it, retrying an outage")
    ap.add_argument("--write-signed", action="store_true",
                    help="sign here and write signed/<Name>.shortcut, so no device signs")
    ap.add_argument("--fetch", action="store_true",
                    help="--link through Library-Fetch, which installs an already-signed file")
    args = ap.parse_args()
    if args.write_signed:
        if not args.chain:
            raise SystemExit("give a chain to sign")
        raise SystemExit(0 if write_signed(args.chain) else 1)
    if args.sign:
        if not args.chain:
            raise SystemExit("give a chain to sign-check")
        raise SystemExit(0 if sign_bytes(args.chain) else 1)
    if args.link:
        if not args.chain:
            raise SystemExit("give a chain to link")
        target = (FETCH_TARGET if args.fetch else
                  REPLACE_TARGET if args.replace else IMPORT_TARGET)
        print(link(args.chain, args.ref, target))
        return
    if args.publish or args.check:
        return publish(args.check,
                       Path(args.workflows) if args.workflows else None,
                       Path(args.out) if args.out else None)
    if not args.chain:
        raise SystemExit("give a chain, or --publish")
    name, data = render(args.chain)
    OUT.mkdir(exist_ok=True)
    (OUT / (name + ".plist")).write_bytes(data)
    print("wrote plists/%s.plist (%d bytes)" % (name, len(data)), file=sys.stderr)


if __name__ == "__main__":
    main()
