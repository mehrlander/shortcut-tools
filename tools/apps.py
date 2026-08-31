#!/usr/bin/env python3
"""Build the app registry: what is installed, what is scripted, what is documented.

    python3 tools/apps.py <dump.zip> [...] [--names FILE] [--catalog TOOLKIT]
                          [--json OUT] [--targets]

One row per app, joining three sources that answer different questions and
disagree on purpose:

| Source | Key it supplies | Answers |
| --- | --- | --- |
| `installed` | a **name**, from screenshots | is it on the phone |
| `picker` | a **bundle id**, from `WFSelectedApp` | do my shortcuts open it |
| `vendor` | a **bundle id**, from action identifier prefixes | do my shortcuts call its actions |
| `toolkit` | a bundle id, from the ToolKit catalog | can a session describe its actions without a tap |

**Screenshots give names and the corpus gives bundle ids, so the join is by
name and it is lossy.** An unmatched name is not an error, it is the finding:
an app you own and have never scripted. Matching is case- and
punctuation-insensitive because a Home Screen label and a `WFSelectedApp`
`Name` are written by different parts of iOS and disagree over spaces,
ampersands and the leading LTR mark WhatsApp carries.

Why a registry rather than one read of the screenshots: `is.workflow.actions.filter.apps`
is Mac-only (established on device 2026-08-30, see docs/shortcuts-format-notes.md),
so nothing on iOS can regenerate the installed column. It has to be captured and
kept, and kept means dated, since it decays with every install.
"""
import argparse, collections, glob, json, plistlib, re, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def fold(name):
    """A join key tolerant of how two parts of iOS write one app's name."""
    return re.sub(r"[^a-z0-9]", "", (name or "").replace("&", "and").lower())


def walk(node, hit):
    """Every app-picker dict under an action's parameters, however nested."""
    if isinstance(node, dict):
        if "BundleIdentifier" in node:
            hit.append((node.get("BundleIdentifier"), node.get("Name")))
        for v in node.values():
            walk(v, hit)
    elif isinstance(node, (list, tuple)):
        for v in node:
            walk(v, hit)


def from_corpus(zips):
    """picked / vends counts and the best name seen for each bundle id."""
    picked, vends, names = collections.Counter(), collections.Counter(), {}
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            for member in zf.namelist():
                if not member.endswith(".wflow"):
                    continue
                try:
                    doc = plistlib.loads(zf.read(member))
                except Exception:
                    continue
                for action in doc.get("WFWorkflowActions", []):
                    ident = action.get("WFWorkflowActionIdentifier", "")
                    if ident and not ident.startswith("is.workflow.actions"):
                        vends[".".join(ident.split(".")[:3])] += 1
                    hit = []
                    walk(action.get("WFWorkflowActionParameters", {}), hit)
                    for bundle, name in hit:
                        if not bundle:
                            continue
                        picked[bundle] += 1
                        if name and not names.get(bundle):
                            names[bundle] = name.strip("‎‏ ")
    return picked, vends, names


def from_catalog(paths):
    """bundle id -> how many of its actions the ToolKit catalog documents."""
    known = collections.Counter()
    for p in paths:
        ids = json.loads(Path(p).read_text()).get("ids", [])
        for i in ids:
            if not i.startswith("is.workflow.actions"):
                known[".".join(i.split(".")[:3])] += 1
    return known


def from_bundle(bundle):
    """A display name for a row the picker never named: the last component,
    camelCase split back into words. `dk.simonbs.DataJar` -> `Data Jar`,
    which folds onto a screenshot's `Data Jar`. Vendor-only rows exist because
    an action identifier carries a bundle id and never a label."""
    tail = bundle.split(".")[-1]
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", tail).replace("-", " ").strip()


