#!/usr/bin/env python3
"""Read what Dump-Recent or Dump-Named committed, and fold it into the pipeline.

    python3 tools/read-incoming.py <incoming.txt>              # what is in it
    python3 tools/read-incoming.py <incoming.txt> --zip out.zip # as a dump
    python3 tools/read-incoming.py --latest                     # newest committed

A device dump arrives as marker text, one record per shortcut:

    ==shortcut==
    Show-Table
    ==modified==
    2026-08-13T09:14:00-07:00
    ==json==
    { … the whole workflow … }

**Row-major here, unlike a manifest, and the difference is structural rather
than stylistic.** A manifest is built by one Text action over the whole list, so
Shortcuts expands each field into its own column; these records are built inside
a Repeat, so the template runs once per shortcut and the fields stay together.
That also means the empty-value collapse that cost the manifest its `folder`
column cannot happen here: nothing is being zipped by position.

`Dump-Recent` caps itself at 60 records because a time window, unlike a count,
can name the whole library; a dump that arrives at exactly the cap is flagged
here, since the chain itself has no way to report what it left behind.

`--zip` writes one `.wflow` per shortcut in exactly the shape
`workflows/dump-folder-zip.json` produces, which is what makes this worth
having. The output goes straight into the existing pipeline:

    python3 tools/read-incoming.py incoming.txt --zip recent.zip
    python3 tools/index-dump.py shortcuts/dumps/*.zip recent.zip --json index.json

The name is carried in the zip entry name because **a shortcut's plist does not
contain its own name**, the same reason `restore.py` cannot give a name back and
`index-dump.py` reads one from the entry. A `/` in a name becomes `:` on the way
in, matching what a device-made dump does, so the corpus keeps one spelling.
"""

import argparse
import json
import os
import plistlib
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Dump-Recent's own safety cap. A time window is not self-limiting: widen it far
# enough and the PUT is the whole library, so the chain takes the newest 60 and
# stops. A dump arriving at exactly that many is the shape of a truncation, and
# saying so is the only way the reader can tell: the chain has no channel to
# report what it dropped.
DUMP_RECENT_CAP = 60


def find_private(arg):
    for cand in (arg, os.environ.get("WEB_TOOLS_PRIVATE"), ROOT.parent / "web-tools-private"):
        if cand and (Path(cand) / "shortcuts" / "index.json").exists():
            return Path(cand)
    return None


def parse_dump(text):
    """Marker text to records, tolerant of which dumper wrote it.

    Dump-Named emits `==shortcut==`/`==json==` and Dump-Recent adds
    `==modified==` between them. Reading both the same way costs one optional
    field and means the two chains never need to agree on a version.
    """
    records = []
    for chunk in text.split("==shortcut==")[1:]:
        parts = re.split(r"^==(modified|json)==$", chunk, flags=re.M)
        rec = {"name": parts[0].strip(), "modified": "", "json": ""}
        for key, val in zip(parts[1::2], parts[2::2]):
            rec[key] = val.strip()
        if rec["name"] and rec["json"]:
            records.append(rec)
    return records


def to_plist(rec):
    """One record's JSON as an XML plist, or a reason it is not one."""
    try:
        obj = json.loads(rec["json"])
    except json.JSONDecodeError as e:
        return None, "not JSON (%s)" % e
    if not isinstance(obj, dict) or "WFWorkflowActions" not in obj:
        return None, "JSON is not a workflow (no WFWorkflowActions)"
    try:
        return plistlib.dumps(obj, fmt=plistlib.FMT_XML), None
    except (TypeError, OverflowError) as e:
        return None, "will not serialize as a plist (%s)" % e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dump", nargs="?", help="an incoming .txt; omit with --latest")
    ap.add_argument("--latest", action="store_true",
                    help="use the newest file in shortcuts/incoming/")
    ap.add_argument("--private", help="path to a web-tools-private checkout")
    ap.add_argument("--zip", dest="zip_out", help="write the shortcuts as a dump zip")
    args = ap.parse_args()

    if args.latest:
        private = find_private(args.private)
        if not private:
            print("no web-tools-private checkout", file=sys.stderr)
            return 2
        found = sorted((private / "shortcuts" / "incoming").glob("*.txt"))
        if not found:
            print("nothing in shortcuts/incoming/ yet", file=sys.stderr)
            return 2
        path = found[-1]
    elif args.dump:
        path = Path(args.dump)
    else:
        ap.error("give a dump path or --latest")

    records = parse_dump(path.read_text())
    if not records:
        print("%s parsed to zero records; is it a dump?" % path.name, file=sys.stderr)
        return 1

    good, bad = [], []
    for rec in records:
        data, why = to_plist(rec)
        (bad if why else good).append((rec, why or data))

    print("%s: %d shortcut(s), %d KB" % (path.name, len(records), len(path.read_text()) // 1024))
    for rec, data in good:
        obj = json.loads(rec["json"])
        print("  %-38s %4d actions  %s" % (rec["name"], len(obj["WFWorkflowActions"]),
                                           rec["modified"][:16]))
    for rec, why in bad:
        print("  %-38s UNREADABLE: %s" % (rec["name"], why))

    if len(records) == DUMP_RECENT_CAP:
        print("\n%d records, exactly Dump-Recent's cap: the window probably held more "
              "than this. Narrow it, or take a full dump." % DUMP_RECENT_CAP)
    if args.zip_out:
        if bad:
            print("\nrefusing to write a zip with %d unreadable record(s); fix or "
                  "re-dump those first" % len(bad), file=sys.stderr)
            return 1
        with zipfile.ZipFile(args.zip_out, "w", zipfile.ZIP_DEFLATED) as z:
            for rec, data in good:
                z.writestr(rec["name"].replace("/", ":") + ".wflow", data)
        print("\nwrote %s (%d shortcuts). Fold it in with:\n"
              "  python3 tools/index-dump.py <dumps>/*.zip %s --json <index.json>"
              % (args.zip_out, len(good), args.zip_out))
    if bad:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
