#!/usr/bin/env python3
"""Harvest shortcuts out of an archive into editable chain files.

    python3 tools/harvest.py <dump.zip …> --index <index.json> -o <dir>
    python3 tools/harvest.py <dump.zip …> --name Show-Loop -o <dir>
    python3 tools/harvest.py … --rename Old=New --rename Other=Newer
    python3 tools/harvest.py … --config <core>/harvest.json     # the flags, committed

`--config` reads the same renames and dropped calls from a JSON file,
`{"rename": {"Old": "New"}, "drop_call": ["Name"]}`, kept beside the output it
shapes. Until 2026-09-05 those arguments lived only in the private
`shortcuts/README.md`, so nothing could regenerate `core/` and compare, and it
fell two shortcuts behind its own tier without a word. With the file committed,
`freshness.py` gates `core/` the way it gates `library.json`.

A zip of plists is a backup. A directory of `{label, actions}` chain files is
source: it diffs, it reviews, `pack.py` turns any of it back into a paste link,
and a rewrite can be applied to all of it at once. This is the step between
having the library archived and being able to work on it.

`--rename` repoints `runworkflow` targets, which is the one edit worth doing
mechanically: the archive holds twelve calls into names that no longer exist,
and each is a menu branch that fails when tapped. It reports every edit it
makes and refuses silently changing nothing, since a rename that matched no
call is a typo rather than a no-op.

`--drop-call` is the other half, for a target that is not a rename at all. Two
of `Show-Versions`'s type handlers simply do not exist, so those inputs enter a
branch that calls nothing; deleting the branch says what the shortcut supports.

Only propose a rename you can justify. Sibling names in this library differ by
the type they handle (`Get-UrlVersions` and `Get-SafariVersions` are not two
spellings of one thing), so a close string is not evidence, and neither is a
family resemblance: `Say-Input` prompts for text where `Speak-Text` was handed
it, so they are not one shortcut renamed.
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


COND = "is.workflow.actions.conditional"


def drop_calls(chain, targets, log, source):
    """Remove calls to a name nothing can resolve, and the branch left behind.

    A dead call is not always a rename. `Show-Versions` dispatches on type and
    two of its handlers simply do not exist, so `Text` and `Dictionary` inputs
    enter a branch that calls nothing and leave again. Deleting the branch is
    the honest fix: it says what the shortcut supports, and adding a handler
    later is one shortcut plus one branch, which is the documented extension.

    Removing the call alone would leave an empty `If`, so a block whose body
    becomes empty goes with it. Only a block that held nothing else: anything
    with a surviving sibling is left alone, since that is a judgment.
    """
    acts = chain["actions"]
    doomed = set()
    for i, a in enumerate(acts):
        # A computed target is a token dict, not a string, and is unhashable.
        target = a["p"].get("WFWorkflowName") if a["id"] == RUN else None
        if not isinstance(target, str) or target not in targets:
            continue
        doomed.add(i)
        log.append((source, target))
        # An enclosing block is the nearest mode-0 above with a matching close
        # below, and it goes only if this call was its whole body.
        for j in range(i - 1, -1, -1):
            b = acts[j]
            if b["id"] != COND or b["p"].get("WFControlFlowMode") != 0:
                continue
            gid = b["p"].get("GroupingIdentifier")
            members = [k for k, c in enumerate(acts)
                       if c["id"] == COND and c["p"].get("GroupingIdentifier") == gid]
            if len(members) != 2 or members[0] != j or members[1] <= i:
                break                       # has an else, or is not our block
            if set(range(members[0] + 1, members[1])) - doomed:
                break                       # something else lives in there
            doomed.update(members)
            break
    chain["actions"] = [a for k, a in enumerate(acts) if k not in doomed]
    return chain


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
    ap.add_argument("--drop-call", action="append", default=[], metavar="NAME",
                    help="remove calls to NAME, and the branch left empty; repeatable")
    ap.add_argument("--config", help="a JSON file of {rename: {OLD: NEW}, drop_call: [NAME]}")
    args = ap.parse_args()

    renames = {}
    if args.config:
        cfg = json.loads(Path(args.config).read_text())
        renames.update(cfg.get("rename", {}))
        args.drop_call = list(cfg.get("drop_call", [])) + args.drop_call
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
    log, dropped, missing, written = [], [], [], 0
    for name in wanted:
        if name not in found:
            missing.append(name)
            continue
        path, info = found[name]
        doc = plistlib.loads(zipfile.ZipFile(path).read(info))
        chain = repoint(to_chain(name, doc), renames, log, name)
        if args.drop_call:
            chain = drop_calls(chain, set(args.drop_call), dropped, name)
        safe = name.replace("/", "_").replace(":", "_")
        (out / (safe + ".json")).write_text(
            json.dumps(chain, indent=1, ensure_ascii=False) + "\n")
        written += 1

    print("harvested %d chains to %s" % (written, out), file=sys.stderr)
    if missing:
        print("not in the archive: %s" % ", ".join(missing), file=sys.stderr)
    for source, old, new in log:
        print("  %s: %s -> %s" % (source, old, new), file=sys.stderr)
    for source, target in dropped:
        print("  %s: dropped the call to %s" % (source, target), file=sys.stderr)
    unfired = sorted(set(args.drop_call) - {t for _, t in dropped})
    if unfired:
        raise SystemExit("these --drop-call names matched no call: %s" % ", ".join(unfired))
    unused = sorted(set(renames) - {old for _, old, _ in log})
    if unused:
        raise SystemExit("these renames matched no call, which is a typo rather "
                         "than a no-op: %s" % ", ".join(unused))


if __name__ == "__main__":
    main()
