#!/usr/bin/env python3
"""Turn a chain file into a complete workflow plist, ready to sign and import.

    python3 tools/plist.py workflows/<chain>.json        # one, to plists/
    python3 tools/plist.py --publish                     # every chain
    python3 tools/plist.py --check                       # fail if plists/ is behind
    python3 tools/plist.py <chain> --install [--ref B]   # the tappable install link

`pack.py` emits **actions to paste**; this emits **a shortcut to install**. The
difference is not convenience. `WFWorkflowTypes` and
`WFWorkflowInputContentItemClasses` live in the workflow file and nothing on the
clipboard reaches them, so Show in Share Sheet, the accepted input classes, and
the Apple Watch flag can only arrive this way. Confirmed on device 2026-08-15 by
importing `Capture-Link` with its share sheet already configured.

The envelope is copied from a real export rather than invented, `4711` and `900`
being what this device's Shortcuts writes.

**Two fields are derived, not authored.** `WFWorkflowHasShortcutInputVariables`
is true when any action references `ExtensionInput`, because a chain that reads
Shortcut Input and a file that says it does not is the mismatch that makes an
imported shortcut look broken for no visible reason. Everything else comes from
an optional `"workflow"` block in the chain file, which is how `capture-link`
asks for the share sheet.
"""
import argparse, json, plistlib, sys, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "plists"
RAW = "https://raw.githubusercontent.com/mehrlander/shortcut-tools"
IMPORT_TARGET = "Library-Import"

# Observed on a 2026 export. Not guessed: an envelope that disagrees with the
# client is the failure that presents as "the import sheet appeared and nothing
# happened".
ENVELOPE = {
    "WFQuickActionSurfaces": [],
    "WFWorkflowClientVersion": "4711",
    "WFWorkflowHasOutputFallback": False,
    "WFWorkflowIcon": {"WFWorkflowIconGlyphNumber": 61440,
                       "WFWorkflowIconStartColor": -314141441},
    "WFWorkflowImportQuestions": [],
    "WFWorkflowInputContentItemClasses": [],
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowTypes": [],
}


def shortcut_name(chain, path):
    """The name to install under, declared rather than derived.

    Deriving it from the label collided: 27 chains produced 24 files, three
    silently overwriting each other. Most chains are probes and demos meant to
    be pasted, not shortcuts meant to be installed, so a chain opts in by
    declaring `"name"`. `plists/` then holds receivers and nothing else.
    """
    return chain.get("name")


def uses_shortcut_input(actions):
    def walk(o):
        if isinstance(o, dict):
            if o.get("Type") == "ExtensionInput":
                return True
            return any(walk(v) for v in o.values())
        if isinstance(o, list):
            return any(walk(v) for v in o)
        return False
    return walk(actions)


def build(chain, path):
    wf = dict(ENVELOPE)
    wf["WFWorkflowActions"] = [
        {"WFWorkflowActionIdentifier": a["id"], "WFWorkflowActionParameters": a["p"]}
        for a in chain["actions"]]
    wf["WFWorkflowHasShortcutInputVariables"] = uses_shortcut_input(chain["actions"])
    wf.update(chain.get("workflow", {}))
    return wf


def render(path):
    chain = json.loads(Path(path).read_text())
    return shortcut_name(chain, path), plistlib.dumps(build(chain, path), fmt=plistlib.FMT_XML)


def install_link(chain_path, ref):
    """The tappable link that installs a chain's plist.

    `Library-Import` splits its input on new lines and reads item 1 as the
    shortcut name and item 2 as the plist URL, so the link is those two lines
    urlencoded. It exists for the same reason `pack.py --url` does: the README
    described the shape and nothing emitted it, so it was assembled by hand, and
    a hand-assembled link is one the reader cannot check.
    """
    name = json.loads(Path(chain_path).read_text()).get("name")
    if not name:
        raise SystemExit("%s declares no name, so it has no plist to install"
                         % Path(chain_path).name)
    if not (OUT / (name + ".plist")).is_file():
        raise SystemExit("no plists/%s.plist, run `python3 tools/plist.py --publish`" % name)
    body = "%s\n%s/%s/plists/%s.plist" % (name, RAW, ref, name)
    return "shortcuts://run-shortcut?name=%s&input=text&text=%s" % (
        IMPORT_TARGET, urllib.parse.quote(body, safe=""))


def chains():
    """Only the chains that declare a name: the installable receivers."""
    out = []
    for c in sorted((ROOT / "workflows").glob("*.json")):
        if json.loads(c.read_text()).get("name"):
            out.append(c)
    return out


def publish(check=False):
    OUT.mkdir(exist_ok=True)
    stale, seen = [], {}
    for c in chains():
        name, data = render(c)
        if name in seen:
            raise SystemExit("two chains both name themselves %r: %s and %s"
                             % (name, seen[name], c.name))
        seen[name] = c.name
        target = OUT / (name + ".plist")
        if check:
            if not target.exists() or target.read_bytes() != data:
                stale.append(target.relative_to(ROOT).as_posix())
        else:
            target.write_bytes(data)
    if check:
        if stale:
            raise SystemExit("stale, run `python3 tools/plist.py --publish`:\n  "
                             + "\n  ".join(stale))
        print("plists/ is current (%d)" % len(chains()), file=sys.stderr)
        return
    print("wrote %d plists to plists/" % len(chains()), file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("chain", nargs="?")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--install", action="store_true",
                    help="emit the Library-Import link for this chain's plist")
    ap.add_argument("--ref", default="main", help="branch or SHA the --install link reads from")
    args = ap.parse_args()
    if args.publish or args.check:
        return publish(args.check)
    if not args.chain:
        raise SystemExit("give a chain, or --publish")
    if args.install:
        return print(install_link(args.chain, args.ref))
    name, data = render(args.chain)
    OUT.mkdir(exist_ok=True)
    (OUT / (name + ".plist")).write_bytes(data)
    print("wrote plists/%s.plist (%d bytes)" % (name, len(data)), file=sys.stderr)


if __name__ == "__main__":
    main()
