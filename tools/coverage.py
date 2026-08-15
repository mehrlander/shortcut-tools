#!/usr/bin/env python3
"""Report what a corpus uses that the action dictionary does not know.

    python3 tools/coverage.py <dump.zip> [<dump.zip> ...] [--bundles] [--json OUT]

`actions.json` is a **curated** dictionary, not a census, and the difference
matters every time a session asks "does an action exist for X". Measured
2026-08-15 against 577 shortcuts: 312 distinct identifiers in use, 56 of them
absent from the dictionary, an 18% gap.

**And the corpus is not a census either.** `com.apple.shortcuts.CreateFolderAction`
is in neither, because nothing in the library happened to use it, yet it exists
and takes a plain text name. A session searched both, found nothing, and
reported that no such action existed. That is the failure this tool exists to
make visible: it can widen the dictionary toward what is used, and it can never
prove what is absent.

So read the output as a to-do list for the dictionary, never as a boundary of
what Shortcuts can do. The only authoritative source for "does this exist" is
the device, and the honest report of a silent search is "I did not find one",
not "there is none".
"""
import argparse, collections, glob, json, plistlib, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def known_identifiers(path=None):
    """Every identifier the dictionary names, however it is nested."""
    d = json.loads((path or ROOT / "actions.json").read_text())["actions"]
    out = set()
    for value in d.values():
        for tok in str(value).replace('"', " ").replace(",", " ").split():
            tok = tok.strip("{}:")
            if tok.count(".") >= 2:
                out.add(tok)
    return out


def used_identifiers(zips):
    """Every identifier the corpus actually runs, with its use count."""
    used = collections.Counter()
    for z in zips:
        with zipfile.ZipFile(z) as f:
            for n in f.namelist():
                if not n.endswith(".wflow"):
                    continue
                try:
                    doc = plistlib.loads(f.read(n))
                except Exception:
                    continue
                for a in doc.get("WFWorkflowActions", []):
                    i = a.get("WFWorkflowActionIdentifier")
                    if i:
                        used[i] += 1
    return used


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zips", nargs="+")
    ap.add_argument("--bundles", action="store_true", help="group the gap by bundle")
    ap.add_argument("--json", dest="json_out", help="write the missing set here")
    args = ap.parse_args()

    zips = [z for pat in args.zips for z in sorted(glob.glob(pat))]
    if not zips:
        raise SystemExit("no dumps matched")

    known = known_identifiers()
    used = used_identifiers(zips)
    missing = {i: c for i, c in used.items() if i not in known}

    print("%d distinct identifiers used, %d absent from actions.json (%.0f%%)"
          % (len(used), len(missing), 100.0 * len(missing) / max(len(used), 1)),
          file=sys.stderr)

    if args.bundles:
        by = collections.Counter(".".join(i.split(".")[:3]) for i in missing)
        for bundle, n in by.most_common():
            print("%4d  %s" % (n, bundle))
    else:
        for i, c in sorted(missing.items(), key=lambda kv: (-kv[1], kv[0])):
            print("%4d  %s" % (c, i))

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps({"used": len(used), "missing": missing}, indent=1) + "\n")

    print("\nA gap is a to-do, not a boundary: an action in neither the dictionary "
          "nor the corpus may still exist.", file=sys.stderr)


if __name__ == "__main__":
    main()
