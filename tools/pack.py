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
import argparse, base64, hashlib, json, plistlib, re, sys, urllib.parse
from pathlib import Path

TARGET = "Copy-ActionFromClaude"
URL_TARGET = "Copy-ActionFromUrl"
RAW = "https://raw.githubusercontent.com/mehrlander/shortcut-tools"
GLYPH = "￼"
ROOT = Path(__file__).resolve().parent.parent


def build_id(chain):
    """A short content hash of the chain, so a shortcut can say which build it is.

    The recurring waste in this repo is not knowing whether the copy that ran is
    the copy just pushed. An install logs the ref it came from, but a RUN has no
    way to say, so a stale copy behaves exactly like a fresh one that failed. A
    chain carrying {"$build": true} gets this substituted, logs it, and the
    ambiguity is gone.

    Hashed with the directive still in place, so it does not depend on itself,
    and over the canonical JSON so it is deterministic across runs. Both mirrors
    substitute it, because a directive resolved by one and not the other is the
    exact defect $file already caused once.
    """
    return hashlib.sha1(json.dumps(chain, sort_keys=True,
                                   ensure_ascii=False).encode()).hexdigest()[:7]


BUILD_TOKEN = "#BUILD#"   # exactly len(build_id), so anchor offsets do not move


def resolve(node, build=None):
    """Replace {"$file": path} and the #BUILD# token, recursively.

    The build id substitutes inside a STRING rather than into an attachment
    slot, because an attachmentsByRange entry is an attachment descriptor and a
    bare string there is not one. The token is the same width as the id it
    becomes, so every U+FFFC offset in the same string survives untouched. That
    is asserted, not assumed.
    """
    if isinstance(node, str):
        if BUILD_TOKEN in node:
            if build is None:
                raise SystemExit("%s used where no build id was supplied" % BUILD_TOKEN)
            assert len(build) == len(BUILD_TOKEN), "build id must be %d chars" % len(BUILD_TOKEN)
            return node.replace(BUILD_TOKEN, build)
        return node
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
        return {k: resolve(v, build) for k, v in node.items()}
    if isinstance(node, list):
        return [resolve(v, build) for v in node]
    return node


def pack_action(action, build=None):
    """One {id, p} to base64 plist XML.

    Compaction collapses whitespace between tags, which is worth a third of the
    payload. It is unsafe for a value that itself contains `>` whitespace `<`,
    which real shortcuts do: any embedded HTML, and any regex spanning a line.
    So compaction is verified rather than assumed, and a payload it would alter
    ships uncompacted. Correct and larger beats smaller and wrong.
    """
    doc = {"WFWorkflowActionIdentifier": action["id"],
           "WFWorkflowActionParameters": resolve(action["p"], build)}
    full = plistlib.dumps(doc, fmt=plistlib.FMT_XML).decode()
    tight = re.sub(r">\s+<", "><", full)
    xml = tight if plistlib.loads(tight.encode()) == doc else full
    assert plistlib.loads(xml.encode()) == doc, "plist did not round-trip: " + action["id"]
    return base64.b64encode(xml.encode()).decode()


def payload(chain):
    actions = chain["actions"]
    names = [a["id"].replace("is.workflow.actions.", "") for a in actions]
    label = chain.get("label", "%d actions" % len(actions))
    build = build_id(chain)
    return {"actions": [pack_action(a, build) for a in actions],
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


def shown(path):
    """A path as the reader will type it: repo-relative where it is in the repo.

    `relative_to` raises rather than falling back, so an --out directory outside
    the tree turned a stale-or-orphan report into a traceback. The message is
    for a person, and an absolute path serves that fine.
    """
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def publish(check=False, src=None, out=None):
    """Write every chain's payload under packed/, so a link can address it.

    A link that carries its payload has to be transcribed whole, and the one
    transcribing it may be a model rather than a person; three links in one
    session arrived with base64 in place of a label. A link that carries a URL
    is short enough to get right and fails loudly when it is not. The payload
    is deterministic, so --check holds packed/ to the chains rather than
    trusting anyone to remember.

    AND HOLDS IT BOTH WAYS. The loop asks whether each chain's payload is
    current and used to ask nothing else, so a deleted or renamed chain left a
    payload behind that --check called current while the suite's one-payload-
    per-chain assertion failed on it. Two gates stating one invariant, and the
    one a person runs for a fast answer was the one that lied. Publishing now
    removes what no chain claims and --check reports it.

    --workflows and --out mirror plist.py's, and prune under the same rule:
    only a matched pair, since a foreign chain set aimed at the real packed/
    would otherwise delete every payload it did not itself produce.
    """
    dest_dir = out or ROOT / "packed"
    paired = (src is None) == (out is None)
    dest_dir.mkdir(parents=True, exist_ok=True)
    stale, want = [], set()
    for chain in sorted((src or ROOT / "workflows").glob("*.json")):
        text = json.dumps(payload(json.load(open(chain))), ensure_ascii=False, separators=(",", ":"))
        dest = dest_dir / chain.name
        want.add(dest)
        if check:
            if not dest.is_file() or dest.read_text() != text:
                stale.append(shown(dest))
        else:
            dest.write_text(text)
    orphans = sorted(p for p in dest_dir.glob("*.json") if paired and p not in want)
    if check:
        bad = stale + ["%s (no chain claims it)" % shown(p) for p in orphans]
        if bad:
            raise SystemExit("stale, run `python3 tools/pack.py --publish`:\n  " + "\n  ".join(bad))
        print("packed/ is current")
        return
    for p in orphans:
        p.unlink()
    print("wrote %d payloads to packed/%s" % (
        len(want), ", removed %d unclaimed" % len(orphans) if orphans else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("chain", nargs="?", help="a workflows/ chain file, or a link with --verify")
    ap.add_argument("--target", default=TARGET)
    ap.add_argument("--verify", action="store_true", help="decode a link instead of building one")
    ap.add_argument("--publish", action="store_true", help="write every chain's payload to packed/")
    ap.add_argument("--check", action="store_true", help="fail if packed/ is behind workflows/")
    ap.add_argument("--workflows", help="read chains from here instead of workflows/")
    ap.add_argument("--out", help="write payloads here instead of packed/; pair it with "
                                  "--workflows, since only a matched pair is pruned")
    ap.add_argument("--url", action="store_true",
                    help="emit a link addressing packed/ instead of carrying the payload")
    ap.add_argument("--ref", default="main", help="branch or SHA the --url link reads from")
    args = ap.parse_args()
    if args.publish or args.check:
        return publish(args.check,
                       Path(args.workflows) if args.workflows else None,
                       Path(args.out) if args.out else None)
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
