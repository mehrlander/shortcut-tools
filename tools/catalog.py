#!/usr/bin/env python3
"""One row per chain, so a page can render the set without fetching 75 files.

    python3 tools/catalog.py --publish     # write catalog.json
    python3 tools/catalog.py --check       # fail if it is behind workflows/

WHY THIS EXISTS. `plists/builds.json` says which chains are installable and what
build each is at, and nothing else says anything. A reader who wants to know what
this repo actually contains has two routes: read `workflows/README.md`, which is
12,500 words organised by the date each thing was discovered, or open 75 JSON
files. Neither is a surface, which is why the answer to "is there a home base for
the shortcuts" was no.

So the display gets a structured stage rather than judgment smeared into a
render: a committed table derived mechanically from the chains, and a --check
that re-derives it and fails when it drifts. The page reads one file.

WHAT A ROW CARRIES. Only what the chain files state. `name` is the installable
name, absent on the probes and demos that never become shortcuts. `targets` is
every shortcut this chain calls BY NAME, which is the call graph and also the
audit surface: a name here that the library does not hold is a card that looks
correct and resolves to nothing. Reading them takes two passes, because a router
keeps its targets as dictionary values where `WFWorkflowName` never looks, which
is the whole cost of routing through a map rather than a ladder of Run Shortcut
cards.

WHAT IT DOES NOT CARRY. Anything about the device. Whether a chain is installed,
which build is on the phone, and when it last ran are facts about a device and
live in `shortcuts/log/` in web-tools-private. Joining the two is the page's job,
and keeping the join out of here is what lets this file be deterministic.
"""
import argparse, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pack import build_id                      # one hash, shared with both mirrors
from plist import build as plist_build         # the chain as the document it installs as
import plistlib
from sketch import sketch as sketch_lines

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / "workflows"
OUT = ROOT / "catalog.json"


ROUTE_LINE = re.compile(r"^\[[^\]\n]+\]=(.+)$", re.M)


def targets(chain):
    """Every shortcut this chain calls by name, all three carriers, sorted."""
    found = set()
    for a in chain.get("actions", []):
        p = a.get("p", {})
        n = p.get("WFWorkflowName")
        if isinstance(n, str):
            found.add(n)
        # A dictionary's items, when WFItems carries one. It is also a plain
        # list on the list actions, so the shape is checked rather than assumed.
        wf = p.get("WFItems")
        items = []
        if isinstance(wf, dict):
            val = wf.get("Value")
            if isinstance(val, dict):
                items = val.get("WFDictionaryFieldValueItems") or []
        for item in items:
            if not isinstance(item, dict):
                continue
            v = item.get("WFValue", {}).get("Value", {})
            v = v.get("string") if isinstance(v, dict) else None
            if isinstance(v, str):
                found.add(v)
        # THIRD CARRIER. A route block is a Text action of `[key]=Shortcut-Name`
        # lines, read back with a lookbehind match: Get-AppRoute has done this
        # since before the audit existed, and Route-Gesture does it now. The name
        # is a substring of a literal, so neither WFWorkflowName nor a dictionary
        # value sees it, and the Run Shortcut card that consumes it carries a
        # computed name this audit deliberately drops. Without this, the five
        # shortcuts Get-AppRoute dispatches to were invisible to every check here.
        text = p.get("WFTextActionText")
        if isinstance(text, str):
            for m in ROUTE_LINE.finditer(text):
                found.add(m.group(1).strip())
    return sorted(found)


def listing(chain, path):
    """The chain as readable lines, so a page can render it without a plist parser.

    The page that reads this catalog wants to show what a shortcut contains, and
    the only other route is parsing an XML plist in the browser. This is the
    repo's usual answer instead: land the mechanical extraction in committed
    structured data and let the display read rows. Rendered through the same
    plist the installer sends and the same sketch the handover card prints, so
    the page cannot disagree with either.
    """
    try:
        doc = plistlib.loads(plistlib.dumps(plist_build(chain, str(path))))
    except Exception:
        return []
    return sketch_lines(doc, None, annotate=True).split("\n")


def row(path):
    chain = json.loads(path.read_text())
    return {
        "file": path.name,
        "label": chain.get("label"),
        "name": chain.get("name"),
        "actions": len(chain.get("actions", [])),
        "build": build_id(chain),
        "settings": bool(chain.get("workflow")),
        "targets": targets(chain),
        "sketch": listing(chain, path),
    }


def rows():
    return sorted((row(p) for p in WORKFLOWS.glob("*.json")),
                  key=lambda r: r["file"])


def render():
    data = rows()
    named = [r for r in data if r["name"]]
    # Every name any chain calls, minus every name this repo publishes: the
    # targets that must come from the wider library rather than from here.
    declared = {r["name"] for r in named}
    # A target carrying U+FFFC is a variable, not a string: the name is computed
    # at run time and no audit can check it. It is dropped here rather than
    # reported as a library name nobody has, which is the one false positive the
    # by-name audit cannot remove.
    every = {t for r in data for t in r["targets"] if "\ufffc" not in t}
    outside = sorted(every - declared)
    doc = {
        "meta": {"chains": len(data), "installable": len(named),
                 "external_targets": len(outside)},
        "external_targets": outside,
        "rows": data,
    }
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    text = render()
    if args.check:
        have = OUT.read_text() if OUT.exists() else ""
        if have != text:
            print("catalog.json is behind workflows/; run: python3 tools/catalog.py --publish",
                  file=sys.stderr)
            raise SystemExit(1)
        print("catalog.json is current", file=sys.stderr)
        return
    if args.publish:
        OUT.write_text(text)
        doc = json.loads(text)
        print("wrote catalog.json (%d chains, %d installable)"
              % (doc["meta"]["chains"], doc["meta"]["installable"]), file=sys.stderr)
        return
    sys.stdout.write(text)


if __name__ == "__main__":
    main()
