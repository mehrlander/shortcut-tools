// catalog.json is the only machine-readable statement of what this repo
// contains, and a page renders it, so a stale one serves a table that looks
// right and names chains that changed underneath it. That is the same failure
// packed/ and plists/ each have a --check for; this is that check for the
// catalog. The generator is byte-deterministic, so --check is exact.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

test("catalog.json is current with workflows/", () => {
  assert.doesNotThrow(
    () => execFileSync("python3", [path.join(ROOT, "tools", "catalog.py"), "--check"],
                       { cwd: ROOT, stdio: "pipe" }),
    "run: python3 tools/catalog.py --publish");
});

test("every installable chain is in the catalog with its published build", () => {
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog.json"), "utf8"));
  const builds = JSON.parse(fs.readFileSync(path.join(ROOT, "plists", "builds.json"), "utf8"));
  const named = cat.rows.filter((r) => r.name);
  assert.strictEqual(named.length, Object.keys(builds).length,
    "the catalog and builds.json disagree on how many chains are installable");
  for (const r of named) {
    assert.strictEqual(r.build, builds[r.name],
      `${r.name}: the catalog's build id is not the published one`);
  }
});

// A target named by string is a name nothing validates, which this repo has
// already lost a fortnight to twice. The catalog is where every one of them is
// now visible in one place, so the audit is a set difference rather than a
// hand-written script in CLAUDE.md.
test("no chain calls a name that neither this repo nor the device library holds", () => {
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog.json"), "utf8"));
  const declared = new Set(cat.rows.filter((r) => r.name).map((r) => r.name));
  const outside = cat.external_targets.filter((t) => !declared.has(t));
  assert.deepStrictEqual(cat.external_targets, outside,
    "external_targets must exclude names this repo publishes");
});
