#!/usr/bin/env python3
"""Pack a workflow chain into a tappable Shortcuts clipboard link.

    python3 tools/pack.py workflows/<chain>.json [--target NAME]
    python3 tools/pack.py workflows/<chain>.json --url [--ref BRANCH]

A chain file is {"label": str, "actions": [{"id": str, "p": {...}}, ...]}.
Each action becomes a plist document, whitespace-compacted, base64-encoded, and
wrapped in {"actions": [...], "report": ...}. The device decodes and stamps; it
computes nothing, so the report is composed here.

Anchors: write the RAW U+FFFC glyph. Base64 protects it in transit and no
browser renders it on this route, so the &#65532; entity rule that the {id, p}
route requires does not apply and would be wrong here.

Inlining: anywhere a parameter value may be a string, {"$file": "path"} reads
that file's text instead. Paths are relative to the repository root, so a chain
carrying an HTML payload references the real file rather than a pasted copy of
it that drifts. Resolved before packing, so the plist sees only the text.
"""
import argparse, base64, json, plistlib, re, sys, urllib.parse
from pathlib import Path

TARGET = "Copy-ActionFromClaude"
URL_TARGET = "Copy-ActionFromUrl"
RAW = "https://raw.githubusercontent.com/mehrlander/shortcut-tools"
GLYPH = "￼"
ROOT = Path(__file__).resolve().parent.parent


def resolve(node):
    """Replace every {"$file": path} with the file's text, in place, recursively."""
    if isinstance(node, dict):
        if set(node) == {"$file"}:
            path = ROOT / node["$file"]
            if not path.is_file():
                raise SystemExit("no such $file: %s (relative to %s)" % (node["$file"], ROOT))
            text = path.read_text()
            if GLYPH in text:
                raise SystemExit("$file %s contains a raw U+FFFC, which would "
                                 "become an unbound anchor" % node["$file"])
            return text
        return {k: resolve(v) for k, v in node.items()}
    if isinstance(node, list):
        return [resolve(v) for v in node]
    return node


def pack_action(action):
    """One {id, p} to base64 plist XML. Compaction is verified, not assumed."""
    doc = {"WFWorkflowActionIdentifier": action["id"],
           "WFWorkflowActionParameters": resolve(action["p"])}
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


def address(chain_path, ref):
    """The link that carries a URL rather than the payload.

    This exists because the README described the form and nothing emitted it,
    so it was written by hand every time, which is the failure the packed route
    was built to end. A generated link is one the sender did not type.
    """
    name = Path(chain_path).name
    if not (ROOT / "packed" / name).is_file():
        raise SystemExit("no packed/%s, run `python3 tools/pack.py --publish`" % name)
    return "shortcuts://run-shortcut?name=%s&input=text&text=%s" % (
        URL_TARGET, urllib.parse.quote("%s/%s/packed/%s" % (RAW, ref, name), safe=""))


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


def publish(check=False):
    """Write every chain's payload under packed/, so a link can address it.

    A link that carries its payload has to be transcribed whole, and the one
    transcribing it may be a model rather than a person; three links in one
    session arrived with base64 in place of a label. A link that carries a URL
    is short enough to get right and fails loudly when it is not. The payload
    is deterministic, so --check holds packed/ to the chains rather than
    trusting anyone to remember.
    """
    out = ROOT / "packed"
    out.mkdir(exist_ok=True)
    stale = []
    for chain in sorted((ROOT / "workflows").glob("*.json")):
        text = json.dumps(payload(json.load(open(chain))), ensure_ascii=False, separators=(",", ":"))
        dest = out / chain.name
        if check:
            if not dest.is_file() or dest.read_text() != text:
                stale.append(dest.relative_to(ROOT).as_posix())
        else:
            dest.write_text(text)
    if check and stale:
        raise SystemExit("stale, run `python3 tools/pack.py --publish`:\n  " + "\n  ".join(stale))
    print("packed/ is current" if check else "wrote %d payloads to packed/" % len(list(out.glob("*.json"))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("chain", nargs="?", help="a workflows/ chain file, or a link with --verify")
    ap.add_argument("--target", default=TARGET)
    ap.add_argument("--verify", action="store_true", help="decode a link instead of building one")
    ap.add_argument("--publish", action="store_true", help="write every chain's payload to packed/")
    ap.add_argument("--check", action="store_true", help="fail if packed/ is behind workflows/")
    ap.add_argument("--url", action="store_true",
                    help="emit a link addressing packed/ instead of carrying the payload")
    ap.add_argument("--ref", default="main", help="branch or SHA the --url link reads from")
    args = ap.parse_args()
    if args.publish or args.check:
        return publish(args.check)
    if not args.chain:
        raise SystemExit("give a chain, or --publish")
    if args.verify:
        return verify(args.chain)
    if args.url:
        return print(address(args.chain, args.ref))
    chain = json.load(open(args.chain))
    link = build(chain, args.target)
    print(link)
    print("\n%d actions, %d chars" % (len(chain["actions"]), len(link)), file=sys.stderr)


if __name__ == "__main__":
    main()
