// The parser is the part worth testing: it runs against text a device built by
// string interpolation, where nothing escapes anything, so the cases that break
// it are names with quotes, marker-shaped names, and whatever the Text action
// decides to do about joining rows. The delta arithmetic is checked alongside
// it because a wrong answer there sends the user on a pointless export.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const TOOL = path.join(ROOT, "tools", "manifest-delta.py");

function row(name, actions, modified, folder) {
  return `==name==\n${name}\n==folder==\n${folder || "Core"}\n` +
         `==actions==\n${actions}\n==lastModified==\n${modified}\n`;
}

/** Run the tool against a throwaway private checkout built from `index`. */
function run(manifest, index, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-"));
  fs.mkdirSync(path.join(dir, "shortcuts", "manifests"), { recursive: true });
  fs.writeFileSync(path.join(dir, "shortcuts", "index.json"), JSON.stringify(index));
  const mf = path.join(dir, "m.txt");
  fs.writeFileSync(mf, manifest);
  const r = spawnSync("python3", [TOOL, mf, "--private", dir, "--json", ...(extra || [])],
    { cwd: ROOT, encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) throw new Error("exit " + r.status + "\n" + (r.stderr || r.stdout));
  return JSON.parse(r.stdout);
}

const CORPUS = [
  { name: "Show-Table", actions: 11, from: "2026-08-13-01.zip" },
  { name: "Log-Repo", actions: 8, from: "2026-08-13-01.zip" },
  { name: "Get-Text", actions: 4, from: "2026-08-13-01.zip" },
];

test("the three signals fire independently", () => {
  const out = run(
    row("Show-Table", 11, "2026-08-01T00:00:00Z") +   // untouched
    row("Log-Repo", 9, "2026-08-01T00:00:00Z") +      // count moved, date did not
    row("Sync-Manifest", 11, "2026-08-19T00:00:00Z"), // new; Get-Text is gone
    CORPUS);
  assert.deepEqual(out.added, ["Sync-Manifest"]);
  assert.deepEqual(out.removed, ["Get-Text"]);
  assert.deepEqual(out.changed.map((c) => c.name), ["Log-Repo"]);
  assert.match(out.changed[0].why, /actions 8 to 9/);
});

test("a date past the corpus cutoff is enough on its own", () => {
  const out = run(
    row("Show-Table", 11, "2026-08-19T00:00:00Z") +
    row("Log-Repo", 8, "2026-08-01T00:00:00Z") +
    row("Get-Text", 4, "2026-08-01T00:00:00Z"), CORPUS);
  assert.deepEqual(out.changed.map((c) => c.name), ["Show-Table"]);
  assert.match(out.changed[0].why, /modified 2026-08-19/);
  assert.deepEqual(out.added, []);
});

test("the cutoff comes from the corpus, not from today", () => {
  // Everything predates the newest dump, so nothing is behind however old it is.
  const out = run(CORPUS.map((r) => row(r.name, r.actions, "2020-01-01T00:00:00Z")).join(""), CORPUS);
  assert.deepEqual(out.cutoff, "2026-08-13");
  assert.deepEqual(out.changed, []);
});

test("a name carrying quotes or backslashes survives the round trip", () => {
  // The reason the manifest is marker text: Shortcuts has no escaping
  // primitive, so a JSON row built on the device would be broken by this name
  // and the whole sync would fail on one shortcut's title.
  const hostile = 'Say "hi" \\ now';
  const out = run(row(hostile, 3, "2026-08-19T00:00:00Z"), []);
  assert.deepEqual(out.added, [hostile]);
});

test("a name containing a marker word does not split the record", () => {
  const out = run(row("Get-lastModified-Report", 3, "2026-08-19T00:00:00Z"), []);
  assert.deepEqual(out.added, ["Get-lastModified-Report"]);
});

test("rows read the same whether the device joined them or not", () => {
  // A Text action fed a list may emit one string per item or one concatenated
  // string. Both must parse identically, since which one happens is not
  // something this side can control or reliably predict.
  const joined = row("A", 1, "2026-08-19T00:00:00Z") + row("B", 2, "2026-08-19T00:00:00Z");
  const runTogether = joined.replace(/\n==name==/g, "==name==");
  assert.deepEqual(run(joined, []).added, run(runTogether, []).added);
  assert.deepEqual(run(joined, []).added, ["A", "B"]);
});

test("the dump link names every changed shortcut and nothing else", () => {
  const out = run(row("New-One", 3, "2026-08-19T00:00:00Z") +
                  row("Show-Table", 11, "2026-08-01T00:00:00Z"), CORPUS);
  assert.equal(out.links.length, 1);
  const text = decodeURIComponent(out.links[0].split("&text=")[1]);
  assert.equal(text, "⟦New-One⟧");
  assert.match(out.links[0], /^shortcuts:\/\/run-shortcut\?name=Dump-Named/);
});

test("links chunk by estimated payload, not by count", () => {
  // One large shortcut must not ride along with others just because the list
  // is short: the cost of a link is bytes, and the failure is at the far end.
  const big = row("Huge", 2000, "2026-08-19T00:00:00Z");
  const small = row("Tiny", 1, "2026-08-19T00:00:00Z");
  assert.ok(run(big + small, []).links.length > 1, "a 2000-action export should split");
  assert.equal(run(small + small.replace("Tiny", "Tiny2"), []).links.length, 1);
});

test("a file that is not a manifest is refused rather than read as empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-"));
  fs.mkdirSync(path.join(dir, "shortcuts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "shortcuts", "index.json"), "[]");
  const mf = path.join(dir, "nope.txt");
  fs.writeFileSync(mf, "just some text\n");
  const r = spawnSync("python3", [TOOL, mf, "--private", dir],
    { cwd: ROOT, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /zero rows/);
});
