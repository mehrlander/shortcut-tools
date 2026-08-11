#!/usr/bin/env python3
"""Emit a tappable link that renders one HTML page on device.

    python3 tools/show.py pages/<page>.html [--target NAME] [--raw]
    python3 tools/show.py '<link>' --verify

The sibling of tools/pack.py, and the other half of the delivery story. pack.py
sends *actions to paste*; this sends *a page to run*. The link hands the page to
a shortcut that base64-encodes it, builds `data:text/html;charset=utf-8;base64,`
and opens it, so the page lands in Safari as a real document.

Compression is the default because percent-encoding is the expensive part of
this route. Encoded raw, a page costs about 1.7x its own size; gzipped first it
costs about 0.05x, since base64url is almost entirely characters the encoder
leaves alone. The device gains nothing to do: the page is wrapped in the shell
at tools/gz-shell.html, which inflates it in the browser with DecompressionStream
and writes it out. --raw skips all of that and sends the page as itself.

Placeholders survive compression, which is the only subtle part. Show-Html
substitutes by text replacement and cannot see inside a gzip stream, so the
shell carries an uncompressed copy of each placeholder the page needs, takes the
injector's substitution there, and applies it to the inflated page. Only the
placeholders a page actually uses are carried, so a page with no secret in it
never receives the token.
"""
import argparse, base64, gzip, io, json, re, sys, urllib.parse
from pathlib import Path

# What Show-Html substitutes on the way through. Emoji-prefixed so they cannot
# collide with a page's own text; see docs/shortcuts-format-notes.md.
PLACEHOLDERS = ["\N{ADMISSION TICKETS}️GitHubToken", "\N{CLIPBOARD}ClipboardBase64"]
INJECTORS = {"Show-Html"}          # targets that substitute; everything else does not
TARGET = "Show-Html"
ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "tools" / "gz-shell.html"


def compress(text):
    """gzip bytes, with the header mtime zeroed so a page maps to one link."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=9, mtime=0) as f:
        f.write(text.encode())
    return buf.getvalue()


def b64url(data):
    return base64.b64encode(data).decode().replace("+", "-").replace("/", "_").rstrip("=")


def unb64url(s):
    return base64.b64decode(s.replace("-", "+").replace("_", "/") + "==")


def minify(shell):
    """Strip comments and line breaks. Every character here ships in the link.

    Safe by inspection rather than by parsing: the shell holds no `*` outside
    its comments, so nothing else can open one, and every statement ends in a
    semicolon, so joining lines cannot change where one ends.
    """
    out = re.sub(r"\n\s*", " ", re.sub(r"/\*.*?\*/", "", shell, flags=re.S)).strip()
    assert "/*" not in out and "*/" not in out, "a comment survived minification"
    return out


def wrap(page):
    """Wrap a page in the inflating shell. The round trip is verified, not assumed."""
    used = [p for p in PLACEHOLDERS if p in page]
    # ensure_ascii=True escapes the emoji, which is what hides the search key
    # from the injector; the value is written literally so the injector finds it.
    subs = "[%s]" % ",".join("[%s,%s]" % (json.dumps(p), json.dumps(p, ensure_ascii=False))
                             for p in used)
    gz = compress(page)
    shell = minify(SHELL.read_text())
    for slot, fill in (("__SUBS__", subs), ("__GZ__", b64url(gz))):
        # A slot named twice would be filled twice, and the link would still
        # work while carrying the payload one extra time.
        if shell.count(slot) != 1:
            raise SystemExit("%s holds %d copies of %s; it must hold exactly one"
                             % (SHELL.name, shell.count(slot), slot))
        shell = shell.replace(slot, fill)
    assert gzip.decompress(unb64url(b64url(gz))).decode() == page, "the payload does not inflate"
    return shell


def build(path, target=TARGET, raw=False):
    page = Path(path).read_text()
    carried = [p for p in PLACEHOLDERS if p in page]
    if carried and target not in INJECTORS:
        raise SystemExit("%s carries %s and %s does not substitute it; use --target Show-Html"
                         % (path, ", ".join(carried), target))
    payload = page if raw else wrap(page)
    return "shortcuts://run-shortcut?name=%s&input=text&text=%s" % (
        target, urllib.parse.quote(payload, safe=""))


def verify(link):
    """Read a link back. Use this on the exact text about to be sent.

    A link is long enough to invite shortening, and the compressed form is
    opaque, so both ends are checked here: the payload has to close its script
    tag, and the gzip stream has to inflate. A raw link can only be read.
    """
    if "&text=" not in link:
        raise SystemExit("not a shortcuts:// link with a text payload")
    target = link.split("name=", 1)[1].split("&", 1)[0]
    payload = urllib.parse.unquote(link.split("&text=", 1)[1])
    print("target:  " + target)
    # Read the form off the head, which every shell shares and which no cut in
    # the body can remove. Sniffing for something further in reports a
    # mid-payload truncation as a small raw page, confidently and wrongly.
    prologue = minify(SHELL.read_text()).split("__SUBS__")[0]
    if not payload.startswith(prologue):
        print("form:    raw (no compression)")
        page = payload
    else:
        print("form:    gz shell")
        # The payload sits early in the shell, so a cut tail takes the code that
        # inflates it and leaves the gzip stream whole. Check the shape first.
        if not payload.rstrip().endswith("</script>"):
            raise SystemExit("truncated: the shell does not close its script tag")
        found = re.search(r"var S = (\[.*?\]), G = \"([^\"]*)\";", payload, re.S)
        if not found:
            raise SystemExit("truncated: no payload between the S and G slots")
        subs, gz = found.group(1), found.group(2)
        try:
            page = gzip.decompress(unb64url(gz)).decode()
        except Exception as e:
            raise SystemExit("the payload does not inflate: %s" % e)
        print("carries: " + (", ".join(p for p, _ in json.loads(subs)) or "no placeholders"))
    for p in PLACEHOLDERS:
        if p in page:
            print("page needs: " + p)
    print("%d chars of page, %d chars of link, %.2fx" % (len(page), len(link), len(link) / len(page)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page", help="an HTML file, or a link with --verify")
    ap.add_argument("--target", default=TARGET, help="the shortcut to run (default %s)" % TARGET)
    ap.add_argument("--raw", action="store_true", help="send the page uncompressed")
    ap.add_argument("--verify", action="store_true", help="decode a link instead of building one")
    args = ap.parse_args()
    if args.verify:
        return verify(args.page)
    link = build(args.page, args.target, args.raw)
    print(link)
    print("\n%d chars" % len(link), file=sys.stderr)


if __name__ == "__main__":
    main()
