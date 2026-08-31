#!/usr/bin/env python3
"""Turn a Read-Shots OCR payload into a clean list of app names.

    python3 tools/shots.py <log payload> [--corrections FILE] [-o OUT] [--flag]

`Read-Shots` returns what Vision saw, which is the app labels plus everything
else on screen: the status bar, the A-Z index rail, the search field, and the
letter or glyph drawn on each app's own icon. Roughly one line in five is a
name. Four rules remove the rest mechanically:

| Rule | Removes |
| --- | --- |
| chrome and status literals | `Apps`, `Q Search Apps`, `8:15`, `. 5G` |
| index rail | `A B`, `C`, and runs of consecutive capitals |
| icon absorbed by its label | `alexa` before `Amazon Alexa` |
| icon initials | `OSD` before `Olympia School District` |

**Absorption fires only on icon-shaped text**, meaning all-lower, all-upper, or
three letters or fewer. Without that guard `Zoom` disappears into `Zoomable`,
and `Amazon` into `Amazon Alexa`, which is the difference between an icon and a
shorter app that sorts next to a longer one.

What no rule can reach is Vision misreading a letter: `Spotity`, `Character.Al`,
`Wendv's`. Those go in the corrections file, which is **data, not code**, so the
parse stays one deterministic command over a committed input and every judgment
call is a diff someone can argue with.
"""
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = {"apps", "default apps", "manage default apps on iphone", "hidden apps",
          "q search apps", "search apps", ">", "<"}
STATUS = re.compile(r"^\d{1,2}:\d{2}$|^[.,|l·•\s]*\d?g\s*\d*$|^[.,|l·•\s]+$", re.I)
letters = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())


def clean(line):
    """One raw OCR line to a candidate name, or None when it is chrome."""
    s = line.strip()
    if not s or s.lower() in CHROME or STATUS.match(s):
        return None
    if re.fullmatch(r"\(.{1,8}\)", s):                    # (c.ai) beside Character.AI
        return None
    if re.fullmatch(r"[A-Z#^](\s+[A-Z#])*", s) or len(letters(s)) < 2:
        return None
    if re.fullmatch(r"(?:[A-Z]{1,2}\s+){1,2}[A-Z]{1,2}", s):
        return None
    if not re.search(r"[A-Za-z]", s):
        return None
    if re.fullmatch(r"[A-Z]{2,8}", s) and all(ord(b) - ord(a) == 1 for a, b in zip(s, s[1:])):
        return None                                       # CDEF: the rail, spaces lost
    m = re.match(r"^([A-Z])\s+([A-Z][a-z].*)$", s)        # "G Google", never "O Bee Mobile"
    if m and m.group(1) == m.group(2)[0]:
        s = m.group(2)
    return s


def names(text, corrections=None):
    c = corrections or {}
    drop = {letters(x) for x in c.get("drop", [])}
    rename, split = c.get("rename", {}), c.get("split", {})

    rows = [k for k in (clean(l) for l in text.splitlines()) if k]
    out = []
    for i, s in enumerate(rows):
        cur = letters(s)
        nxt = letters(rows[i + 1]) if i + 1 < len(rows) else ""
        iconish = s.islower() or s.isupper() or len(cur) <= 3
        if cur and nxt and cur == nxt:
            continue
        if cur and nxt and cur in nxt and iconish:
            continue
        if i + 1 < len(rows) and s.isupper() and 2 <= len(s) <= 5:
            w = re.findall(r"[A-Za-z]+", rows[i + 1])
            if len(w) > 1 and "".join(x[0] for x in w).upper() == s:
                continue
        if (i + 2 < len(rows) and cur + nxt == letters(rows[i + 2])
                and " " not in rows[i + 2].strip()):
            continue                                      # "Clever" + "Words"
        out.append(s)

    final, seen = [], set()
    for s in out:
        for name in split.get(s, [rename.get(s, s)]):
            k = letters(name)
            if k and k not in drop and k not in seen:
                seen.add(k); final.append(name)
    return sorted(final, key=lambda x: letters(x))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("payload", help="the Read-Shots log entry, or - for stdin")
    ap.add_argument("--corrections", default=str(ROOT / "tools" / "shots-corrections.json"))
    ap.add_argument("-o", dest="out", help="write the names here, one per line")
    ap.add_argument("--flag", action="store_true",
                    help="also list names worth a second look")
    a = ap.parse_args()

    text = sys.stdin.read() if a.payload == "-" else Path(a.payload).read_text()
    text = text.split("\n", 1)[1] if text.startswith("shots ") else text
    c = json.loads(Path(a.corrections).read_text()) if Path(a.corrections).is_file() else {}
    rows = names(text, c)

    if a.out:
        Path(a.out).write_text("\n".join(rows) + "\n")
        print("wrote %s: %d names" % (a.out, len(rows)))
    else:
        print("\n".join(rows))
    if a.flag:
        # Not errors: shapes Vision gets wrong often enough to be worth an eye.
        odd = [r for r in rows if len(letters(r)) <= 3 or r.endswith("...")
               or re.search(r"[a-z][A-Z]{2}|^[a-z]+$", r)]
        print("\n%d worth a second look: %s" % (len(odd), ", ".join(odd)), file=sys.stderr)


if __name__ == "__main__":
    main()
