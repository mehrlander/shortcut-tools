#!/usr/bin/env python3
"""Read an action copied out of the Shortcuts app back into repo source.

    python3 tools/unpack.py <file>            # one copied action, or a whole .shortcut
    python3 tools/unpack.py <file> --workflow # emit a workflows/ file

Copying an action in the app yields a binary plist and the bytes survive the
trip intact, so `plistlib` reads it exactly. That is the reliable way to learn
an unfamiliar action's parameter shape: configure one card by hand, copy it,
run this. The dictionary carries identifiers, not parameters, so for anything
outside the 38 control-flow entries this is the only source.

Accepts binary or XML plist, and either a single action or a full workflow.
"""
import argparse, json, plistlib, sys


def actions_in(doc):
    """One action, or every action in a workflow."""
    if "WFWorkflowActions" in doc:
        return doc["WFWorkflowActions"]
    if "WFWorkflowActionIdentifier" in doc:
        return [doc]
    raise SystemExit("not a Shortcuts action or workflow: %s" % sorted(doc)[:4])


def to_workflow(actions, label):
    return {"label": label,
            "actions": [{"id": a["WFWorkflowActionIdentifier"],
                         "p": a.get("WFWorkflowActionParameters", {})} for a in actions]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--workflow", action="store_true", help="emit a workflows/ file")
    ap.add_argument("--label", default="Unpacked")
    args = ap.parse_args()

    doc = plistlib.load(open(args.file, "rb"))
    actions = actions_in(doc)
    wf = to_workflow(actions, doc.get("WFWorkflowName", args.label))

    print(json.dumps(wf if args.workflow else wf["actions"], indent=2, ensure_ascii=False))
    print("\n%d action(s)" % len(actions), file=sys.stderr)
    for a in wf["actions"]:
        print("  " + a["id"], file=sys.stderr)


if __name__ == "__main__":
    main()