def build(zips, names_file=None, catalogs=(), seen=None, aliases=None):
    picked, vends, names = from_corpus(zips)
    toolkit = from_catalog(catalogs)

    alias = aliases or {}
    rows = {}
    for bundle in set(picked) | set(vends):
        rows[bundle] = {
            "bundle_id": bundle,
            "name": alias.get(bundle) or names.get(bundle) or from_bundle(bundle),
            "installed": None,          # unknown until a screenshot says so
            "picked_in_actions": picked.get(bundle, 0),
            "actions_used": vends.get(bundle, 0),
            "toolkit_actions": toolkit.get(bundle, 0),
        }

    # The screenshot pass: names only, joined onto the bundle ids above.
    unmatched = []
    if names_file:
        # One label can belong to several bundle ids: Apple ships both
        # com.apple.mobilenotes and com.apple.Notes as "Notes", and a screenshot
        # cannot tell them apart. Mark every row that answers to the name, or
        # the capture silently leaves duplicates looking unproven.
        by_fold = {}
        for b, r in rows.items():
            if r["name"]:
                by_fold.setdefault(fold(r["name"]), []).append(b)
        for line in Path(names_file).read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            hits = by_fold.get(fold(line), [])
            for b in hits:
                rows[b]["installed"] = True
            if not hits:
                unmatched.append(line)
        for name in unmatched:
            rows["?" + fold(name)] = {
                "bundle_id": None, "name": name, "installed": True,
                "picked_in_actions": 0, "actions_used": 0, "toolkit_actions": 0,
            }
        # And nothing is set False. Settings -> Apps omits system apps such as
        # SpringBoard and Camera, and a pass can miss a screen, so a name the
        # capture did not carry is unproven rather than absent. The column
        # answers "seen installed", and its only values are True and unknown.

    return {
        "generated": seen or "",
        "sources": {"dumps": [Path(z).name for z in zips],
                    "names": Path(names_file).name if names_file else None,
                    "catalogs": [Path(c).name for c in catalogs]},
        "apps": sorted(rows.values(), key=lambda r: (r["name"] or "~").lower()),
    }


def targets(reg):
    """Vendors whose actions are used here and which no catalog documents.

    The shot list for the action-picker pass: everything else is either already
    described in the catalog or not a vendor of actions at all.
    """
    return [r for r in reg["apps"]
            if r["actions_used"] and not r["toolkit_actions"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zips", nargs="*")
    ap.add_argument("--names", help="one app name per line, read off screenshots")
    ap.add_argument("--catalog", action="append", default=[],
                    help="a toolkit-vNN-tool-ids.json; repeatable")
    ap.add_argument("--json", dest="out", help="write the registry here")
    ap.add_argument("--targets", action="store_true",
                    help="print the action-picker shot list and stop")
    ap.add_argument("--aliases", default=str(ROOT / "tools" / "apps-aliases.json"),
                    help="bundle id -> display name, where neither the picker "
                         "nor the bundle id folds onto the screenshot label")
    ap.add_argument("--date", default="", help="stamp the registry with this date")
    args = ap.parse_args()

    zips = [z for pat in (args.zips or []) for z in sorted(glob.glob(pat))]
    if not zips:
        ap.error("no dumps given")
    apath = Path(args.aliases)
    alias = json.loads(apath.read_text()).get("aliases", {}) if apath.is_file() else {}
    reg = build(zips, args.names, args.catalog, args.date, alias)

    if args.targets:
        rows = targets(reg)
        print("%d vendors used here with no catalog entry:" % len(rows))
        for r in rows:
            print("  %-42s %-22s %d action%s in the corpus"
                  % (r["bundle_id"], r["name"] or "-", r["actions_used"],
                     "" if r["actions_used"] == 1 else "s"))
        return

    if args.out:
        Path(args.out).write_text(json.dumps(reg, indent=1, ensure_ascii=False) + "\n")
        print("wrote %s: %d apps" % (args.out, len(reg["apps"])))
    else:
        json.dump(reg, sys.stdout, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
