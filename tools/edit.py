#!/usr/bin/env python3
"""A proposed hand edit to a device-only shortcut, as a page that shows where it goes.

    python3 tools/edit.py <Name> --after <index> <chain.json> [--why "<reason>"] [--ref <sha>]

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

--save writes the proposal to proposals/<Name>-<date>.json instead, and prints
the short link to it. A saved proposal is what the app's Edits view lists,
and it carries two action-type sequences, `base` (the shortcut as exported)
and `expect` (with the cards in place), so the page can tell from the next
export whether the edit has been made: that export matches `expect`, still
matches `base`, or differs from both at a line it names.
"""
import argparse, base64, datetime, gzip, json, os, sys, urllib.parse
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
    ap.add_argument("--why", default="", help="one or two sentences on why, shown under the added cards")
    ap.add_argument("--payload", action="store_true")
    ap.add_argument("--save", action="store_true", help="write proposals/<Name>-<date>.json and print its link")
    ap.add_argument("--dir", default=str(HERE.parent / "proposals"), help="where --save writes")
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
    if a.why:
        body["why"] = a.why
    ids = lambda xs: [x["WFWorkflowActionIdentifier"] for x in xs]
    body["base"] = ids(acts)
    body["expect"] = ids(edited["WFWorkflowActions"])
    if a.save:
        day = datetime.date.today().isoformat()
        body["created"] = day
        name = "%s-%s.json" % (a.name.replace("/", ":").replace(" ", "-"), day)
        out = Path(a.dir) / name
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps(body, ensure_ascii=False, indent=1) + "\n")
        print(PAGE + "?proposal=" + urllib.parse.quote(name))
        return
    if a.payload:
        print(json.dumps(body, ensure_ascii=False, indent=1))
        return
    raw = gzip.compress(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode(), mtime=0)
    print(PAGE + "#gz=" + base64.urlsafe_b64encode(raw).decode().rstrip("="))


if __name__ == "__main__":
    main()
