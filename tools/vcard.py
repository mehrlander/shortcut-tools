#!/usr/bin/env python3
"""Build a menu as vCards, with the icons already rasterized.

    python3 tools/vcard.py menus/<name>.json [--out Choice.vcf]
    python3 tools/vcard.py menus/<name>.json --icons icons.json   # no network, no browser

Choose from List shows a plain line per row. Given contacts it shows an image, a
title, and a subtitle, so a `.vcf` is how a native menu gets an icon. The rows
are contacts only in the sense that Contacts is the one content type Shortcuts
renders that way.

The icons are baked here rather than fetched on device. They are constants: a
glyph does not change between runs, so fetching one per row per run costs a
round trip before the menu can appear, fails offline, and puts the whole menu
behind async work in a context where async timing is still an open question.
Live row *content* is a different matter and has to be fetched there.

Rasterizing needs a renderer, so this drives headless Chromium once for the
whole set and reads the encoded images back out of the DOM. `--icons` supplies
them instead, which is what makes the assembly testable without a browser.

Format follows the generator page: vCard 3.0 with VERSION and FN present, and
JPEG rather than PNG. A glyph on white is visually identical in either and JPEG
measured 5,604 bytes gzipped against 9,329 for PNG across three rows at 128px.
"""
import argparse, base64, json, os, re, shutil, subprocess, sys, tempfile, urllib.request
from pathlib import Path

CDN = "https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/%s/%s.svg"
FALLBACK = "question"
SIZE = 128          # a list thumbnail, not a portrait; 256 is four times what is shown
QUALITY = 0.8


def chrome():
    """Find a Chromium. The tool needs one; the test suite deliberately does not."""
    for path in [os.environ.get("CHROME"),
                 "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
                 shutil.which("chromium"), shutil.which("google-chrome")]:
        if path and Path(path).is_file():
            return path
    for root in Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome"):
        return str(root)
    raise SystemExit("no Chromium found; set CHROME=/path/to/chrome or pass --icons")


def fetch_svg(name, weight):
    """Phosphor names the regular weight bare and suffixes every other one."""
    slug = name if weight == "regular" else "%s-%s" % (name, weight)
    for candidate in [slug, FALLBACK if weight == "regular" else "%s-%s" % (FALLBACK, weight)]:
        try:
            with urllib.request.urlopen(CDN % (weight, candidate), timeout=20) as r:
                return r.read().decode()
        except Exception:
            continue
    raise SystemExit("could not fetch %s or the %s fallback" % (name, FALLBACK))


def rasterize(svgs):
    """SVG text to base64 JPEG, all of them in one browser run.

    The SVG is inlined as a data: URL rather than linked, which is what keeps
    the canvas untainted: a cross-origin image makes toDataURL throw.
    """
    page = """<!doctype html><meta charset=utf-8><pre id=out></pre><script>
const SVGS = %s, SIZE = %d, Q = %s;
(async () => {
  const out = {};
  for (const [name, svg] of Object.entries(SVGS)) {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(svg.replace(/currentColor/g, 'black'));
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    out[name] = c.toDataURL('image/jpeg', Q).split(',')[1];
  }
  document.getElementById('out').textContent = JSON.stringify(out);
})();
</script>""" % (json.dumps(svgs), SIZE, QUALITY)
    with tempfile.TemporaryDirectory() as tmp:
        html = Path(tmp) / "raster.html"
        html.write_text(page)
        dom = subprocess.run([chrome(), "--headless", "--no-sandbox", "--disable-gpu",
                              "--virtual-time-budget=8000", "--dump-dom", html.as_uri()],
                             capture_output=True, text=True).stdout
    found = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
    if not found or not found.group(1).strip():
        raise SystemExit("the rasterizer produced nothing; run with --icons or check CHROME")
    return json.loads(found.group(1))


def strip_profile(b64):
    """Drop the APPn metadata segments canvas leaves in a JPEG.

    Chromium embeds a 472-byte ICC profile, 14% of a 128px glyph, describing a
    color space that a black shape on white does not use. APP0 stays, since it
    is the 16-byte JFIF header decoders expect to see first.
    """
    data = base64.b64decode(b64)
    if data[:2] != b"\xff\xd8":
        return b64
    out, i = bytearray(data[:2]), 2
    while i < len(data) - 1 and data[i] == 0xFF:
        marker = data[i + 1]
        if marker == 0xDA:                     # start of scan; the rest is image
            out += data[i:]
            return base64.b64encode(bytes(out)).decode()
        length = int.from_bytes(data[i + 2:i + 4], "big")
        if not (0xE1 <= marker <= 0xEF):       # keep everything but APP1..APP15
            out += data[i:i + 2 + length]
        i += 2 + length
    return b64                                 # unrecognized layout, leave it alone


def card(row, photo, fold=False):
    """One vCard. VERSION and FN are required by 3.0 and both were missing from
    the first shortcut that built these by hand."""
    photo_line = "PHOTO;TYPE=JPEG;ENCODING=BASE64:" + strip_profile(photo)
    if fold:
        # The spec caps a line at 75 octets and continues with CRLF plus a space.
        # Off by default: Apple's parser accepts the long line, and the unfolded
        # form is the one already proven in this pipeline.
        head, body = photo_line[:75], photo_line[75:]
        photo_line = head + "".join("\r\n " + body[i:i + 74] for i in range(0, len(body), 74))
    return "\r\n".join(["BEGIN:VCARD", "VERSION:3.0",
                        "N:%s;;;;" % row["title"], "FN:%s" % row["title"],
                        "ORG:%s" % row.get("subtitle", ""),
                        photo_line, "END:VCARD"])


def build(spec, icons=None, fold=False):
    rows = spec["rows"]
    if icons is None:
        weight = spec.get("weight", "regular")
        names = sorted({r["icon"] for r in rows})
        icons = rasterize({n: fetch_svg(n, weight) for n in names})
    missing = [r["icon"] for r in rows if r["icon"] not in icons]
    if missing:
        raise SystemExit("no icon for: %s" % ", ".join(sorted(set(missing))))
    return "\r\n".join(card(r, icons[r["icon"]], fold) for r in rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec", help="a menu spec: {\"rows\": [{\"icon\", \"title\", \"subtitle\"}]}")
    ap.add_argument("--icons", help="prerendered {name: base64 jpeg}, skipping network and browser")
    ap.add_argument("--out", help="write here instead of stdout")
    ap.add_argument("--fold", action="store_true", help="fold the photo line at 75 octets")
    args = ap.parse_args()
    spec = json.load(open(args.spec))
    icons = json.load(open(args.icons)) if args.icons else None
    vcf = build(spec, icons, args.fold)
    if args.out:
        Path(args.out).write_text(vcf)
        print("%s: %d rows, %d bytes" % (args.out, len(spec["rows"]), len(vcf)), file=sys.stderr)
    else:
        sys.stdout.write(vcf)


if __name__ == "__main__":
    main()
