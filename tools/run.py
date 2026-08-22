#!/usr/bin/env python3
"""Emit a tappable link that RUNS shortcuts, and optionally logs what came back.

    python3 tools/run.py Get-FromJs                  # one shortcut, no input
    python3 tools/run.py Get-FromJs --log            # run it, commit the result
    python3 tools/run.py Get-FileInfo Show-Table     # pipe one into the next
    python3 tools/run.py Show-Loop --text 'hello'    # bake the input in
    python3 tools/run.py --verify '<link>'           # read a link back

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

--log appends Log-Repo, which writes the payload to the clipboard first and
unconditionally, then commits it to shortcuts/log/ in web-tools-private. That
is the return channel: the reader taps once and the answer is already here.
"""
import argparse, sys, urllib.parse

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
    args = ap.parse_args()
    if args.verify:
        if not args.targets:
            raise SystemExit("give a link to verify")
        return verify(args.targets[0])
    link = build(args.targets, args.log, args.text)
    print(link)
    label = args.label or " then ".join(list(args.targets) + ([LOGGER] if args.log else []))
    # The chat client will not autolink a custom scheme and renders a code span
    # as dead text, so the markdown form is the only one that arrives tappable.
    print("\n[%s](%s)" % (label, link), file=sys.stderr)


if __name__ == "__main__":
    main()
