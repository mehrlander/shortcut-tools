#!/usr/bin/env python3
"""Read what the device has actually reported, newest first.

    python3 tools/log.py                 # the last 15 entries
    python3 tools/log.py -n 40           # more
    python3 tools/log.py --since 09:00   # today, from a wall-clock time
    python3 tools/log.py --name Run-Pick # only entries naming one shortcut
    python3 tools/log.py --drift         # installed builds that differ from main's

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

A run's payload is usually JSON carrying one enormous base64 field. Eliding
decides WHAT a row shows, by giving a long string its head and its length
instead of 900 characters of base64; the row cap then decides how much. The two
are separate: a plain truncation at the same width shows base64 and nothing
else. --raw prints the payload whole.

And each run is scored against plists/builds.json, so a row says whether the
copy that ran is the copy that is current. That question is the reason the
build stamp exists and the one thing the stamp cannot answer alone; it cost a
checkout and a hand-run hash on 2026-08-29. pages/shortcut-log.html renders the
same two facts for whoever tapped the link, from the same two sources.

A run is scored, and an install row carries no build of what it installed, so a
row-by-row reader cannot see a name whose newest install is behind main. --drift
reads every row for that, not a window; see drift().
"""
import argparse, functools, hashlib, json, re, subprocess, sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent / "web-tools-private"
REF = "origin/main"
DIR = "shortcuts/log"
HERE = Path(__file__).resolve().parent.parent   # shortcut-tools, which publishes the builds
MAIN = "origin/main"


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

    Both install routes are read, and the second one is why this was wrong.
    `Library-Fetch` serves signed/<Name>.shortcut, so a plists-only pattern
    matched nothing, returned "", and the renderer dropped the empty value: four
    fetch rows in a row that named no version at all. A row whose version is
    missing looks exactly like a row that has one, which is the failure the ref
    exists to prevent.

    `Library-Paste` reads packed/<chain>.json, and the same omission dropped its
    ref until 2026-10-30. web-tools' kits/shortcut-evidence.js reads all three.
    """
    src = source(url)
    if not src:
        return ""
    ref = src[0]
    return ref[:7] if SHA.fullmatch(ref) else ref


SHA = re.compile(r"[0-9a-f]{40}")


def source(url):
    """(ref, folder) of the shortcut-tools file an install fetched, or None."""
    m = re.search(r"/shortcut-tools/(.+?)/(plists|signed|packed)/", url or "")
    return (m.group(1), m.group(2)) if m else None


CAP = 96     # a single string's head, before its length is reported
ROW = 120    # and the whole tail, since a row is one line; --raw prints it all


def elide(v):
    """Keep a long string's head and report its length, rather than cutting it.

    A truncated base64 blob and a short one look alike; a length says which it
    was. Recurses, since a run nests JSON inside JSON as a string.
    """
    if isinstance(v, str):
        if v.lstrip()[:1] in "[{":
            try:
                return elide(json.loads(v))
            except ValueError:
                pass
        return v if len(v) <= CAP else v[:48] + "…[%d]" % len(v)
    if isinstance(v, list):
        return [elide(x) for x in v]
    if isinstance(v, dict):
        return {k: elide(x) for k, x in v.items()}
    return v


def builds(path=None):
    """name -> build id for the installable set, read from this checkout.

    The page reads the published copy over the network; here the tree is the
    source, and the suite holds the two together.
    """
    f = path or Path(__file__).resolve().parent.parent / "plists" / "builds.json"
    try:
        return json.loads(f.read_text())
    except (OSError, ValueError):
        return {}


def verdict(name, ran, table):
    """'' when unknown: an unlooked-up answer must not read as a good one."""
    now = table.get(name)
    if not now or not ran:
        return ""
    return "  ✓current" if ran == now else "  ⚠stale→%s" % now


# The ops an installer logs, read off the chains that log them: Library-Import,
# Library-Replace, Library-Fetch, Library-Paste, and Library-Install, which
# bootstraps Library-Paste. A row's own `build` is the INSTALLER's stamp, never the build
# of the chain it installed.
INSTALLS = ("import", "replace", "fetch", "paste", "install")

# Why a name's newest install gets no verdict. None of these is "current".
WHY = {
    "branch": "names a branch, not a commit",
    "unbuilt": "names a commit whose plists/builds.json has no entry for it",
    "signed": "fetched a signed copy not made from that commit's plist",
    "nowhere": "names no shortcut-tools file",
}


def commit_reader(fetch=True, repo=HERE):
    """(sha, path) -> that file's bytes at that shortcut-tools commit, or None.

    An install names the commit it came from, which a squash merge can leave
    off main and a shallow clone never has, so a missing commit is fetched by
    id, once. A full clone stays full: --depth only where it is shallow already.
    """
    run = lambda *a: subprocess.run(["git", "-C", str(repo)] + list(a), capture_output=True)
    present = lambda sha: run("cat-file", "-e", sha + "^{commit}").returncode == 0

    @functools.lru_cache(maxsize=None)
    def have(sha):
        if present(sha):
            return True
        if fetch:
            shallow = run("rev-parse", "--is-shallow-repository").stdout.strip() == b"true"
            run("fetch", "-q", "--no-tags", "origin", sha, *(["--depth=1"] if shallow else []))
            if present(sha):
                return True
        print("cannot read shortcut-tools %s, so no install from it is scored" % sha[:7],
              file=sys.stderr)
        return False

    def show(sha, path):
        if not have(sha):
            return None
        r = run("show", "%s:%s" % (sha, path))
        return r.stdout if r.returncode == 0 else None
    return show


def installed(body, show):
    """(build, '') for the build an install row put on the phone, or ('', why).

    A paste row says it, as `target`. Import, replace and fetch rows carry no
    build of what they installed, so it is read off plists/builds.json at the
    commit `from` names. Only a commit answers: a branch name points somewhere
    else by now, and builds.json at its head today would be a guess reading as
    a lookup. A fetch installs signed/<Name>.shortcut, which nothing regenerates
    with the plist, so it answers only where signed/manifest.json at that commit
    records the hash of that commit's plist.
    """
    name = body.get("name", "")
    if body.get("target"):
        return str(body["target"]), ""
    src = source(body.get("from"))
    if not src:
        return "", "nowhere"
    ref, folder = src
    if not SHA.fullmatch(ref):
        return "", "branch"
    try:
        build = json.loads(show(ref, "plists/builds.json") or "{}").get(name, "")
    except ValueError:
        build = ""
    if not build:
        return "", "unbuilt"
    if folder == "signed":
        plist = show(ref, "plists/%s.plist" % name)
        try:
            signed = json.loads(show(ref, "signed/manifest.json") or "{}").get(name) or {}
        except ValueError:
            signed = {}
        if not plist or signed.get("plist_sha256") != hashlib.sha256(plist).hexdigest():
            return "", "signed"
    return build, ""


def drift(rows, main, show):
    """Each name main publishes, scored by its newest install over the whole log.

    A run scores itself as it is read. An install cannot, so a name whose newest
    install predates a merge read as nothing at all: Route-Gesture did for
    thirteen days from 2026-09-20 (snag branch-install-outlived-the-merge), and
    the Chains view's window of the newest rows had dropped the install anyway.

    `rows` is (stem, body) newest first, as entries() yields them; `main` is
    name -> build. Returns (behind, unscored, never): `behind` holds
    (name, stem, op, build, ref) for each newest install whose build is not
    main's; `unscored` maps a WHY key to the names whose newest install ties to
    no build, which are neither current nor behind; `never` is the names no
    install row names.
    """
    newest = {}
    for stem, body in rows:
        if isinstance(body, dict) and body.get("op") in INSTALLS and body.get("name") in main:
            newest.setdefault(body["name"], (stem, body))
    behind, unscored = [], {}
    for name in sorted(newest):
        stem, body = newest[name]
        build, why = installed(body, show)
        if why:
            unscored.setdefault(why, []).append(name)
        elif build != main[name]:
            behind.append((name, stem, body["op"], build, build_of(body.get("from"))))
    return behind, unscored, sorted(set(main) - set(newest))


def report_drift(fetch=True):
    """drift() over the whole log against builds.json on main: a row per name to
    reinstall, a count, then the names it cannot speak for and why."""
    if fetch:
        try:
            git("fetch", "origin", "main", "-q", repo=HERE)
        except subprocess.CalledProcessError as e:
            print("fetch failed, scoring against what is already here: %s" % e, file=sys.stderr)
    try:
        table = json.loads(git("show", "%s:plists/builds.json" % MAIN, repo=HERE))
        head = git("rev-parse", "--short", MAIN, repo=HERE).strip()
    except (subprocess.CalledProcessError, ValueError):
        raise SystemExit("cannot read plists/builds.json on %s, so nothing is scored" % MAIN)
    behind, unscored, never = drift(entries(fetch=fetch), table, commit_reader(fetch))
    for name, stem, op, build, ref in behind:
        when = stamp(stem)
        when = when.strftime("%Y-%m-%d %H:%M") if when else stem
        print("%s  %-8s %-22s build=%s main=%s from=%s" % (when, op, name, build, table[name], ref))
    scored = len(table) - len(never) - sum(len(v) for v in unscored.values())
    print("%d of %d scored names differ from %s at %s" % (len(behind), scored, MAIN, head))
    for why in WHY:
        if why in unscored:
            print("no verdict, newest install %s (%d): %s"
                  % (WHY[why], len(unscored[why]), ", ".join(unscored[why])))
    if never:
        print("no verdict, no install row (%d): %s" % (len(never), ", ".join(never)))


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


def render(stem, body, table=None):
    table = {} if table is None else table
    when = stamp(stem)
    when = when.strftime("%m-%d %H:%M:%S") if when else stem
    if isinstance(body, str):
        parsed = header(body)
        if parsed:
            op, fields, rest = parsed
            name = fields.pop("name", "")
            mark = verdict(name, fields.get("build"), table)
            tail = " ".join("%s=%s" % (k, v) for k, v in fields.items())
            got = ""
            if rest:
                try:
                    shown = json.dumps(elide(json.loads(rest)), ensure_ascii=False)
                except ValueError:
                    shown = elide(rest)
                shown = shown.replace("\n", " ⏎ ")
                if len(shown) > ROW:
                    shown = shown[:ROW - 1] + "…"
                got = " got=" + shown
            return "%s  %-8s %-22s %s%s%s" % (when, op, name, tail, mark, got)
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
    ap.add_argument("--drift", action="store_true",
                    help="every name in plists/builds.json on main whose newest install "
                         "is another build; reads the whole log, so -n, --since and --name do not apply")
    a = ap.parse_args()
    if a.drift:
        return report_drift(fetch=not a.no_fetch)

    cut = None
    if a.since:
        h, _, m = a.since.partition(":")
        today = datetime.now()
        cut = today.replace(hour=int(h), minute=int(m or 0), second=0, microsecond=0)

    table = builds()
    shown = 0
    for stem, body in entries(fetch=not a.no_fetch):
        if cut is not None:
            t = stamp(stem)
            if t is None or t < cut:
                continue
        blob = json.dumps(body) if isinstance(body, dict) else str(body)
        if a.name and a.name not in blob and a.name not in stem:
            continue
        print(render(stem, body, table))
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
