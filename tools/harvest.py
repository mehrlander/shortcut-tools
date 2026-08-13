#!/usr/bin/env python3
"""Harvest shortcuts out of an archive into editable chain files.

    python3 tools/harvest.py <dump.zip …> --index <index.json> -o <dir>
    python3 tools/harvest.py <dump.zip …> --name Show-Loop -o <dir>
    python3 tools/harvest.py … --rename Old=New --rename Other=Newer

A zip of plists is a backup. A directory of `{label, actions}` chain files is
source: it diffs, it reviews, `pack.py` turns any of it back into a paste link,
and a rewrite can be applied to all of it at once. This is the step between
having the library archived and being able to work on it.

`--rename` repoints `runworkflow` targets, which is the one edit worth doing
mechanically: the archive holds twelve calls into names that no longer exist,
and each is a menu branch that fails when tapped. It reports every edit it
makes and refuses silently changing nothing, since a rename that matched no
call is a typo rather than a no-op.

Only propose a rename you can justify. Sibling names in this library differ by
the type they handle (`Get-UrlVersions` and `Get-SafariVersions` are not two
spellings of one thing), so a close string is not evidence.
"""
import argparse, collections, json, plistlib, sys, zipfile
from pathlib import Path

RUN = "is.workflow.actions.runworkflow"


def entries(paths):
    out = {}
    for path in paths:
        z = zipfile.ZipFile(path)
        for info in z.infolist():
            if info.is_dir():
                continue
            name = info.filename
            if not info.flag_bits & 0x800:
                try:
                    name = name.encode("cp437").decode("utf-8")
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
            out.setdefault(name.rsplit(".", 1)[0], (path, info))
    return out


def to_chain(name, doc):
    return {"label": "%s (harvested, %d actions)" % (name, len(doc.get("WFWorkflowActions", []))),
            "actions": [{"id": a["WFWorkflowActionIdentifier"],
                         "p": a.get("WFWorkflowActionParameters", {})}
                        for a in doc.get("WFWorkflowActions", [])]}


def repoint(chain, renames, log, source):
    """Rewrite Run Shortcut targets, and drop the device-local pin while here.

    A `WFWorkflow` dict carries a `workflowIdentifier` minted on one install,
    so a harvested chain that keeps it is wrong on any other device. Since the
    name alone resolves, dropping it is strictly better and is the one edit
    applied to every chain rather than only to renamed ones.
    """
    for action in chain["actions"]:
        if action["id"] != RUN:
            continue
        p = action["p"]
        target = p.get("WFWorkflowName")
        if isinstance(target, str) and target in renames:
            p["WFWorkflowName"] = renames[target]
            log.append((source, target, renames[target]))
        p.pop("WFWorkflow", None)
    return chain


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip", nargs="+")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--index", help="an index.json; harvests one tier from it")
    ap.add_argument("--tier", default="core", help="which tier, with --index (default: core)")
    ap.add_argument("--name", action="append", help="an explicit shortcut; repeatable")
    ap.add_argument("--rename", action="append", default=[], metavar="OLD=NEW",
                    help="repoint Run Shortcut targets; repeatable")
    args = ap.parse_args()

    renames = {}
    for pair in args.rename:
        if "=" not in pair:
            raise SystemExit("--rename takes OLD=NEW, got %r" % pair)
        old, new = pair.split("=", 1)
        renames[old] = new

    found = entries(args.zip)
    if args.name:
        wanted = list(args.name)
    elif args.index:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import survey
        rows, _ = survey.tier(json.load(open(args.index)), survey.HUBS)
        wanted = [r["name"] for r in rows if r["tier"] == args.tier]
    else:
        raise SystemExit("give --index or at least one --name")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    log, missing, written = [], [], 0
    for name in wanted:
        if name not in found:
            missing.append(name)
            continue
        path, info = found[name]
        doc = plistlib.loads(zipfile.ZipFile(path).read(info))
        chain = repoint(to_chain(name, doc), renames, log, name)
        safe = name.replace("/", "_").replace(":", "_")
        (out / (safe + ".json")).write_text(
            json.dumps(chain, indent=1, ensure_ascii=False) + "\n")
        written += 1

    print("harvested %d chains to %s" % (written, out), file=sys.stderr)
    if missing:
        print("not in the archive: %s" % ", ".join(missing), file=sys.stderr)
    for source, old, new in log:
        print("  %s: %s -> %s" % (source, old, new), file=sys.stderr)
    unused = sorted(set(renames) - {old for _, old, _ in log})
    if unused:
        raise SystemExit("these renames matched no call, which is a typo rather "
                         "than a no-op: %s" % ", ".join(unused))


if __name__ == "__main__":
    main()
