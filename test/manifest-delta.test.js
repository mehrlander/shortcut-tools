// Rewritten 2026-08-19 against the shape the device actually produces. The
// original suite encoded an assumption (one record per shortcut, tolerant of
// two join styles) and passed on fixtures built from that assumption, so it
// proved the parser self-consistent and nothing about the device. The fixtures
// below are cut from the first real manifest instead.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const TOOL = path.join(ROOT, "tools", "manifest-delta.py");

/** Column-major marker text, the way Sync-Manifest emits it. */
function manifest(rows, extraFolders) {
  const col = (k) => rows.map((r) => r[k]).join("\n");
  let out = `==name==\n${col(0)}\n==actions==\n${col(1)}\n==lastModified==\n${col(2)}\n`;
  if (extraFolders !== undefined) {
    out = `==name==\n${col(0)}\n==folder==\n${extraFolders.join("\n")}\n` +
          `==actions==\n${col(1)}\n==lastModified==\n${col(2)}\n`;
  }
  return out;
}

function run(text, index, expectFail) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-"));
  fs.mkdirSync(path.join(dir, "shortcuts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "shortcuts", "index.json"), JSON.stringify(index));
  const mf = path.join(dir, "m.txt");
  fs.writeFileSync(mf, text);
  const r = spawnSync("python3", [TOOL, mf, "--private", dir, ...(expectFail ? [] : ["--json"])],
    { cwd: ROOT, encoding: "utf8", timeout: 60000 });
  if (expectFail) return r;
  if (r.status !== 0) throw new Error("exit " + r.status + "\n" + (r.stderr || r.stdout));
  return JSON.parse(r.stdout);
}

const CORPUS = [
  { name: "Show-Table", actions: 11, from: "2026-08-13-01.zip" },
  { name: "Log-Repo", actions: 8, from: "2026-08-13-01.zip" },
  { name: "Get-Text", actions: 4, from: "2026-08-13-01.zip" },
];

test("the manifest is read column-major, one marker per field", () => {
  const out = run(manifest([
    ["Show-Table", 11, "2026-08-01T00:00:00-07:00"],
    ["Log-Repo", 9, "2026-08-01T00:00:00-07:00"],
    ["New-One", 3, "2026-08-19T00:00:00-07:00"],
  ]), CORPUS);
  assert.deepEqual(out.device, 3);
  assert.deepEqual(out.added, ["New-One"]);
  assert.deepEqual(out.removed, ["Get-Text"]);
  assert.deepEqual(out.changed.map((c) => c.name), ["Log-Repo"]);
});

test("columns of unequal length are refused, never zipped", () => {
  // Shortcuts drops an empty value when joining a list into text, so a column
  // holding a blank comes back short with nothing marking where. Zipping it
  // would report edits to shortcuts nobody touched, which is worse than an
  // error because it looks like an answer.
  const r = run(manifest([
    ["A", 1, "2026-08-01T00:00:00-07:00"],
    ["B", 2, "2026-08-01T00:00:00-07:00"],
  ]).replace("2026-08-01T00:00:00-07:00\n2026-08-01T00:00:00-07:00", "2026-08-01T00:00:00-07:00"),
    [], true);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /columns disagree/);
  assert.match(r.stderr, /cannot be aligned by position/);
});

test("a manifest still carrying folder is read, and folder never misaligns it", () => {
  // The first run's file has four columns; it must keep parsing. A folder
  // column that does not align is dropped rather than allowed to shift a row.
  const rows = [["A", 1, "2026-08-01T00:00:00-07:00"], ["B", 2, "2026-08-01T00:00:00-07:00"]];
  assert.deepEqual(run(manifest(rows, ["Core", "Core"]), []).added, ["A", "B"]);
  assert.deepEqual(run(manifest(rows, ["Core"]), []).added, ["A", "B"]);
});

