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
// Type-agnostic on purpose: the type parameter is read off the image's bytes,
// so a test that hardcoded one would stop seeing the other.
const photos = (vcf) => [...vcf.matchAll(/PHOTO;TYPE=\w+;ENCODING=BASE64:(\S+)/g)].map(m => m[1]);

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

// The dispatch half, whose two mechanisms came off an export rather than a
// guess: Set Name supplies the type hint, and Choose from List coerces the
// named text to contacts in its own input attachment, so there is no Get
// Contacts from Input action anywhere in the chain.
function chain(spec, icons, extra = []) {
  return JSON.parse(run(spec, icons, ["--chain", ...extra]));
}

test("the chain names the file, then coerces it to contacts in place", () => {
  const c = chain(SPEC, ICONS);
  const [text, name, choose] = c.actions;
  assert.strictEqual(text.id, "is.workflow.actions.gettext");
  assert.strictEqual(name.p.WFName, "MainMenu.vcf", "the extension is the only type hint");
  assert.strictEqual(name.p.WFInput.Value.OutputUUID, text.p.UUID);
  assert.deepStrictEqual(choose.p.WFInput.Value.Aggrandizements,
    [{ CoercionItemClass: "WFContactContentItem", Type: "WFCoercionVariableAggrandizement" }]);
  assert.strictEqual(choose.p.WFInput.Value.OutputUUID, name.p.UUID);
  assert.ok(!c.actions.some(a => /getcontacts|detect\.contacts/.test(a.id)));
});

test("each row is a compact If reading the choice's Last Name", () => {
  const c = chain(SPEC, ICONS);
  const opens = c.actions.filter(a => a.p.WFControlFlowMode === 0);
  assert.strictEqual(opens.length, 2);
  assert.deepStrictEqual(opens.map(a => a.p.WFConditionalActionString), ["First", "Second"]);
  // N:Title;;;; puts the title in the family slot precisely so it reads back here.
  assert.strictEqual(opens[0].p.WFInput.Variable.Value.Aggrandizements[0].PropertyName, "Last Name");
  assert.strictEqual(opens[0].p.WFInput.Variable.Value.OutputUUID, c.actions[2].p.UUID);
});

test("every block is balanced and no two rows share a grouping", () => {
  const c = chain(SPEC, ICONS);
  const groups = {};
  for (const a of c.actions.filter(a => a.p.GroupingIdentifier))
    (groups[a.p.GroupingIdentifier] = groups[a.p.GroupingIdentifier] || []).push(a.p.WFControlFlowMode);
  assert.strictEqual(Object.keys(groups).length, 2);
  for (const modes of Object.values(groups)) assert.deepStrictEqual(modes, [0, 2]);
});

test("a row's own actions land inside its branch", () => {
  const spec = { rows: [{ icon: "a", title: "First", actions: [{ id: "is.workflow.actions.nothing", p: {} }] },
                        { icon: "b", title: "Second" }] };
  const ids = chain(spec, ICONS).actions.map(a => a.id);
  const i = ids.indexOf("is.workflow.actions.nothing");
  assert.ok(i > 0 && ids[i - 1] === "is.workflow.actions.conditional");
  assert.strictEqual(ids[i + 1], "is.workflow.actions.conditional");
});

// A plist is XML, and XML normalizes a literal CR in text content away on read,
// so a CRLF card would not survive packing. pack.py asserts the round trip, so
// this fails loudly rather than shipping a payload that quietly changed.
test("the packed card carries no CR, which a plist cannot hold", () => {
  const text = chain(SPEC, ICONS).actions[0].p.WFTextActionText;
  assert.ok(!text.includes("\r"), "CRLF belongs to the standalone file, not this route");
  assert.ok(text.includes("BEGIN:VCARD\nVERSION:3.0\n"));
});

