// tools/log.py — the session's half of the reader pair.
//
// pages/shortcut-log.html renders the same two facts for whoever tapped the
// link. Both read a device payload and both score it against the same build
// manifest, so what is checked here is that this half says what that half says:
// a run's structure over its base64, and a verdict that is silent when unknown.

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const py = (src) => execFileSync("python3", ["-c", src], { cwd: ROOT, encoding: "utf8" }).trim();

// A run's payload as the device writes it: one enormous base64 field beside the
// few small ones that answer anything.
const PAYLOAD = JSON.stringify({
  Base64: "eyJvcCI6ImltcG9ydCJ9".repeat(40),
  "File Size": 165, Type: "Text",
});
const RUN = `run name=Run-Pick build=b07361d chose=Get-FileInfo\n${PAYLOAD}`;

const render = (body, table) => py(
  `import sys,json; sys.path.insert(0,'tools'); import log;` +
  `print(log.render('2026-08-29-115055', json.loads(${JSON.stringify(JSON.stringify(body))}), ` +
  `json.loads(${JSON.stringify(JSON.stringify(table))})))`);

test("a run shows its structure rather than its base64", () => {
  const row = render(RUN, {});
  assert.match(row, /"File Size": 165/,
    "the small fields are what a row is read for");
  // Eliding decides WHAT is shown; the row cap decides how much. A plain
  // truncation at the same width shows base64 and nothing else.
  assert.match(row, /…\[\d+\]/, "a long string reports its length");
  assert.ok(!/eyJvcCI6ImltcG9ydCJ9eyJvcCI6ImltcG9ydCJ9eyJvcCI6ImltcG9ydCJ9/.test(row),
    "and does not spend the row on base64");
});

test("a row stays one line", () => {
  const row = render(RUN, {});
  assert.ok(!row.includes("\n"), "a row is one line");
  assert.ok(row.length <= 260, `row was ${row.length} chars`);
});

// The verdict: a logged build id says WHICH copy ran, and it takes the manifest
// to say whether that copy is current. That is the question the stamp exists
// for and cannot answer alone.
test("a run is scored against the build manifest", () => {
  assert.match(render(RUN, { "Run-Pick": "b07361d" }), /current/);
  const stale = render(RUN, { "Run-Pick": "ccb6cfc" });
  assert.match(stale, /stale→ccb6cfc/);
  assert.ok(!stale.includes("current"), "one verdict, not both");
});

test("an unknown build gets no verdict at all", () => {
  // Worse than no verdict: an unlooked-up answer reading as a good one.
  const row = render(RUN, {});
  assert.ok(!row.includes("current") && !row.includes("stale"), row);
  assert.match(row, /build=b07361d/, "and the row still renders");
});

test("the manifest this reads is the one plist.py publishes", () => {
  // Two derivations of one number is the $file defect over again.
  const table = JSON.parse(py("import sys,json; sys.path.insert(0,'tools');"
    + " import log; print(json.dumps(log.builds()))"));
  const onDisk = require(path.join(ROOT, "plists", "builds.json"));
  assert.deepStrictEqual(table, onDisk);
});