test("a corpus name is repaired to its device form only on evidence", () => {
  // A dump stores "/" as ":" in the entry name, so Unzip/Re-zip arrives as
  // Unzip:Re-zip. Repairing every colon would be wrong: "REF: Edit" is a real
  // name with no slash form, and rewriting it would invent a deletion.
  const out = run(manifest([
    ["Unzip/Re-zip", 5, "2026-08-01T00:00:00-07:00"],
    ["REF: Edit iCloud JSON", 3, "2026-08-01T00:00:00-07:00"],
  ]), [
    { name: "Unzip:Re-zip", actions: 5, from: "2026-08-13-01.zip" },
    { name: "REF: Edit iCloud JSON", actions: 3, from: "2026-08-13-01.zip" },
  ]);
  assert.deepEqual(out.added, [], "the slash form is the same shortcut");
  assert.deepEqual(out.removed, [], "and so is the colon name that is genuinely a colon");
  assert.deepEqual(out.changed, []);
});

test("a corpus record that failed to parse is named as unreadable, not as a diff", () => {
  // index-dump records an unparseable plist as `error` with no action count.
  // Reporting "actions None to 29" reads as a change of unknown size; the
  // truth is the corpus never got a usable copy.
  const out = run(manifest([["Get-Yaml", 29, "2026-08-01T00:00:00-07:00"]]),
    [{ name: "Get-Yaml", error: "not well-formed", from: "2026-08-13-01.zip" }]);
  assert.deepEqual(out.changed.map((c) => c.name), ["Get-Yaml"]);
  assert.match(out.changed[0].why, /unreadable \(parse error\)/);
  assert.doesNotMatch(out.changed[0].why, /None/);
});

test("a date past the corpus cutoff is enough on its own", () => {
  const out = run(manifest([
    ["Show-Table", 11, "2026-08-19T00:00:00-07:00"],
    ["Log-Repo", 8, "2026-08-01T00:00:00-07:00"],
    ["Get-Text", 4, "2026-08-01T00:00:00-07:00"],
  ]), CORPUS);
  assert.deepEqual(out.changed.map((c) => c.name), ["Show-Table"]);
  assert.match(out.changed[0].why, /modified 2026-08-19/);
});

test("the cutoff comes from the corpus, not from today", () => {
  const out = run(manifest(CORPUS.map((r) => [r.name, r.actions, "2020-01-01T00:00:00-07:00"])), CORPUS);
  assert.equal(out.cutoff, "2026-08-13");
  assert.deepEqual(out.changed, []);
});

test("a name carrying quotes or backslashes survives the round trip", () => {
  // The reason the manifest is marker text: Shortcuts has no escaping
  // primitive, so a JSON row built on the device would break on this name.
  const hostile = 'Say "hi" \\ now';
  assert.deepEqual(run(manifest([[hostile, 3, "2026-08-19T00:00:00-07:00"]]), []).added, [hostile]);
});

test("a name containing a marker word does not split the record", () => {
  const out = run(manifest([["Get-lastModified-Report", 3, "2026-08-19T00:00:00-07:00"]]), []);
  assert.deepEqual(out.added, ["Get-lastModified-Report"]);
});

test("the dump link names every changed shortcut and nothing else", () => {
  const out = run(manifest([
    ["New-One", 3, "2026-08-19T00:00:00-07:00"],
    ["Show-Table", 11, "2026-08-01T00:00:00-07:00"],
    ["Log-Repo", 8, "2026-08-01T00:00:00-07:00"],
    ["Get-Text", 4, "2026-08-01T00:00:00-07:00"],
  ]), CORPUS);
  assert.equal(out.links.length, 1);
  assert.equal(decodeURIComponent(out.links[0].split("&text=")[1]), "⟦New-One⟧");
});

test("links chunk by estimated payload, not by count", () => {
  const big = ["Huge", 2000, "2026-08-19T00:00:00-07:00"];
  const small = ["Tiny", 1, "2026-08-19T00:00:00-07:00"];
  assert.ok(run(manifest([big, small]), []).links.length > 1, "a 2000-action export should split");
  assert.equal(run(manifest([small, ["Tiny2", 1, "2026-08-19T00:00:00-07:00"]]), []).links.length, 1);
});

test("a file that is not a manifest is refused rather than read as empty", () => {
  const r = run("just some text\n", [], true);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no name, actions, lastModified column/);
});
