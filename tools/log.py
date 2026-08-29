#!/usr/bin/env python3
"""Read what the device has actually reported, newest first.

    python3 tools/log.py                 # the last 15 entries
    python3 tools/log.py -n 40           # more
    python3 tools/log.py --since 09:00   # today, from a wall-clock time
    python3 tools/log.py --name Run-Pick # only entries naming one shortcut

`Log-Repo` commits every payload it is handed to `shortcuts/log/` in
web-tools-private, and `Library-Import` ends by calling it, so **every install
lands here**. Nothing else does unless a chain says so, which is the asymmetry
this tool exists to make visible rather than to fix: a session can always see
what installed and usually cannot see what ran.

Reading it was a `git log` and a `git show` per entry, done from memory, which
meant it was checked when someone thought of it rather than every time. That is
the actual defect. One command, run at the end of any turn that handed over a
link, replaces guessing about whether something worked.

Entries are JSON where the chain wrote JSON and bare text where it did not; both
are shown, because a probe's output is deliberately a line of text.
"""
import argparse, json, re, subprocess, sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent / "web-tools-private"
REF = "origin/main"
DIR = "shortcuts/log"


def git(*args, repo=REPO):
    return subprocess.run(["git", "-C", str(repo)] + list(args),
                          capture_output=True, text=True, check=True).stdout


def entries(fetch=True, repo=REPO):
    """Every log entry on origin/main, newest first.

    Read out of git rather than off disk, and fetched first, because the working
    tree is a checkout from whenever the session last pulled. Reading the tree
    showed entries three days stale while the device had committed minutes
    earlier, which is the same blindness this tool exists to remove, one level
    up. Filenames are yyyy-MM-dd-HHmmss, so they sort.
    """
    if not (Path(repo) / ".git").exists():
        raise SystemExit("no repo at %s; is web-tools-private checked out beside this one?" % repo)
    if fetch:
        try:
            git("fetch", "origin", "main", "-q")
        except subprocess.CalledProcessError as e:
            print("fetch failed, reading what is already here: %s" % e, file=sys.stderr)
    names = [l.split("/")[-1] for l in git("ls-tree", "--name-only", f"{REF}:{DIR}").splitlines()
             if l.endswith(".json")]
    for n in sorted(names, reverse=True):
        raw = git("show", f"{REF}:{DIR}/{n}").strip()
        try:
            body = json.loads(raw)
        except ValueError:
            body = raw
        yield n[:-5], body


def stamp(name):
    try:
        return datetime.strptime(name, "%Y-%m-%d-%H%M%S")
    except ValueError:
        return None


def build_of(url):
    """The ref an install came from: .../shortcut-tools/<ref>/plists/X.plist.

    The whole URL is noise in a list; the ref is the only part that answers the
    question actually being asked, which is whether the build just pushed is the
    build that ran.
    """
    m = re.search(r"/shortcut-tools/(.+?)/plists/", url or "")
    if not m:
        return ""
    ref = m.group(1)
    return ref[:7] if re.fullmatch(r"[0-9a-f]{40}", ref) else ref


HEADER = re.compile(r"^(\w+)((?:\s+\w+=\S*)*)\s*$")


def header(text):
    """Parse a `verb key=value key=value` first line, with the rest the payload.

    The first structured payload was JSON with the result interpolated into it,
    and the result carried quotes, so the object never parsed. A header line
    survives any payload because the payload is not inside it.
    """
    first, _, rest = text.partition("\n")
    m = HEADER.match(first)
    if not m or "=" not in first:
        return None
    fields = dict(kv.split("=", 1) for kv in m.group(2).split())
    return m.group(1), fields, rest.strip()


def render(stem, body):
    when = stamp(stem)
    when = when.strftime("%m-%d %H:%M:%S") if when else stem
    if isinstance(body, str):
        parsed = header(body)
        if parsed:
            op, fields, rest = parsed
            name = fields.pop("name", "")
            tail = " ".join("%s=%s" % (k, v) for k, v in fields.items())
            got = (" got=" + rest.replace("\n", " ⏎ ")[:70]) if rest else ""
            return "%s  %-8s %-22s %s%s" % (when, op, name, tail, got)
    if isinstance(body, dict):
        op = body.get("op", "?")
        name = body.get("name", "")
        rest = {k: v for k, v in body.items() if k not in ("op", "name")}
        if "from" in rest:
            rest = dict(rest, **{"from": build_of(rest["from"])})
        tail = " ".join("%s=%s" % (k, str(v)[:60]) for k, v in rest.items() if v != "")
        return "%s  %-8s %-22s %s" % (when, op, name, tail)
    text = str(body).replace("\n", " ⏎ ")
    return "%s  %-8s %s" % (when, "text", text[:140])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=15, help="how many entries")
    ap.add_argument("--since", help="today, from HH:MM")
    ap.add_argument("--name", help="only entries whose text or name mentions this")
    ap.add_argument("--raw", action="store_true", help="print each payload whole")
    ap.add_argument("--no-fetch", action="store_true", help="skip the fetch and read what is here")
    a = ap.parse_args()

    cut = None
    if a.since:
        h, _, m = a.since.partition(":")
        today = datetime.now()
        cut = today.replace(hour=int(h), minute=int(m or 0), second=0, microsecond=0)

    shown = 0
    for stem, body in entries(fetch=not a.no_fetch):
        if cut is not None:
            t = stamp(stem)
            if t is None or t < cut:
                continue
        blob = json.dumps(body) if isinstance(body, dict) else str(body)
        if a.name and a.name not in blob and a.name not in stem:
            continue
        print(render(stem, body))
        if a.raw:
            print("    " + (json.dumps(body, indent=2).replace("\n", "\n    ")
                            if isinstance(body, dict) else str(body)))
        shown += 1
        if shown >= a.n:
            break
    if not shown:
        print("nothing matched", file=sys.stderr)


if __name__ == "__main__":
    main()
