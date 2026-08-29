#!/usr/bin/env python3
"""Emit a tappable link that RUNS shortcuts, and optionally logs what came back.

    python3 tools/run.py Get-FromJs                  # one shortcut, no input
    python3 tools/run.py Get-FromJs --log            # run it, commit the result
    python3 tools/run.py Get-FileInfo Show-Table     # pipe one into the next
    python3 tools/run.py Show-Loop --text 'hello'    # bake the input in
    python3 tools/run.py --verify '<link>'           # read a link back
    python3 tools/run.py --pick Describe-Input Show-Table   # a Run-Pick menu link

The other emitters here each address one fixed receiver: pack.py sends actions
to Copy-ActionFromClaude, show.py sends a page to Show-Html. Nothing emitted a
link that simply runs a named shortcut, so every diagnostic ended by asking the
reader to open the Shortcuts app and find it, which is the in-app work this
repository exists to remove. A link the sender did not type is the whole point,
same as pack.py's --url.

Two or more targets, or --log, route through Run-Steps, which splits its input
on newlines and runs each name in turn with the previous result as input
(workflows/run-steps.json). Its first pass has no Carry set, so the first
shortcut runs with no input, which is what a bare diagnostic wants.

--pick emits a Run-Pick link instead: the names become a menu on the device and
the chosen one runs on the clipboard. It CHECKS each name against the library
index first, because a link's names are unchecked strings and this repository has
already lost a fortnight to two of them going stale. Two false positives to
expect, both from the index being a snapshot: anything installed since the last
dump, and any name computed at run time.

--log appends Log-Repo, which writes the payload to the clipboard first and
unconditionally, then commits it to shortcuts/log/ in web-tools-private. That
is the return channel: the reader taps once and the answer is already here.
"""
import argparse, json, os, sys, urllib.parse
from pathlib import Path

ICON = "📲"
PICKER = "Run-Pick"
INDEX = Path(__file__).resolve().parent.parent.parent / "web-tools-private" / "shortcuts" / "index.json"  # 📲, the surfacing mark for "run a shortcut"
CHAIN = "Run-Steps"
LOGGER = "Log-Repo"
SCHEME = "shortcuts://run-shortcut?name=%s&input=text&text=%s"
BARE = "shortcuts://run-shortcut?name=%s"


def build(targets, log=False, text=None):
    """The link. Emitting it is the only supported way to obtain one."""
    if not targets:
        raise SystemExit("name at least one shortcut to run")
    for name in targets:
        if "\n" in name:
            raise SystemExit("a shortcut name cannot contain a newline: %r" % name)
    steps = list(targets) + ([LOGGER] if log else [])
    if len(steps) == 1:
        if text is None:
            # Not SCHEME with an empty text: an empty string is a value, and
            # every diagnostic here branches on "input has no value", so a
            # trailing text= would send the shortcut down its other path.
            return BARE % urllib.parse.quote(steps[0], safe="")
        return SCHEME % (urllib.parse.quote(steps[0], safe=""),
                         urllib.parse.quote(text, safe=""))
    if text is not None:
        # Run-Steps consumes its input as the step list, so there is no slot
        # left for a payload. Refusing beats emitting a link that runs and
        # silently drops the value the sender meant to bake in.
        raise SystemExit("--text cannot ride a multi-step link: %s takes the step "
                         "list as its own input. Send one target, or wrap the "
                         "payload in a chain of its own." % CHAIN)
    return SCHEME % (urllib.parse.quote(CHAIN, safe=""),
                     urllib.parse.quote("\n".join(steps), safe=""))


def audit(names, index=INDEX):
    """Which of these names the library index does not hold.

    Returns None when there is no index to check against, which is different
    from "all present" and is reported that way: a silent search licenses "I did
    not find one", never "there is none".
    """
    try:
        have = {r["name"] for r in json.loads(Path(index).read_text())}
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return [n for n in names if n not in have]


def pick_link(names):
    """A Run-Pick link: the names are the menu, the clipboard is the payload."""
    if not names:
        raise SystemExit("name at least one verb for the menu")
    for n in names:
        if "\n" in n:
            raise SystemExit("a shortcut name cannot contain a newline: %r" % n)
    return SCHEME % (PICKER, urllib.parse.quote("\n".join(names), safe=""))


def markdown(link, targets, log=False, label=None):
    """The handover form, which is the only one that arrives tappable.

    Two rules from SURFACING.md, both of which fail silently when dropped. The
    chat client will not autolink a custom scheme and renders a code span as
    dead text, so a bare or fenced link is dead on arrival. And a run link
    carries the icon, so the reader can see at a glance that something is being
    asked of the device rather than offered to read. Emitted here rather than
    remembered, for the same reason the link itself is.
    """
    name = label or " then ".join(list(targets) + ([LOGGER] if log else []))
    return "%s [%s](%s)" % (ICON, name, link)


def verify(link):
    """Read a link back. Run this on the exact text about to be sent.

    A retyped or shortened link still looks well formed, so the only honest
    check is decoding the string that is actually going out.
    """
    if not link.startswith("shortcuts://run-shortcut?"):
        raise SystemExit("not a run-shortcut link")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(link).query, keep_blank_values=True)
    name = (q.get("name") or [""])[0]
    text = (q.get("text") or [""])[0]
    print("receiver: %s" % name)
    if name == CHAIN:
        for i, step in enumerate(text.split("\n"), 1):
            print("  %d. %s" % (i, step))
    elif name == PICKER:
        # A pick link's input is a menu, not a pipeline: reading it back as one
        # blob hides a name split across lines, which is the failure the audit
        # exists to catch.
        for step in text.split("\n"):
            print("  - %s" % step)
    elif text:
        print("  input: %s" % text)
    else:
        print("  (no input)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("targets", nargs="*", help="shortcut names, run in order")
    ap.add_argument("--log", action="store_true",
                    help="append %s so the result comes back to the repo" % LOGGER)
    ap.add_argument("--text", help="input to bake into a single-target link")
    ap.add_argument("--verify", action="store_true", help="decode a link instead of building one")
    ap.add_argument("--label", help="caption for the markdown form")
    ap.add_argument("--pick", action="store_true",
                    help="emit a Run-Pick menu link over the named verbs")
    args = ap.parse_args()
    if args.verify:
        if not args.targets:
            raise SystemExit("give a link to verify")
        return verify(args.targets[0])
    if args.pick:
        if args.text or args.log:
            raise SystemExit("--pick takes its payload from the clipboard, so "
                             "--text and --log have no slot; run those separately")
        missing = audit(args.targets)
        if missing is None:
            print("no library index to check names against; the link is still emitted",
                  file=sys.stderr)
        elif missing:
            raise SystemExit(
                "not in the library index: %s\n"
                "A link's names are unchecked strings and a stale one fails at the "
                "point of use. Two false positives, both from the index being a "
                "snapshot: anything installed since the last dump, and any name "
                "computed at run time." % ", ".join(missing))
        link = pick_link(args.targets)
        print(link)
        print("\n%s\n" % markdown(link, args.targets,
                                   label=args.label or " · ".join(args.targets)),
              file=sys.stderr)
        return
    link = build(args.targets, args.log, args.text)
    print(link)
    print("\n%s\n" % markdown(link, args.targets, args.log, args.label), file=sys.stderr)


if __name__ == "__main__":
    main()