// The photos are built here rather than by the canvas, because a Phosphor glyph
// is two colors and a browser's encoders are built for photographs. Per row at
// 128px, as base64: 2,594 bytes for canvas JPEG q0.8, 1,172 for 8-bit
// grayscale, 425 for 1-bit.
test("a PNG icon is labelled PNG and passed through untouched", () => {
  // A 1x1 1-bit grayscale PNG, built the way encode_png builds one.
  const png = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    Buffer.from("0000000d49484452000000010000000101000000003718f6", "hex"), // IHDR + crc
    Buffer.from("0000000a4944415408d76360000000020001e221bc33", "hex"),     // IDAT + crc
    Buffer.from("0000000049454e44ae426082", "hex")]).toString("base64");
  const vcf = run({ rows: [{ icon: "a", title: "T" }] }, { a: png });
  assert.match(vcf, /PHOTO;TYPE=PNG;ENCODING=BASE64:/);
  assert.strictEqual(photos(vcf)[0], png, "a PNG has no profile to strip");
});

test("the type parameter is read off the bytes, not assumed", () => {
  const vcf = run(SPEC, ICONS);
  assert.match(vcf, /PHOTO;TYPE=JPEG;/, "these fixtures are JPEGs and should say so");
});

test("a spec's prompt titles the sheet, since the system default says 'Which one?'", () => {
  const withPrompt = chain({ ...SPEC, prompt: "Pick a thing" }, ICONS);
  assert.strictEqual(withPrompt.actions[2].p.WFChooseFromListActionPrompt, "Pick a thing");
  assert.ok(!("WFChooseFromListActionPrompt" in chain(SPEC, ICONS).actions[2].p),
    "and no key at all rather than an empty one when the spec is silent");
});

// A generic runner cannot hold per-row behavior, so the row carries its own as a
// URL in the card and the runner reads it back. This is what lets one shortcut
// on the device serve every menu, with nothing to paste per menu.
test("a row's action rides in NOTE, and a row without one omits the field", () => {
  const vcf = run({ rows: [{ icon: "a", title: "Go", action: "shortcuts://run-shortcut?name=X" },
                           { icon: "b", title: "Inert" }] }, ICONS);
  assert.match(vcf, /NOTE:shortcuts:\/\/run-shortcut\?name=X/);
  assert.strictEqual((vcf.match(/^NOTE:/gm) || []).length, 1);
});

test("--data hands the file to the runner rather than shipping the behavior", () => {
  const link = run(SPEC, ICONS, ["--data"]).trim();
  assert.match(link, /^shortcuts:\/\/run-shortcut\?name=Show-Menu&input=text&text=/);
  const vcf = decodeURIComponent(link.split("&text=")[1]);
  assert.strictEqual(vcf, run(SPEC, ICONS), "the payload is the file, unchanged");
  assert.ok(link.length < run(SPEC, ICONS, ["--chain"]).length,
    "and it is smaller than shipping the chain");
});

test("--chain and --data are refused together, since they are opposite answers", () => {
  assert.throws(() => run(SPEC, ICONS, ["--chain", "--data"]), /Command failed/);
});

test("Show-Menu reads the chosen row's Notes and opens it", () => {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "show-menu.json"), "utf8"));
  const [name, choose, url, open] = c.actions;
  assert.deepStrictEqual(c.actions.map(a => a.id), [
    "is.workflow.actions.setitemname", "is.workflow.actions.choosefromlist",
    "is.workflow.actions.url", "is.workflow.actions.openurl"]);
  assert.strictEqual(name.p.WFInput.Value.Type, "ExtensionInput", "the menu arrives as input");
  assert.match(name.p.WFName, /\.vcf$/, "the extension is the only type hint");
  assert.strictEqual(choose.p.WFInput.Value.Aggrandizements[0].CoercionItemClass,
    "WFContactContentItem");
  assert.strictEqual(url.p.WFURLActionURL.Value.Aggrandizements[0].PropertyName, "Notes",
    "which is the one shape here still inferred rather than read off an export");
  assert.strictEqual(url.p.WFURLActionURL.Value.OutputUUID, choose.p.UUID);
  assert.strictEqual(open.p.WFInput.Value.OutputUUID, url.p.UUID);
});
