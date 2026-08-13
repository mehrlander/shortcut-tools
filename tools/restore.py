#!/usr/bin/env python3
"""Turn an archived shortcut back into a link that pastes it.

    python3 tools/restore.py <dump.zip …> <Name>        # one paste link
    python3 tools/restore.py <dump.zip …> --list        # what is in the archive
    python3 tools/restore.py <dump.zip …> <Name> --chain  # the chain file instead

This is the answer to "is it safe to delete these off the phone." The archive
holds unsigned plists, and iOS will not import one: there is no open-this-file
route back. What there is is the paste route this repository already runs on.
`unpack.py` turns the plist into a chain and `pack.py` turns the chain into a
link that `Copy-ActionFromClaude` puts on the clipboard, and the round trip is
exact: parameters compare equal action for action.

Three things it does not restore, and they are the reason a delete is a
decision rather than a formality:

- **The name.** A shortcut's plist does not contain it (see
  docs/shortcuts-format-notes.md). The archive keeps it in the zip entry name,
  and this prints it, but on the device you type it into a new shortcut. A
  caller resolves its target by name, so a typo is a broken call.
- **Everything outside the plist.** Home Screen icons, widget slots, share
  sheet and Siri configuration, and any personal automation that fires the
  shortcut. None of it is in an export.
- **What was never dumped.** A name this archive does not hold cannot come
  back from it. Run --list first.

The link carries the payload rather than an address, because a private
archive's raw URL 404s unauthenticated and `Copy-ActionFromUrl` sends no
credential. A large shortcut therefore makes a large link: tap it, never
retype it.
"""
import argparse, json, sys, zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pack as packer
import unpack as unpacker


def entries(paths):
    """Every shortcut in the archive, by name, first dump wins."""
    out = {}
    for path in paths:
        z = zipfile.ZipFile(path)
        for info in z.infolist():
            if info.is_dir():
                continue
            name = info.filename
            if not info.flag_bits & 0x800:
                try:
                    name = name.encode("cp437").decode("utf-8")
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
            name = name.rsplit(".", 1)[0]
            out.setdefault(name, (path, info))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip", nargs="+", help="dump zips, then the shortcut name")
    ap.add_argument("--list", action="store_true", help="print what the archive holds")
    ap.add_argument("--chain", action="store_true", help="emit the chain file, not a link")
    args = ap.parse_args()

    paths, name = args.zip, None
    if not args.list:
        paths, name = args.zip[:-1], args.zip[-1]
        if not paths:
            raise SystemExit("give at least one dump zip and a shortcut name")

    found = entries(paths)
    if args.list:
        for n in sorted(found):
            print(n)
        print("%d shortcuts" % len(found), file=sys.stderr)
        return

    if name not in found:
        near = sorted(n for n in found if name.lower() in n.lower())
        raise SystemExit("no %r in the archive%s" % (
            name, ("; did you mean: " + ", ".join(near[:8])) if near else ""))

    path, info = found[name]
    import plistlib
    doc = plistlib.loads(zipfile.ZipFile(path).read(info))
    chain = unpacker.to_chain(unpacker.actions_in(doc), "%s (restored)" % name)

    if args.chain:
        print(json.dumps(chain, indent=2, ensure_ascii=False))
        return

    link = packer.build(chain)
    # The name is not in the plist, so say it here or it is lost on the way.
    print("Name the new shortcut: %s" % name, file=sys.stderr)
    print("%d actions, %d chars of link, from %s" % (
        len(chain["actions"]), len(link), Path(path).name), file=sys.stderr)
    print(link)


if __name__ == "__main__":
    main()
