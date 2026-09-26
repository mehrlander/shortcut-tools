#!/usr/bin/env python3
"""A proposed hand edit to a device-only shortcut, as a page that shows where it goes.

    python3 tools/edit.py <Name> --after <index> <chain.json> [--ref <sha>]

A shortcut that exists only on the device cannot be replaced by paste
without losing its file settings (share sheet, input types, icon), so a
change to one is a hand edit: cards pasted at one place in the editor. This
applies the chain's cards to the newest exported copy of <Name>, after action
<index> as the sketch numbers it, and sketches the shortcut before and after.
Both listings travel gzipped in the fragment of web-tools'
pages/shortcut-edit.html, which draws the after listing with the added lines
marked and the place named, and offers the two taps the edit needs: put the
cards on the clipboard, and open the shortcut.

The page needs no token and no network beyond itself, so it works in Safari
beside the Shortcuts editor. Prints the page link; --payload prints the JSON.
"""
import argparse, base64, gzip, json, os, sys, urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import plist as P  # noqa: E402
import sketch as S  # noqa: E402

PAGE = "https://mehrlander.github.io/web-tools/pages/shortcut-edit.html"
RAW = "https://raw.githubusercontent.com/mehrlander/shortcut-tools/%s/packed/%s"


def private():
    for p in (os.environ.get("WEB_TOOLS_PRIVATE"), HERE.parent.parent / "web-tools-private"):
        if p and Path(p, "shortcuts", "dumps").is_dir():
            return Path(p)
    raise SystemExit("no web-tools-private checkout beside this one")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("chain", help="a workflows/ chain holding the cards to paste")
    ap.add_argument("--after", type=int, required=True, help="the sketch index the cards go after")
    ap.add_argument("--ref", default="main", help="the shortcut-tools ref the cards are fetched at")
    ap.add_argument("--payload", action="store_true")
    a = ap.parse_args()

    dumps = sorted(str(p) for p in (private() / "shortcuts" / "dumps").glob("*.zip"))
    got = S.load(dumps)
    if a.name not in got:
        raise SystemExit("%s is in no dump" % a.name)
    import plistlib
    doc = plistlib.loads(got[a.name])
    acts = doc["WFWorkflowActions"]
    if not 0 <= a.after < len(acts):
        raise SystemExit("--after %d is outside 0..%d" % (a.after, len(acts) - 1))

    chain = json.loads(Path(a.chain).read_text())
    cards = P.build(chain, a.chain)["WFWorkflowActions"]
    edited = dict(doc, WFWorkflowActions=acts[:a.after + 1] + cards + acts[a.after + 1:])

    body = {
        "name": a.name,
        "before": S.sketch(doc, annotate=True),
        "after": S.sketch(edited, annotate=True),
        "cards": RAW % (a.ref, Path(a.chain).name),
    }
    if a.payload:
        print(json.dumps(body, ensure_ascii=False, indent=1))
        return
    raw = gzip.compress(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode(), mtime=0)
    print(PAGE + "#gz=" + base64.urlsafe_b64encode(raw).decode().rstrip("="))


if __name__ == "__main__":
    main()
