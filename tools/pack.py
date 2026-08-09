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


def verify(link):
    """Read a link back. Use this on the exact text about to be sent.

    A link is long enough to invite shortening, and the payload's tail is the
    report string, so a truncated copy still pastes correct actions and shows a
    garbled banner. That failure is silent by construction.
    """
    if "&text=" not in link:
        raise SystemExit("not a shortcuts:// link with a text payload")
    target = link.split("name=", 1)[1].split("&", 1)[0]
    body = json.loads(urllib.parse.unquote(link.split("&text=", 1)[1]))
    print("target:  " + target)
    print("report:  " + json.dumps(body.get("report", "")))
    for blob in body["actions"]:
        doc = plistlib.loads(base64.b64decode(blob))
        print("  " + doc["WFWorkflowActionIdentifier"])
    print("%d actions, %d chars" % (len(body["actions"]), len(link)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("chain", help="a workflows/ chain file, or a link with --verify")
    ap.add_argument("--target", default=TARGET)
    ap.add_argument("--verify", action="store_true", help="decode a link instead of building one")
    args = ap.parse_args()
    if args.verify:
        return verify(args.chain)
    chain = json.load(open(args.chain))
    link = build(chain, args.target)
    print(link)
    print("\n%d actions, %d chars" % (len(chain["actions"]), len(link)), file=sys.stderr)


if __name__ == "__main__":
    main()
