const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

function survey(index, ...args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "survey-"));
  const f = path.join(dir, "index.json");
  fs.writeFileSync(f, JSON.stringify(index));
  const out = execFileSync("python3",
    [path.join("tools", "survey.py"), f, "-o", path.join(dir, "p.html"), ...args],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { stdout: out, page: fs.existsSync(path.join(dir, "p.html"))
    ? fs.readFileSync(path.join(dir, "p.html"), "utf8") : null };
}

// The --json path, which pages/library.html renders. Kept separate because it
// writes data rather than a page and takes no -o.
function surveyJson(index, ...args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "survey-"));
  const f = path.join(dir, "index.json");
  const out = path.join(dir, "library.json");
  fs.writeFileSync(f, JSON.stringify(index));
  execFileSync("python3", [path.join("tools", "survey.py"), f, "--json", out, ...args],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

const S = (name, calls = [], extra = {}) =>
  Object.assign({ name, calls, actions: 1, computed_calls: 0, takes_input: false,
                  menu: false, kinds: [], from: "d.zip" }, extra);

const LIB = [
  S("Show-Loop", ["Run-List", "Gone-Target", "Show-Loop"]),   // self-call is the demo idiom
  S("Run-List", ["Deep-Thing"]),
  S("Deep-Thing"),
  S("Use-Shortcut"), S("Get-Text"),
  S("Solo-Verb"),                                             // authored, nothing calls it
  S("Helper-Verb"), S("Calls-Helper", ["Helper-Verb"]),
  S("Old-Thing 1"), S("SomethingOld"),
  S("Third Party App"),
  S("Another App", ["Companion Thing"]),                      // imported wanting a companion
  S("Third Party App 2"),                                     // imported AND a numbered copy
];

test("the core is the closure of the hubs, and a self-call is not a dependency", () => {
  const { page } = survey(LIB);
  const data = JSON.parse(page.match(/var DATA = (\[.*?\]), MISSING/s)[1]);
  const tierOf = Object.fromEntries(data.map(r => [r.name, r.tier]));
  assert.strictEqual(tierOf["Show-Loop"], "core");
  assert.strictEqual(tierOf["Deep-Thing"], "core", "two hops out is still the core");
  assert.strictEqual(data.find(r => r.name === "Deep-Thing").depth, 2);
  assert.ok(!data.find(r => r.name === "Show-Loop").calls.includes("Show-Loop"),
    "a self-call is the self-demo idiom and would inflate the graph");
});

test("sediment and imports are separated from authored work", () => {
  const { page } = survey(LIB);
  const data = JSON.parse(page.match(/var DATA = (\[.*?\]), MISSING/s)[1]);
  const tierOf = Object.fromEntries(data.map(r => [r.name, r.tier]));
  assert.strictEqual(tierOf["Old-Thing 1"], "sediment");
  assert.strictEqual(tierOf["SomethingOld"], "sediment");
  assert.strictEqual(tierOf["Third Party App"], "imported");
  assert.strictEqual(tierOf["Solo-Verb"], "prune", "authored and uncalled is the prune list");
  assert.strictEqual(tierOf["Helper-Verb"], "kept", "authored and called is not");
});

// The claim the pruning advice rests on: a name the archive lacks is usually a
// rename nobody updated, not a lost shortcut. Who calls it is what tells them
// apart, so the grouping is the finding and has to hold.
test("--dangling groups a missing target by who wants it", () => {
  const { stdout } = survey(LIB, "--dangling");
  assert.match(stdout, /1 {2}imported callers only/, "a companion only an import wants");
  // Rule order matters: a numbered import is sediment before it is imported,
  // so "Third Party App 2" would land its target in dead-code, not here.
  assert.match(stdout, /1 {2}reachable from the core/);
  assert.match(stdout, /Gone-Target\s+<- Show-Loop/,
    "a live caller is the case worth acting on, and names the caller");
  assert.ok(!/Companion Thing\s+<-/.test(stdout),
    "only core-reachable targets are listed in full");
});

test("a rename far apart as a string is still suggested, by its distinctive word", () => {
  const { stdout } = survey(
    [S("Show-Convert", ["Get-Jina"]), S("Get-LinkSummaryJina"), S("Show-Loop", ["Show-Convert"])],
    "--dangling");
  assert.match(stdout, /Get-Jina.*maybe now: Get-LinkSummaryJina/,
    "difflib alone scores these far apart; the shared word is the signal");
});

// The five tiers are a cascade over three independent facts, so a single bucket
// hides pairs: an imported shortcut that is also a numbered duplicate reports as
// sediment, and the Imported count understates the real total. The facets are
// the facts; the tier is a recommended action over them.
test("every row carries the three facets the tier collapses", () => {
  const { page } = survey(LIB);
  const data = JSON.parse(page.match(/var DATA = (\[.*?\]), MISSING/s)[1]);
  const row = n => data.find(r => r.name === n);

  assert.deepStrictEqual(
    { p: row("Another App").provenance, l: row("Another App").lifecycle },
    { p: "imported", l: "live" });
  // The pair the single tier cannot express: imported and a numbered copy at
  // once. It reports as sediment, so the Imported count loses it. 28 real ones.
  assert.strictEqual(row("Third Party App 2").tier, "sediment");
  assert.strictEqual(row("Third Party App 2").provenance, "imported");
  assert.strictEqual(row("Third Party App 2").lifecycle, "residue");
  assert.strictEqual(row("Old-Thing 1").provenance, "authored",
    "Old-Thing is Verb-Noun shaped, so a numbered copy of it is still authored");
  assert.strictEqual(row("Show-Loop").connectivity, "reachable");
  assert.strictEqual(row("Helper-Verb").connectivity, "called");
  assert.strictEqual(row("Solo-Verb").connectivity, "uncalled");

  // The count the tier cannot give you.
  const imported = data.filter(r => r.provenance === "imported").length;
  const importedTier = data.filter(r => r.tier === "imported").length;
  assert.ok(imported > importedTier,
    `the Imported tier (${importedTier}) should understate real imports (${imported})`);
});

test("the page offers a chip per facet value, not only per tier", () => {
  const { page } = survey(LIB);
  for (const v of ["authored", "imported", "live", "residue", "reachable", "called", "uncalled"]) {
    assert.ok(page.includes(`data-v="${v}"`), v + " should be filterable");
  }
  assert.match(page, /for \(var axis in facets\)/,
    "the axes must combine rather than override each other");
});

test("the page carries every shortcut and no stray slot", () => {
  const { page } = survey(LIB);
  assert.ok(!/__[A-Z]+__/.test(page), "an unfilled slot would ship as literal text");
  for (const s of LIB) assert.ok(page.includes(s.name), s.name + " should be in the page");
});

// ── --json: the structured stage behind pages/library.html ──────────────────
// The page renders these rows and derives none of them, so the grading rules
// are only stated here. A nomination is a question to answer on the device,
// which is why these tests are mostly about what is NOT nominated.

test("--json carries the rows, the dangling report, and the counts", () => {
  const p = surveyJson(LIB);
  assert.strictEqual(p.rows.length, LIB.length);
  assert.strictEqual(p.meta.shortcuts, LIB.length);
  assert.deepStrictEqual(p.meta.hubs, ["Show-Loop", "Use-Shortcut", "Get-Text"]);
  assert.ok(Array.isArray(p.dangling), "the dangling report rides the same read");
  assert.ok(p.dangling.some(d => d.target === "Gone-Target"),
    "a call to a name the archive lacks should be reported");
  assert.ok(p.meta.tier_label.core && p.meta.tier_why.core,
    "the page shows tier labels and rationales it does not itself author");
});

test("a duplicate whose original is still here grades high, and names it", () => {
  const rows = surveyJson(LIB).rows;
  const dup = rows.find(r => r.name === "Third Party App 2");
  assert.strictEqual(dup.nominate.confidence, "high");
  assert.strictEqual(dup.nominate.original, "Third Party App");
  assert.match(dup.nominate.reason, /still here/);
});

test("a duplicate whose original is gone grades medium, not high", () => {
  const rows = surveyJson(LIB).rows;
  for (const name of ["Old-Thing 1", "SomethingOld"]) {
    const r = rows.find(x => x.name === name);
    assert.strictEqual(r.nominate.confidence, "medium",
      `${name} has no surviving original, so the suffix is evidence about the name only`);
    assert.strictEqual(r.nominate.original, null);
  }
});

test("the Uncalled tier is never nominated, at any grade", () => {
  const rows = surveyJson(LIB).rows;
  const solo = rows.find(r => r.name === "Solo-Verb");
  assert.strictEqual(solo.tier, "prune");
  assert.strictEqual(solo.nominate, null,
    "authored and uncalled is what a Home Screen, widget, share sheet, or Siri entry point looks like here");
  // The claim is about the TIER, not the facet pair: `Old-Thing 1` is authored
  // and uncalled too, and is nominated, because the residue rule reads its name
  // and fires first. The tier cascade is what puts it outside the prune tier.
  for (const r of rows) {
    if (r.tier === "prune") assert.strictEqual(r.nominate, null,
      `${r.name} is in the Uncalled tier and should not be nominated`);
  }
});

test("an import nothing calls grades low, never higher", () => {
  const rows = surveyJson(LIB).rows;
  const imp = rows.find(r => r.name === "Third Party App");
  assert.strictEqual(imp.nominate.confidence, "low");
  assert.match(imp.nominate.reason, /nothing here calls it/);
});

test("a core shortcut is never nominated, however its name is spelled", () => {
  // Two of the real library's 42 core shortcuts are numbered duplicates and are
  // load-bearing anyway, so the core guard has to beat the residue rule.
  const lib = [
    S("Show-Loop", ["Helper 1"]),
    S("Helper 1"),              // reachable AND named like duplicate-on-edit residue
    S("Helper"),                // its "original" exists, so the rule would fire
    S("Use-Shortcut"), S("Get-Text"),
  ];
  const rows = surveyJson(lib).rows;
  const h = rows.find(r => r.name === "Helper 1");
  assert.strictEqual(h.tier, "core");
  assert.strictEqual(h.lifecycle, "residue", "the name still reads as residue");
  assert.strictEqual(h.nominate, null, "but the core guard wins");
});

test("every nomination carries a grade the page can filter on", () => {
  const p = surveyJson(LIB);
  const graded = p.rows.filter(r => r.nominate);
  assert.ok(graded.length > 0);
  for (const r of graded) {
    assert.ok(["high", "medium", "low"].includes(r.nominate.confidence), r.name);
    assert.ok(r.nominate.reason, r.name + " should say why");
  }
  const total = Object.values(p.meta.nominated).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, graded.length, "meta.nominated must total the graded rows");
});
