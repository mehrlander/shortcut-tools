#!/usr/bin/env python3
"""Index a zipped shortcut dump: what each one is, and what calls what.

    python3 tools/index-dump.py dump.zip [--json index.json]

The dump comes from `workflows/dump-folder-zip.json`: one `.wflow` per shortcut,
named by the shortcut, each an unsigned XML plist. What that leaves is a pile of
files with no map, and the map is the useful part, because a library is a set of
verbs and the only way to compose them is to know which ones exist, what each
takes, and which already call which.

The call graph is read from `runworkflow` targets. Since `WFWorkflowName` alone
resolves a target (see docs/shortcuts-format-notes.md), the name is enough and
the device-local identifier is ignored where present.
"""
import argparse, collections, json, plistlib, sys, zipfile
from pathlib import Path

RUN = "is.workflow.actions.runworkflow"


def name_of(info):
    """Zip filenames are UTF-8 bytes, but the UTF-8 flag is often unset, and
    `zipfile` then decodes them as cp437. Undo that or every emoji-named
    shortcut arrives as mojibake."""
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode("cp437").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return info.filename


def target(action):
    """The shortcut a Run Shortcut action names, or None if it is computed."""
    value = action.get("WFWorkflowActionParameters", {}).get("WFWorkflowName")
    if isinstance(value, str):
        return value
    return None                      # a token string: the target is a variable


def describe(name, doc):
    actions = doc.get("WFWorkflowActions", [])
    ids = [a.get("WFWorkflowActionIdentifier", "?") for a in actions]
    calls, computed = [], 0
    for a in actions:
        if a.get("WFWorkflowActionIdentifier") != RUN:
            continue
        t = target(a)
        if t is None:
            computed += 1
        elif t not in calls:
            calls.append(t)
    return {
        "name": name,
        "actions": len(actions),
        "calls": calls,
        "computed_calls": computed,
        "takes_input": bool(doc.get("WFWorkflowHasShortcutInputVariables")),
        "menu": ids.count("is.workflow.actions.choosefrommenu") > 0,
        "kinds": collections.Counter(i.replace("is.workflow.actions.", "") for i in ids).most_common(4),
    }


def load(path):
    z = zipfile.ZipFile(path)
    out = []
    for info in z.infolist():
        if info.is_dir():
            continue
        name = name_of(info)
        try:
            doc = plistlib.loads(z.read(info))
        except Exception as err:
            out.append({"name": name, "error": str(err)})
            continue
        out.append(describe(name.rsplit(".", 1)[0], doc))
    return out


def report(index):
    known = {s["name"] for s in index if "error" not in s}
    callers = collections.defaultdict(list)
    for s in index:
        for t in s.get("calls", []):
            callers[t].append(s["name"])

    print("%d shortcuts\n" % len(index))
    for s in sorted(index, key=lambda s: -s.get("actions", 0)):
        if "error" in s:
            print("  %-34s  UNREADABLE: %s" % (s["name"], s["error"]))
            continue
        bits = ["%3d actions" % s["actions"]]
        if s["takes_input"]:
            bits.append("takes input")
        if s["menu"]:
            bits.append("menu")
        if s["computed_calls"]:
            bits.append("%d computed call(s)" % s["computed_calls"])
        print("  %-34s %s" % (s["name"], ", ".join(bits)))
        if s["calls"]:
            print("      calls: " + ", ".join(
                c + ("" if c in known else " [missing]") for c in s["calls"]))

    missing = sorted({t for t in callers if t not in known})
    roots = sorted(s["name"] for s in index if s["name"] not in callers and "error" not in s)
    print("\n%d called by nothing here: %s" % (len(roots), ", ".join(roots)))
    if missing:
        print("\n%d named but not in this dump: %s" % (len(missing), ", ".join(missing)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip", help="a dump from dump-folder-zip")
    ap.add_argument("--json", help="also write the index here")
    args = ap.parse_args()
    index = load(args.zip)
    if args.json:
        Path(args.json).write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n")
        print("wrote %s" % args.json, file=sys.stderr)
    report(index)


if __name__ == "__main__":
    main()
