const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const plib = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const run = (...a) => plib.execFileSync("python3", [path.join("tools", "plist.py"), ...a],
  { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const named = () => fs.readdirSync(path.join(ROOT, "workflows"))
  .filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", f), "utf8")))
  .filter(c => c.name);

test("plists/ holds a file for every named chain, and nothing else", () => {
  const want = new Set(named().map(c => c.name + ".plist"));
  const have = new Set(fs.readdirSync(path.join(ROOT, "plists")).filter(f => f.endsWith(".plist")));
  assert.deepStrictEqual([...have].sort(), [...want].sort(),
    "plists/ is receivers only: a chain opts in by declaring a name");
});

// A stale plist serves an install that works and delivers the wrong shortcut,
// which is the same failure packed/ is guarded against.
test("plists/ is current with workflows/", () => {
  assert.doesNotThrow(() => run("--check"));
});

test("a shortcut reading Shortcut Input says so in the file", () => {
  // The mismatch that makes an imported shortcut look broken for no visible
  // reason: the chain reads ExtensionInput, the envelope claims it does not.
  const src = fs.readFileSync(path.join(ROOT, "plists", "Log-Repo.plist"), "utf8");
  assert.match(src, /<key>WFWorkflowHasShortcutInputVariables<\/key>\s*<true\/>/);
});

test("file-level settings only a plist can carry survive the build", () => {
  const src = fs.readFileSync(path.join(ROOT, "plists", "Capture-Link.plist"), "utf8");
  assert.match(src, /ActionExtension/, "Show in Share Sheet is a WFWorkflowTypes entry");
  assert.match(src, /WFSafariWebPageContentItem/, "and the accepted input classes ride with it");
  // No paste reaches either, which is the whole reason this generator exists.
  const packed = fs.readFileSync(path.join(ROOT, "packed", "capture-link.json"), "utf8");
  assert.ok(!packed.includes("ActionExtension"),
    "the packed form carries actions only, by construction");
});

test("two chains claiming one name fail loudly rather than overwriting", () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "plist-"));
  const a = path.join(ROOT, "workflows", "__dupe-a.json");
  const b = path.join(ROOT, "workflows", "__dupe-b.json");
  const chain = { name: "Dupe-Probe", label: "x", actions: [{ id: "is.workflow.actions.comment", p: {} }] };
  fs.writeFileSync(a, JSON.stringify(chain));
  fs.writeFileSync(b, JSON.stringify(chain));
  try {
    assert.throws(() => run("--publish"), /both name themselves/);
  } finally {
    fs.rmSync(a); fs.rmSync(b); fs.rmSync(dir, { recursive: true, force: true });
    run("--publish");
  }
});
