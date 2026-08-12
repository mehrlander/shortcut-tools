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
whole set and reads the raw pixels back out of the DOM, encoding them here.
`--icons` supplies finished images instead, which is what makes the assembly
testable without a browser.

Format is vCard 3.0 with VERSION and FN present. The photo is a **1-bit PNG,
built here rather than by the canvas**, and that is the whole size story: a
Phosphor glyph is two colors, so an encoder that stores two colors beats one
that stores a photograph. Measured per row across four icons at 128px, as base64:
2,594 bytes for canvas JPEG at q0.8, 1,172 for 8-bit grayscale, 425 for 1-bit.
Rendered at list size the three are indistinguishable, because the display
downsamples 128px to about 44 and averages the aliasing away.
"""
import argparse, base64, json, os, re, shutil, struct, subprocess, sys, tempfile, urllib.request, zlib
from pathlib import Path

CDN = "https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/%s/%s.svg"
FALLBACK = "question"
SIZE = 128          # a list thumbnail, not a portrait; 256 is four times what is shown
BITS = 1            # see encode_png: 8 keeps the antialiased edge, 1 is six times smaller


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
    """SVG text to raw luminance, one byte per pixel, all of them in one run.

    The browser is here to rasterize and nothing else. It hands back pixels
    rather than an encoded image, because its encoders are built for
    photographs and these are two-color glyphs; `encode_png` below does far
    better on exactly this input.

    The SVG is inlined as a data: URL rather than linked, which is what keeps
    the canvas untainted: a cross-origin image makes getImageData throw.
    """
    page = """<!doctype html><meta charset=utf-8><pre id=out></pre><script>
