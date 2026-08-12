const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

// The rasterizer needs a browser and the suite deliberately does not have one,
// so every test here supplies its icons and exercises the assembly.
function run(spec, icons, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vcard-"));
  const specPath = path.join(dir, "spec.json"), iconPath = path.join(dir, "icons.json");
  fs.writeFileSync(specPath, JSON.stringify(spec));
  fs.writeFileSync(iconPath, JSON.stringify(icons));
  try {
    return execFileSync("python3",
      [path.join("tools", "vcard.py"), specPath, "--icons", iconPath, ...extra],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SPEC = { rows: [{ icon: "a", title: "First", subtitle: "one" },
                      { icon: "b", title: "Second", subtitle: "two" }] };

// A JPEG's segments are marker, length, payload. This is the smallest thing
// with that shape: JFIF, then an ICC profile, then the start of scan.
function jpeg({ withProfile = true } = {}) {
  const seg = (marker, body) => Buffer.concat([
    Buffer.from([0xff, marker]), Buffer.from([0, body.length + 2]), body]);
  const parts = [Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from("JFIF\0"))];
  if (withProfile) parts.push(seg(0xe2, Buffer.from("ICC_PROFILE\0" + "x".repeat(60))));
  parts.push(seg(0xda, Buffer.from([0])), Buffer.from("imagedata"));
  return Buffer.concat(parts).toString("base64");
}

const ICONS = { a: jpeg(), b: jpeg() };
const photos = (vcf) => [...vcf.matchAll(/PHOTO;TYPE=JPEG;ENCODING=BASE64:(\S+)/g)].map(m => m[1]);

test("one card per row, in the order the spec gives them", () => {
  const vcf = run(SPEC, ICONS);
  assert.strictEqual((vcf.match(/BEGIN:VCARD/g) || []).length, 2);
  assert.ok(vcf.indexOf("FN:First") < vcf.indexOf("FN:Second"));
});

// Both were absent from the first shortcut that built these by hand. vCard 3.0
// requires them, and a tolerant parser today is not a guarantee of one later.
test("VERSION and FN are present on every card", () => {
  const vcf = run(SPEC, ICONS);
  assert.strictEqual((vcf.match(/^VERSION:3\.0$/gm) || []).length, 2);
  assert.strictEqual((vcf.match(/^FN:/gm) || []).length, 2);
});

test("lines end CRLF, which is what the format says", () => {
  const vcf = run(SPEC, ICONS);
  assert.ok(vcf.includes("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
  assert.ok(!/[^\r]\n/.test(vcf), "no bare LF anywhere");
});

// Canvas leaves an ICC profile in the JPEG describing a color space a black
// glyph on white does not use. It measured 472 bytes against a 3,362-byte
// image, so 14% of every row was metadata.
test("the ICC profile is stripped and the JFIF header is not", () => {
  const out = Buffer.from(photos(run(SPEC, ICONS))[0], "base64");
  assert.ok(!out.includes(Buffer.from("ICC_PROFILE")), "APP2 should be gone");
  assert.ok(out.includes(Buffer.from("JFIF")), "APP0 is what decoders expect first");
  assert.ok(out.includes(Buffer.from("imagedata")), "and the scan survives intact");
  assert.ok(out.length < Buffer.from(ICONS.a, "base64").length);
});

test("something that is not a JPEG is passed through rather than mangled", () => {
  const notJpeg = Buffer.from("this is not an image").toString("base64");
  assert.strictEqual(photos(run({ rows: [{ icon: "a", title: "T" }] }, { a: notJpeg }))[0], notJpeg);
});

test("a missing icon fails loudly instead of writing a card with no photo", () => {
  assert.throws(() => run(SPEC, { a: jpeg() }), /Command failed/,
    "a row whose icon never rendered should stop the build");
});

test("--fold keeps every line inside the format's limit", () => {
  const vcf = run(SPEC, ICONS, ["--fold"]);
  for (const line of vcf.split("\r\n")) assert.ok(line.length <= 76, JSON.stringify(line.slice(0, 90)));
  // Folded or not, the photo has to survive the round trip unchanged.
  assert.strictEqual(photos(vcf.replace(/\r\n /g, ""))[0], photos(run(SPEC, ICONS))[0]);
});

test("a row with no subtitle still emits ORG, since the field is positional", () => {
  const vcf = run({ rows: [{ icon: "a", title: "Only" }] }, ICONS);
  assert.ok(vcf.includes("ORG:\r\n"));
});
