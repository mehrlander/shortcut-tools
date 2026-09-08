#!/usr/bin/env python3
"""Fold shortcuts/incoming/ into the corpus, and regenerate every derivative.

    python3 tools/fold-incoming.py             # fold every incoming file, regenerate, delete them
    python3 tools/fold-incoming.py --check     # exit 1 naming what is waiting to be folded
    python3 tools/fold-incoming.py --regen     # regenerate the derivatives only, nothing folded

The sync channel had a reader for each half and no tool for the join. A
`Dump-Named` tap writes `incoming/<stamp>.txt`; `read-incoming.py --zip` turns
one into a dump; the private README then lists five commands to run in order
and says to delete the incoming file afterwards. Left to hand, the fold was
skipped: on 2026-09-05 three files sat in `incoming/`, two of them already
folded on 2026-08-19 by a commit whose message said they were deleted, and the
third holding the only copy of eleven shortcuts changed after the last dump.
A staging area that outlives its merge is a second source of truth for a few
shortcuts, which the README already calls worse than not having it.

What one run does, in order, from a shortcut-tools checkout beside
web-tools-private (or `--private PATH`, or `$WEB_TOOLS_PRIVATE`):

1. Each `incoming/<stamp>.txt` becomes `dumps/<stamp>-named.zip`, the shape
   `dump-folder-zip` produces, through `read-incoming.py`. A file that parses to
   an unreadable record stops the run before anything is written.
2. The derivatives regenerate from `dumps/*.zip`, oldest first so a later copy
   of a shortcut wins: `index.json`, then `library.json` and `library.html`
   from it, `sketches/` from the dumps, and `core/` from the dumps through the
   index and `core/harvest.json`. Sketch files for departed shortcuts are
   removed; a shortcut whose plist will not sketch is reported, not fatal.
3. The folded incoming files are deleted.

Nothing is committed. Review the diff, then commit the private repo. The stamp
in the zip name is the incoming file's own, so `index.json`'s `from` field and
`manifest-delta.py`'s cutoff read the fold date off it.

`--check` is the gate `freshness.py` calls: a non-empty `incoming/` is stale
state with a one-command fix, the same posture the suite takes toward a
`packed/` behind `workflows/`.
"""
import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
HARVEST_CONFIG = "harvest.json"


def find_private(arg):
    for cand in (arg, os.environ.get("WEB_TOOLS_PRIVATE"), ROOT.parent / "web-tools-private"):
        if cand and (Path(cand) / "shortcuts" / "index.json").exists():
            return Path(cand)
    return None


def load(name):
    """Import a hyphenated sibling tool as a module."""
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), TOOLS / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(*cmd):
    subprocess.run([sys.executable, *map(str, cmd)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def waiting(sc):
    return sorted((sc / "incoming").glob("*.txt"))


def fold_one(path, sc):
    """One incoming file to one dump zip. Returns the zip path."""
    ri = load("read-incoming")
    records = ri.parse_dump(path.read_text())
    if not records:
        raise SystemExit("%s parsed to zero records; is it a dump?" % path.name)
    good, bad = [], []
    for rec in records:
        data, why = ri.to_plist(rec)
        (bad if why else good).append((rec, why or data))
    if bad:
        raise SystemExit("%s has %d unreadable record(s), nothing written: %s"
                         % (path.name, len(bad), ", ".join(r["name"] for r, _ in bad)))
    out = sc / "dumps" / (path.stem + "-named.zip")
    if out.exists():
        raise SystemExit("%s already exists; was this file folded and not deleted?" % out.name)
    import zipfile
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rec, data in good:
            z.writestr(rec["name"].replace("/", ":") + ".wflow", data)
    print("folded %s -> %s (%d shortcuts)" % (path.name, out.name, len(good)), file=sys.stderr)
    return out


def regenerate(sc):
    """Every derivative, from dumps/*.zip, in dependency order."""
    dumps = sorted(sc.glob("dumps/*.zip"))
    if not dumps:
        raise SystemExit("no dumps under %s" % sc)
    run(TOOLS / "index-dump.py", *dumps, "--json", sc / "index.json")
    run(TOOLS / "survey.py", sc / "index.json", "--json", sc / "library.json")
    run(TOOLS / "survey.py", sc / "index.json", "-o", sc / "library.html")

    sk = sc / "sketches"
    fresh = sc / "sketches.new"
    if fresh.exists():
        shutil.rmtree(fresh)
    r = subprocess.run([sys.executable, str(TOOLS / "sketch.py"), *map(str, dumps), "--all", "--dir", str(fresh)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    unreadable = [l for l in r.stderr.splitlines() if "UNREADABLE" in l]
    if sk.exists():
        shutil.rmtree(sk)
    fresh.rename(sk)
    for line in unreadable:
        print("  sketch: " + line.strip(), file=sys.stderr)

    cfg = sc / "core" / HARVEST_CONFIG
    if cfg.exists():
        core = sc / "core"
        keep = {HARVEST_CONFIG}
        for p in core.glob("*.json"):
            if p.name not in keep:
                p.unlink()
        run(TOOLS / "harvest.py", *dumps, "--index", sc / "index.json", "--config", cfg, "-o", core)
    else:
        print("  core/: no %s beside it, so not regenerated (see shortcuts/README.md)"
              % HARVEST_CONFIG, file=sys.stderr)

    names = {r["name"] for r in json.loads((sc / "index.json").read_text())}
    print("regenerated derivatives from %d dumps (%d shortcuts)" % (len(dumps), len(names)),
          file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--private", help="path to a web-tools-private checkout")
    ap.add_argument("--check", action="store_true", help="report what is waiting; exit 1 if anything is")
    ap.add_argument("--regen", action="store_true", help="regenerate derivatives only; fold nothing")
    args = ap.parse_args()

    private = find_private(args.private)
    if not private:
        print("no web-tools-private checkout (looked at --private, "
              "$WEB_TOOLS_PRIVATE, ../web-tools-private); skipping", file=sys.stderr)
        return 2
    sc = private / "shortcuts"

    if args.check:
        files = waiting(sc)
        if files:
            print("incoming/ holds %d file(s) not folded into the corpus:\n  %s\n"
                  "fold with: python3 tools/fold-incoming.py"
                  % (len(files), "\n  ".join(p.name for p in files)), file=sys.stderr)
            return 1
        print("incoming/ is empty", file=sys.stderr)
        return 0

    folded = []
    if not args.regen:
        for path in waiting(sc):
            folded.append((path, fold_one(path, sc)))
        if not folded:
            print("incoming/ is empty; use --regen to regenerate anyway", file=sys.stderr)
            return 0
    regenerate(sc)
    for path, _ in folded:
        path.unlink()
        print("deleted %s" % path.name, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
