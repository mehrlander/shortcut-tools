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

test("the page carries every shortcut and no stray slot", () => {
  const { page } = survey(LIB);
  assert.ok(!/__[A-Z]+__/.test(page), "an unfilled slot would ship as literal text");
  for (const s of LIB) assert.ok(page.includes(s.name), s.name + " should be in the page");
});
