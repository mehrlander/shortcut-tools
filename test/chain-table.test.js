// The chain table in workflows/README.md is the index of what is in this
// directory, and it is the only place a reader learns that a chain exists.
// Ten chains had drifted out of it, five of which appeared in no markdown at
// all, so a receiver could ship and stay unfindable. packed/ and plists/ each
// have a --check that fails when they fall behind workflows/; this is the same
// guarantee for the prose, which nothing was holding.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const README = path.join(ROOT, "workflows", "README.md");

test("every chain in workflows/ has a row in the README table", () => {
  const rows = new Set(
    [...fs.readFileSync(README, "utf8").matchAll(/^\| `([a-z0-9-]+)` \|/gm)]
      .map((m) => m[1]));
  const chains = fs.readdirSync(path.join(ROOT, "workflows"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
  const missing = chains.filter((c) => !rows.has(c));
  assert.deepStrictEqual(missing, [],
    `add a row to workflows/README.md for: ${missing.join(", ")}`);
});

test("every row in the README table names a chain that exists", () => {
  const rows = [...fs.readFileSync(README, "utf8")
    .matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
  const orphans = rows.filter(
    (r) => !fs.existsSync(path.join(ROOT, "workflows", `${r}.json`)));
  assert.deepStrictEqual(orphans, [],
    `these rows name no chain: ${orphans.join(", ")}`);
});
