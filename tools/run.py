#!/usr/bin/env python3
"""Emit a tappable link that RUNS shortcuts, and optionally logs what came back.

    python3 tools/run.py Get-FromJs                  # one shortcut, no input
    python3 tools/run.py Get-FromJs --log            # run it, commit the result
    python3 tools/run.py Get-FileInfo Show-Table     # pipe one into the next
    python3 tools/run.py Show-Loop --text 'hello'    # bake the input in
    python3 tools/run.py --verify '<link>'           # read a link back
    python3 tools/run.py --pick Describe-Input Show-Table   # a Run-Pick menu link
    python3 tools/run.py Get-FromJs --log --card     # the handover card, not a caption

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

Every link is audited before it is emitted: each name is checked against the
library index and the newest device manifest, and a name neither holds stops the
link. The shape is validated first, so a newline forging a step or a payload with
no slot is reported as itself rather than as a missing shortcut. --unchecked
skips the audit, which a name installed since the last dump needs. It says so on
stderr rather than passing silently, because the whole value of the check is that
a link nobody verified is indistinguishable from one that was.

--pick emits a Run-Pick link instead: the names become a menu on the device and
the chosen one runs on the clipboard. The audit above matters most here, because
a link's names are unchecked strings and this repository has already lost a
fortnight to two of them going stale. The manifest is what removes the false
positive for a shortcut installed since the last dump (Speak-Text, on
2026-09-05, was in no dump and in the 2026-09-02 manifest). One false positive
remains: a name computed at run time.

--card prints the handover card rather than the one-line caption: the header is
the receiver and the body is its payload unpacked, so a sequence shows every
step, marked and linked to its chain page, and a plain run shows one row. The
format and the reasoning are in web-tools skills/shortcut-links.

--log appends Log-Repo, which writes the payload to the clipboard first and
unconditionally, then commits it to shortcuts/log/ in web-tools-private. That
is the return channel: the reader taps once and the answer is already here.
"""
import argparse, json, os, sys, urllib.parse
from pathlib import Path

ICON = "📲"   # the surfacing mark for "run a shortcut"
PICKER = "Run-Pick"
INDEX = Path(__file__).resolve().parent.parent.parent / "web-tools-private" / "shortcuts" / "index.json"
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


def manifest_names(index=INDEX):
    """The names in the newest device manifest beside the index, or an empty set.

    The index is a snapshot of the last dump; the manifest is what the device
    said its library was at the last Sync-Manifest tap, usually later. A name
    in either is a name the device has had, so the audit reads both and the
    false positive for a shortcut installed since the dump goes away. A name
    in neither is still refused.
    """
    try:
        found = sorted((Path(index).parent / "manifests").glob("*.txt"))
        if not found:
            return set()
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "manifest_delta", Path(__file__).resolve().parent / "manifest-delta.py")
        md = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(md)
        return {r["name"] for r in md.parse_manifest(found[-1].read_text())}
    except Exception:
        return set()


def audit(names, index=INDEX):
    """Which of these names neither the library index nor the newest manifest holds.

    Returns None when there is no index to check against, which is different
    from "all present" and is reported that way: a silent search licenses "I did
    not find one", never "there is none".
    """
    try:
        have = {r["name"] for r in json.loads(Path(index).read_text())}
    except (OSError, ValueError, KeyError, TypeError):
        return None
    have |= manifest_names(index)
    return [n for n in names if n not in have]


def check(names, unchecked=False):
    """Refuse a link whose names the library cannot account for.

    This used to run only under --pick, while CLAUDE.md said `run.py` audits
    "every link it emits". A rule stated in prose and enforced on one path in
    three is the failure this estate keeps writing up: the cheaper statement was
    the weaker one, so a session (this one, 2026-09-16) credited an audit to a
    link that never had one.
    """
    if unchecked:
        print("names not audited; a stale one will fail at the point of use",
              file=sys.stderr)
        return
    missing = audit(names)
    if missing is None:
        print("no library index to check names against; the link is still emitted",
              file=sys.stderr)
    elif missing:
        raise SystemExit(
            "not in the library index: %s\n"
            "A link's names are unchecked strings and a stale one fails at the "
            "point of use. The index and the newest device manifest were both "
            "read; the one false positive left is a name computed at run time. "
            "Pass --unchecked to send it anyway."
            % ", ".join(missing))


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


def step_row(name, first):
    """One step of a sequence card: the mark, then the name, all in one span.

    The mark is the whole notation. A step after the first runs on the one above
    it, which is exactly what Run-Steps does, and no index appears because
    nothing in a step list refers back.

    No chain page here. A step is a shortcut already on the phone, so a link
    invites reading where the card exists to remove it, and half of these names
    could not carry one anyway: sixteen names the chains here call are held in no
    chain file, and a directly addressed receiver can be device-only (`Open-URL`,
    `Fav-Settings`). A list where some names are tappable and some are not reads
    as an error. The page belongs to the install card, which is the one tap that
    leaves something behind.
    """
    return "`%s %s`" % ("\u25b8" if first else "\u21b3", name)


def card(link, steps, receiver, label=None):
    """The handover card, which is the format the reader actually meets.

    One table per tap. The header is the receiver and the body is its payload
    unpacked, so a sequence shows its steps and a plain run shows nothing: there
    is no body when the payload is data rather than a reference. Every step
    prints, the logger included. A display of a payload that omits part of the
    payload is the failure this format exists to prevent.

    The rules and the other two shapes are in web-tools skills/shortcut-links.
    """
    rows = ["| %s [%s](%s) |" % (ICON, label or receiver, link)]
    if len(steps) > 1:
        rows.append("| --- |")
        rows.append("| %s |" % "<br>".join(
            step_row(n, i == 0) for i, n in enumerate(steps)))
    return "\n".join(rows)


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
    ap.add_argument("--unchecked", action="store_true",
                    help="emit the link without auditing the names")
    ap.add_argument("--card", action="store_true",
                    help="print the handover card instead of the one-line caption")
    args = ap.parse_args()
    if args.verify:
        if not args.targets:
            raise SystemExit("give a link to verify")
        return verify(args.targets[0])
    if args.pick:
        if args.card:
            # A menu is not a pipeline: its names are alternatives, so neither
            # the marks nor the order mean what they mean on a sequence card.
            # That shape is not settled, and inventing notation is the one thing
            # the card format forbids.
            raise SystemExit("--card has no shape for a %s menu yet; "
                             "send the one-line caption" % PICKER)
        if args.text or args.log:
            raise SystemExit("--pick takes its payload from the clipboard, so "
                             "--text and --log have no slot; run those separately")
        link = pick_link(args.targets)
        check(args.targets, args.unchecked)
        print(link)
        print("\n%s\n" % markdown(link, args.targets,
                                   label=args.label or " · ".join(args.targets)),
              file=sys.stderr)
        return
    link = build(args.targets, args.log, args.text)
    steps = list(args.targets) + ([LOGGER] if args.log else [])
    check(steps, args.unchecked)
    print(link)
    # stdout stays the link, always, so a caller piping this is unaffected by
    # which caption shape was asked for.
    if args.card:
        receiver = CHAIN if len(steps) > 1 else steps[0]
        head = args.label
        if head is None and len(steps) == 1 and args.text is not None:
            head = "%s: %s" % (steps[0], args.text)
        print("\n%s\n" % card(link, steps, receiver, head), file=sys.stderr)
    else:
        print("\n%s\n" % markdown(link, args.targets, args.log, args.label), file=sys.stderr)


if __name__ == "__main__":
    main()
