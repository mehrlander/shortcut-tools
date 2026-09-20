#!/usr/bin/env python3
"""Check that every shortcut an authored chain calls still exists on the device.

A row of output is one target name. Resolving a Run Shortcut card by name rather
than by `workflowIdentifier` is what makes a chain portable, and it trades a
device-local pointer for a string nothing validates: a target renamed or deleted
on the phone leaves a card that looks correct and resolves to nothing.

    python3 tools/targets.py                 # find the checkout, check it
    python3 tools/targets.py --private PATH  # name the checkout explicitly
    python3 tools/targets.py --all           # list the ones that resolve too

The checkout is resolved from --private, then $WEB_TOOLS_PRIVATE, then the
sibling ../web-tools-private, the same order `tools/freshness.py` uses. Exit
codes are its contract too: 0 everything resolves, 1 a target is absent (the
chains that call it are named), 2 no checkout, so a public-only clone should
skip rather than fail.

**It reads the newest manifest ALONE, and that is the whole point of it.**
`run.py`'s audit reads `index.json` and the newest manifest together, which is
right for the question it asks: a name installed since the last dump is missing
from the dump and present on the device, and the union stops it reading as
absent. The union cannot answer this question, because it is wrong in the other
direction. A name that WAS in the dump and has since been deleted from the phone
is still in the union, so it reads as present while every card naming it is
dead. On 2026-09-19 the dump was 28 days old and the two sets disagreed both
ways: 89 names on the device that no dump had seen, and 9 names in the dump that
the device no longer had.

The device's own list is the only source that can say a name is gone, so this
tool uses that and nothing else. The cost is stated rather than hidden: a target
installed since the newest manifest reads as absent here, which is a false
alarm, and syncing the manifest settles it.
"""

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def find_private(arg):
    for cand in (arg, os.environ.get("WEB_TOOLS_PRIVATE"), ROOT.parent / "web-tools-private"):
        if cand and (Path(cand) / "shortcuts" / "index.json").exists():
            return Path(cand)
    return None


def manifest_names(text):
    """The device's list, written in sections headed ==name==.

    Only the name section is read. The others describe other properties, and a
    blind parse would fold their values in as shortcut names.
    """
    out, in_names = set(), False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("==") and line.endswith("=="):
            in_names = line == "==name=="
            continue
        if in_names and line:
            out.add(line)
    return out


def newest_manifest(private):
    d = private / "shortcuts" / "manifests"
    files = sorted(p for p in d.glob("*.txt")) if d.is_dir() else []
    return files[-1] if files else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--private", help="path to the web-tools-private checkout")
    ap.add_argument("--all", action="store_true",
                    help="list every target, not only the ones that do not resolve")
    args = ap.parse_args()

    private = find_private(args.private)
    if not private:
        print("targets: no web-tools-private checkout, so the device list is unreadable",
              file=sys.stderr)
        return 2
    man = newest_manifest(private)
    if not man:
        print("targets: no manifests/*.txt in the checkout", file=sys.stderr)
        return 2
    on_device = manifest_names(man.read_text())

    catalog = json.loads((ROOT / "catalog.json").read_text())
    # A chain's target is either another authored chain, which this repo can
    # install and the catalog therefore holds, or an external name that exists
    # only because someone put it on the phone. Both are checked, and they fail
    # differently: an absent internal target is an install away, an absent
    # external one is a name nothing here can restore.
    authored = {r["name"] for r in catalog["rows"] if r.get("name")}
    callers, computed = {}, {}
    for row in catalog["rows"]:
        who = row.get("name") or row["file"]
        for t in (row.get("targets") or []):
            # A COMPUTED NAME IS NOT A NAME, and it has to be dropped rather
            # than checked. U+FFFC is the attachment placeholder a Text field
            # leaves where a value was interpolated, so a target carrying one is
            # decided at run time and no list of names can confirm or refute it.
            # `run.py`'s audit drops these for the same reason. Counted and
            # reported, because a target nothing can check is worth seeing once:
            # silently skipping it is how the set of unverifiable calls grows
            # without anyone noticing.
            if any(ord(ch) == 0xFFFC for ch in t):
                computed.setdefault(who, 0)
                computed[who] += 1
                continue
            callers.setdefault(t, []).append(who)

    absent = []
    for target in sorted(callers):
        kind = "chain" if target in authored else "external"
        ok = target in on_device
        if not ok:
            absent.append((target, kind))
        if args.all:
            print("  %-26s %-9s %s" % (target, kind, "on device" if ok else "ABSENT"))

    print("%d targets across %d chains, against %s (%d names)"
          % (len(callers), len(catalog["rows"]), man.name, len(on_device)))
    if computed:
        print("%d computed target%s not checkable: %s"
              % (sum(computed.values()), "" if sum(computed.values()) == 1 else "s",
                 ", ".join("%s (%d)" % (k, v) for k, v in sorted(computed.items()))))
    if not absent:
        print("every target resolves on the device")
        return 0

    # WHETHER ANYTHING CALLS THE CALLER, which is the difference between a
    # broken feature and dead code, and this tool did not say it. On 2026-09-19
    # it reported `Show-Repo` absent and named `Back-DoubleTap` as the caller,
    # and that read as a live breakage. `Back-DoubleTap` was an uncalled,
    # unbound predecessor, so the call was dead either way. One line of context
    # would have stopped an hour of chasing it.
    #
    # Reachability here is only what the catalog can see: a chain nothing in
    # `workflows/` calls may still be launched by a gesture, a share sheet or a
    # tap, so this says "nothing here calls it" and never "nothing runs it".
    called_here = {t for row in catalog["rows"] for t in (row.get("targets") or [])}

    for target, kind in absent:
        who = sorted(callers[target])
        print("\nABSENT  %s (%s)" % (target, kind))
        for name in who:
            # A self-call is its own answer, so it is named as one rather than
            # reported as a chain that calls itself and is not called.
            if [name] == who and name == target:
                note = "calls itself"
            elif name not in called_here:
                note = "nothing in workflows/ calls this one"
            else:
                note = ""
            print("        called by: %s%s" % (name, "  (%s)" % note if note else ""))
        if kind == "chain":
            print("        fix: install it, `python3 tools/plist.py workflows/… --link`")
        else:
            # The repo's own rule, and it is the reason this prints advice rather
            # than a patch: a stale by-name target is settled by asking what the
            # library HAS that does the job, not by recovering what the name used
            # to mean. The device cannot answer the second question either, since
            # a rename leaves no record on it.
            print("        fix: retarget the card, or reinstall the shortcut.")
            print("        Nothing here can restore it; decide what it should call.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
