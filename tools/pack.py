#!/usr/bin/env python3
"""Pack a workflow chain into a tappable Shortcuts clipboard link.

    python3 tools/pack.py workflows/<chain>.json [--target NAME]

A chain file is {"label": str, "actions": [{"id": str, "p": {...}}, ...]}.
Each action becomes a plist document, whitespace-compacted, base64-encoded, and
wrapped in {"actions": [...], "report": ...}. The device decodes and stamps; it
computes nothing, so the report is composed here.

Anchors: write the RAW U+FFFC glyph. Base64 protects it in transit and no
browser renders it on this route, so the &#65532; entity rule that the {id, p}
route requires does not apply and would be wrong here.
"""
import argparse, base64, json, plistlib, re, sys, urllib.parse

TARGET = "Copy-ActionFromClaude"
GLYPH = "￼"


def pack_action(action):
    """One {id, p} to base64 plist XML. Compaction is verified, not assumed."""
    doc = {"WFWorkflowActionIdentifier": action["id"],
           "WFWorkflowActionParameters": action["p"]}
    xml = re.sub(r">\s+<", "><", plistlib.dumps(doc, fmt=plistlib.FMT_XML).decode())
    assert plistlib.loads(xml.encode()) == doc, "compaction altered " + action["id"]
    return base64.b64encode(xml.encode()).decode()


def payload(chain):
    actions = chain["actions"]
    names = [a["id"].replace("is.workflow.actions.", "") for a in actions]
    label = chain.get("label", "%d actions" % len(actions))
    return {"actions": [pack_action(a) for a in actions],
            "report": label + "\n" + "\n".join(names)}


def build(chain, target=TARGET):
    text = json.dumps(payload(chain), ensure_ascii=False, separators=(",", ":"))
    assert GLYPH not in text, "a raw U+FFFC escaped the base64 envelope"
    return "shortcuts://run-shortcut?name=%s&input=text&text=%s" % (
        target, urllib.parse.quote(text, safe=""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("chain")
    ap.add_argument("--target", default=TARGET)
    args = ap.parse_args()
    chain = json.load(open(args.chain))
    link = build(chain, args.target)
    print(link)
    print("\n%d actions, %d chars" % (len(chain["actions"]), len(link)), file=sys.stderr)


if __name__ == "__main__":
    main()
