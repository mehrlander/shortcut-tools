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
  // In a temp directory, not workflows/: two chains claiming one name are
  // exactly what every other test globbing that directory must never see.
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "plist-"));
  const chain = { name: "Dupe-Probe", label: "x", actions: [{ id: "is.workflow.actions.comment", p: {} }] };
  fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify(chain));
  fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify(chain));
  try {
    assert.throws(() => run("--publish", "--workflows", dir), /both name themselves/);
    // And it fails clean. A one-pass publish wrote the first claimant before
    // noticing the second, leaving a plist no chain regenerates; one such file
    // sat in plists/ across two pull requests, failing the check above.
    assert.ok(!fs.existsSync(path.join(ROOT, "plists", "Dupe-Probe.plist")),
      "a refused publish must not leave a partial write behind");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The receivers-only assertion at the top of this file caught an orphan; the
// tool's own --check did not, and reported the same tree current. A withdrawn
// receiver therefore kept serving an install link that worked and delivered
// something the repo had retracted. Both gates now say the same thing.
//
// In a temp pair, for the reason the duplicate-name probe above gives: an
// orphan visible in the real plists/ is precisely what that first assertion
// would trip over.
test("a plist no chain claims is reported by --check and removed by --publish", () => {
  const os = require("node:os");
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "plist-src-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "plist-out-"));
  try {
    fs.writeFileSync(path.join(src, "kept.json"), JSON.stringify(
      { name: "Kept-Probe", label: "x", actions: [{ id: "is.workflow.actions.comment", p: {} }] }));
    run("--publish", "--workflows", src, "--out", out);
    fs.writeFileSync(path.join(out, "Withdrawn-Probe.plist"), "not a plist");

    assert.throws(() => run("--check", "--workflows", src, "--out", out),
      /Withdrawn-Probe\.plist \(no chain claims it\)/,
      "--check must name the orphan as unclaimed, not as stale");

    run("--publish", "--workflows", src, "--out", out);
    assert.deepStrictEqual(fs.readdirSync(out).sort(), ["Kept-Probe.plist"]);
    assert.doesNotThrow(() => run("--check", "--workflows", src, "--out", out));
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

// The prune can delete, so the case that must hold is the one the duplicate
// probe already exercises: --workflows alone aims a foreign chain set at the
// real plists/, where deleting everything unclaimed would take all 21.
test("--workflows without --out never prunes, since the pair is not matched", () => {
  const os = require("node:os");
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "plist-foreign-"));
  const before = fs.readdirSync(path.join(ROOT, "plists")).sort();
  try {
    fs.writeFileSync(path.join(src, "lone.json"), JSON.stringify(
      { name: "Lone-Probe", label: "x", actions: [{ id: "is.workflow.actions.comment", p: {} }] }));
    run("--publish", "--workflows", src);
    assert.deepStrictEqual(
      fs.readdirSync(path.join(ROOT, "plists")).filter(f => f !== "Lone-Probe.plist").sort(),
      before, "a foreign chain set must not take the real receiver mirror with it");
  } finally {
    fs.rmSync(path.join(ROOT, "plists", "Lone-Probe.plist"), { force: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test("--link emits the install link rather than leaving it to be typed", () => {
  // Same failure --url fixed for the paste route: the form was documented and
  // nothing emitted it, so it was retyped on every install.
  const out = run("workflows/sync-manifest.json", "--link", "--ref", "some/branch").trim();
  assert.match(out, /^shortcuts:\/\/run-shortcut\?name=Library-Import&input=text&text=/);
  const payload = decodeURIComponent(out.split("&text=")[1]);
  const [name, url] = payload.split("\n");
  assert.equal(name, "Sync-Manifest", "Library-Import reads the name from line one");
  assert.equal(url, "https://raw.githubusercontent.com/mehrlander/shortcut-tools/" +
                    "some/branch/plists/Sync-Manifest.plist");
});

test("--link refuses a chain that declares no name", () => {
  // A chain without a name has no plist, so the link would 404 on tap.
  assert.throws(() => run("workflows/menu.json", "--link"), /declares no name/);
});
