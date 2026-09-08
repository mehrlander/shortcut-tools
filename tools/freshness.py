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

Five derivatives gate, each compared byte-for-byte against a regeneration
into a temp dir, committed inputs only, so a failure names the first stage
that is behind rather than the whole pipeline:

    index.json     from dumps/*.zip        (index-dump.py)
    library.json   from committed index    (survey.py --json)
    library.html   from committed index    (survey.py -o)
    sketches/      from dumps/*.zip        (sketch.py --all --dir)
    core/          from dumps via index    (harvest.py --config core/harvest.json)

core/ gates only where core/harvest.json exists beside it: that file holds the
renames and dropped calls the harvest applies, which until 2026-09-05 lived in
README prose where nothing could rerun them. A shortcut whose plist will not
sketch is absent from both sides of the sketches comparison, so a known
unreadable one is not a failure.

incoming/ is the sixth check and is not a derivative: a Dump-Named export that
has not been folded is state the corpus does not yet hold, with a one-command
fix. `tools/fold-incoming.py` performs the fold and the whole regeneration, and
`--regen` regenerates alone, which is the fix this tool prints.
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


def tree(d):
    """A directory as {name: bytes}, so two trees compare in one expression."""
    return {p.name: p.read_bytes() for p in Path(d).iterdir() if p.is_file()}


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

        out = tmp / "sketches"
        subprocess.run([sys.executable, str(ROOT / "tools" / "sketch.py"), *map(str, dumps),
                        "--all", "--dir", str(out)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if tree(out) != tree(sc / "sketches"):
            stale.append("shortcuts/sketches/ (from dumps/*.zip)")

        cfg = sc / "core" / "harvest.json"
        if cfg.exists():
            out = tmp / "core"
            subprocess.run([sys.executable, str(ROOT / "tools" / "harvest.py"), *map(str, dumps),
                            "--index", str(sc / "index.json"), "--config", str(cfg), "-o", str(out)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            have = {k: v for k, v in tree(sc / "core").items() if k != "harvest.json"}
            if tree(out) != have:
                stale.append("shortcuts/core/ (from dumps via core/harvest.json)")

    waiting = sorted(p.name for p in sc.glob("incoming/*.txt"))
    if waiting:
        stale.append("shortcuts/incoming/ holds %d unfolded export(s): %s"
                     % (len(waiting), ", ".join(waiting)))

    import json
    names = {r["name"] for r in json.loads((sc / "index.json").read_text())}

    if stale:
        print("stale:\n  %s\nfix: python3 tools/fold-incoming.py%s   (from %s)"
              % ("\n  ".join(stale), "" if waiting else " --regen", ROOT), file=sys.stderr)
        return 1
    print("derivatives current with %d dumps (%d shortcuts)" % (len(dumps), len(names)),
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