const SVGS = %s, SIZE = %d;
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
    const d = ctx.getImageData(0, 0, SIZE, SIZE).data, g = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < g.length; i++) g[i] = d[i * 4];
    out[name] = btoa(String.fromCharCode.apply(null, g));
  }
  document.getElementById('out').textContent = JSON.stringify(out);
})();
</script>""" % (json.dumps(svgs), SIZE)
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


def encode_png(gray, size, bits):
    """Grayscale bytes to a PNG, without a library.

    Two color types are worth having. `8` keeps the antialiased edge; `1`
    thresholds it away and is six times smaller, which at list size is
    invisible because the display is downsampling 128px to about 44 and doing
    its own averaging. Filter 0 on every scanline: deflate already handles a
    glyph's long runs, and a predictor buys nothing on flat fields.
    """
    if bits == 8:
        rows = b"".join(b"\0" + gray[y * size:(y + 1) * size] for y in range(size))
    else:
        rows = bytearray()
        for y in range(size):
            packed, acc, n = bytearray(), 0, 0
            for x in range(size):
                acc = (acc << 1) | (1 if gray[y * size + x] >= 128 else 0)
                n += 1
                if n == 8:
                    packed.append(acc)
                    acc, n = 0, 0
            if n:
                packed.append(acc << (8 - n))
            rows += b"\0" + bytes(packed)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    header = struct.pack(">IIBBBBB", size, size, bits, 0, 0, 0, 0)   # color type 0: grayscale
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))


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


def photo_of(b64):
    """(type, payload) for the PHOTO line, read off the bytes rather than told.

    A prerendered image arriving through --icons could be either, and the type
    parameter has to agree with what is actually there.
    """
    data = base64.b64decode(b64)
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG", b64
    if data[:2] == b"\xff\xd8":
        return "JPEG", strip_profile(b64)
    return "JPEG", b64          # unrecognized: pass it through rather than mangle it


def card(row, photo, fold=False):
    """One vCard. VERSION and FN are required by 3.0 and both were missing from
    the first shortcut that built these by hand."""
    kind, payload = photo_of(photo)
    photo_line = "PHOTO;TYPE=%s;ENCODING=BASE64:%s" % (kind, payload)
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


def uid(n):
    return "5CA1AB1E-%04d-4A00-9000-%012d" % (n, n)


def attachment(uuid, name, aggrandizements=None):
    value = {"OutputName": name, "OutputUUID": uuid, "Type": "ActionOutput"}
    if aggrandizements:
        value["Aggrandizements"] = aggrandizements
    return {"Value": value, "WFSerializationType": "WFTextTokenAttachment"}


def chain(spec, vcf):
    """The whole menu as a pack.py chain: the file, the list, and the dispatch.

    Confirmed against an export rather than inferred. Two steps are the ones
    nobody would guess. Set Name gives the text a `.vcf` extension, which is the
    only type hint the next step has; Choose from List then coerces it with
    `WFContactContentItem` in the input attachment, so there is no Get Contacts
    from Input action anywhere. And the choice is read back through the contact's
    **Last Name**, which is why `N:Title;;;;` puts the title in the family slot.

    One Text action carries the whole file. The export this follows built one
    card per variable and combined them, which is the same thing with two
    actions per row.
    """
    rows = spec["rows"]
    # CRLF cannot survive this route and does not need to. A plist is XML, and
    # XML normalizes a literal CR in text content away on read, so the packed
    # action would not equal the one written; pack.py's round-trip assertion
    # catches it rather than shipping a payload that quietly changed. The export
    # this follows stores its cards with plain newlines for the same reason,
    # which is also the evidence that Apple's parser accepts them.
    actions = [
        {"id": "is.workflow.actions.gettext",
         "p": {"UUID": uid(1), "WFTextActionText": vcf.replace("\r\n", "\n")}},
        {"id": "is.workflow.actions.setitemname",
         "p": {"UUID": uid(2), "WFInput": attachment(uid(1), "Text"),
               "WFName": spec.get("file", "MainMenu.vcf")}},
        {"id": "is.workflow.actions.choosefromlist",
         "p": {"UUID": uid(3),
               "WFInput": attachment(uid(2), "Renamed Item",
                                     [{"CoercionItemClass": "WFContactContentItem",
                                       "Type": "WFCoercionVariableAggrandizement"}])}},
    ]
    # Without this the sheet is titled by the system, which says "Which one?".
    # The key is the one shape here still inferred rather than read off an export.
    if spec.get("prompt"):
        actions[2]["p"]["WFChooseFromListActionPrompt"] = spec["prompt"]
    chosen = attachment(uid(3), "Chosen Item",
                        [{"PropertyName": "Last Name", "PropertyUserInfo": 1,
                          "Type": "WFPropertyVariableAggrandizement"}])
    for i, row in enumerate(rows):
        group = "5CA1AB1E-%04d-4A00-9000-CA5E00000000" % i
        # A flat If per row with no Otherwise: the compact-If switch, and the
        # reason a row that does nothing yet is still a legal branch.
        actions.append({"id": "is.workflow.actions.conditional",
                        "p": {"GroupingIdentifier": group, "WFCondition": 4,
                              "WFConditionalActionString": row["title"],
                              "WFControlFlowMode": 0,
                              "WFInput": {"Type": "Variable", "Variable": chosen}}})
        actions.extend(row.get("actions", []))
        actions.append({"id": "is.workflow.actions.conditional",
                        "p": {"GroupingIdentifier": group, "UUID": uid(100 + i),
                              "WFControlFlowMode": 2}})
    return {"label": "%s (%d rows, %d actions)" % (spec.get("label", "Menu"),
                                                   len(rows), len(actions)),
            "actions": actions}


def build(spec, icons=None, fold=False, bits=BITS):
    rows = spec["rows"]
    if icons is None:
        weight = spec.get("weight", "regular")
        names = sorted({r["icon"] for r in rows})
        gray = rasterize({n: fetch_svg(n, weight) for n in names})
        icons = {n: base64.b64encode(encode_png(base64.b64decode(g), SIZE, bits)).decode()
                 for n, g in gray.items()}
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
    ap.add_argument("--chain", action="store_true",
                    help="emit the whole menu as a pack.py chain rather than the file alone")
    ap.add_argument("--bits", type=int, choices=[1, 8], default=BITS,
                    help="photo depth: 1 is six times smaller, 8 keeps the antialiased edge")
    args = ap.parse_args()
    spec = json.load(open(args.spec))
    icons = json.load(open(args.icons)) if args.icons else None
    vcf = build(spec, icons, args.fold, args.bits)
    out = json.dumps(chain(spec, vcf), ensure_ascii=False, indent=2) if args.chain else vcf
    if args.out:
        Path(args.out).write_text(out)
        print("%s: %d rows, %d bytes" % (args.out, len(spec["rows"]), len(out)), file=sys.stderr)
    else:
        sys.stdout.write(out)


if __name__ == "__main__":
    main()
