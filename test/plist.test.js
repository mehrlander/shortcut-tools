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

// The install link is the plist's counterpart to `pack.py --url`: the sender
// generates it rather than typing it, so a wrong character 404s at the fetch
// instead of installing something adjacent.
test("--install emits a Library-Import link naming the chain and its plist", () => {
  const link = run("workflows/show-toss.json", "--install").trim();
  assert.match(link, /^shortcuts:\/\/run-shortcut\?name=Library-Import&input=text&text=/);
  const text = decodeURIComponent(new URL(link).searchParams.get("text"));
  const [name, url] = text.split("\n");
  assert.strictEqual(name, "Show-Toss", "line 1 is the name Library-Import imports under");
  assert.strictEqual(url,
    "https://raw.githubusercontent.com/mehrlander/shortcut-tools/main/plists/Show-Toss.plist",
    "line 2 is the plist Library-Import fetches");
});

test("--install --ref reads from that ref, so a branch can be tested before merge", () => {
  const link = run("workflows/show-toss.json", "--install", "--ref", "some-branch").trim();
  const text = decodeURIComponent(new URL(link).searchParams.get("text"));
  assert.match(text, /shortcut-tools\/some-branch\/plists\/Show-Toss\.plist$/);
});

test("a chain with no name has no install link, and says so", () => {
  assert.throws(() => run("workflows/menu.json", "--install"), /declares no name/);
});
