#!/usr/bin/env python3
"""Check that the corpus derivatives in web-tools-private are current.

The regeneration pipeline (index-dump, survey, sketch, harvest) runs by hand
from this repo into web-tools-private after a new dump. Nothing on the device
or in either repo refreshes a derivative, so a new dump with a stale
library.json means the library page, the prune queue, and the idioms doc all
describe the previous device state, silently. This is the cross-repo version
of the guarantee the suite already makes for packed/ and plists/.

    python3 tools/freshness.py                # find the checkout, check it
    python3 tools/freshness.py --private PATH # name the checkout explicitly

The checkout is resolved from --private, then $WEB_TOOLS_PRIVATE, then the
sibling directory ../web-tools-private. Exit codes are the contract the test
wrapper reads: 0 current, 1 stale (the fix is printed), 2 no checkout (a
public-only clone; the caller should skip, not fail).

Three derivatives gate, each compared byte-for-byte against a regeneration
into a temp dir, committed inputs only, so a failure names the first stage
that is behind rather than the whole pipeline:

    index.json     from dumps/*.zip        (index-dump.py)
    library.json   from committed index    (survey.py --json)
    library.html   from committed index    (survey.py -o)

Two derivatives deliberately do not gate. sketches/ has known, accepted gaps
(a shortcut whose plist will not sketch is a gap in the archive, not a
failure) and the step that splits the --all stream into files is unrecorded,
so coverage is reported as an advisory count instead. harvest's core/ output
depends on --rename/--drop-call arguments recorded only in the private
shortcuts/README.md; until that invocation moves somewhere machine-readable,
checking it here would mean keeping a second copy of those arguments.
"""

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def find_private(arg):
    for cand in (arg, os.environ.get("WEB_TOOLS_PRIVATE"), ROOT.parent / "web-tools-private"):
        if cand and (Path(cand) / "shortcuts" / "index.json").exists():
            return Path(cand)
    return None


def regen(out, *cmd):
    subprocess.run([sys.executable, *map(str, cmd)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return Path(out).read_bytes()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--private", help="path to a web-tools-private checkout")
    args = ap.parse_args()

    private = find_private(args.private)
    if not private:
        print("no web-tools-private checkout (looked at --private, "
              "$WEB_TOOLS_PRIVATE, ../web-tools-private); skipping", file=sys.stderr)
        return 2

    sc = private / "shortcuts"
    dumps = sorted(sc.glob("dumps/*.zip"))
    if not dumps:
        print("checkout has no dumps under %s; nothing to check" % sc, file=sys.stderr)
        return 2

    stale = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)

        out = tmp / "index.json"
        got = regen(out, ROOT / "tools" / "index-dump.py", *dumps, "--json", out)
        if got != (sc / "index.json").read_bytes():
            stale.append("shortcuts/index.json (from dumps/*.zip)")

        out = tmp / "library.json"
        got = regen(out, ROOT / "tools" / "survey.py", sc / "index.json", "--json", out)
        if got != (sc / "library.json").read_bytes():
            stale.append("shortcuts/library.json (from index.json)")

        out = tmp / "library.html"
        got = regen(out, ROOT / "tools" / "survey.py", sc / "index.json", "-o", out)
        if got != (sc / "library.html").read_bytes():
            stale.append("shortcuts/library.html (from index.json)")

    import json
    names = {r["name"] for r in json.loads((sc / "index.json").read_text())}
    sketched = {p.stem for p in sc.glob("sketches/*.txt")}
    missing, extra = sorted(names - sketched), sorted(sketched - names)
    if missing or extra:
        print("advisory: sketches/ covers %d of %d shortcuts (%d unsketched%s)"
              % (len(sketched & names), len(names), len(missing),
                 ", %d stale files for departed shortcuts: %s" % (len(extra), ", ".join(extra))
                 if extra else ""), file=sys.stderr)

    if stale:
        print("stale, rerun the pipeline in %s/shortcuts/README.md:\n  %s"
              % (private, "\n  ".join(stale)), file=sys.stderr)
        return 1
    print("derivatives current with %d dumps (%d shortcuts)" % (len(dumps), len(names)),
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
