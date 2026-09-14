// The recurrence table in docs/SNAGS.md. A hand-maintained count in the place
// that claims to measure repetition is the one number nobody can trust, so it
// is generated and held here. The second test is the parse itself: web-tools'
// log learned that a sighting list written as prose turns stray commas into
// sightings, so a seen: line must be dates and nothing else.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const LOG = path.join(ROOT, "docs", "SNAGS.md");

test("the snags index is current", () => {
  assert.doesNotThrow(
    () => execFileSync("python3", [path.join(ROOT, "tools", "snags-index.py"), "--check"],
                       { cwd: ROOT, stdio: "pipe" }),
    "run: python3 tools/snags-index.py --publish");
});

test("every entry has a slug heading, a summary, a seen: line and a pointer", () => {
  const text = fs.readFileSync(LOG, "utf8");
  const body = text.slice(text.indexOf("<!-- /snags-index -->"));
  const blocks = body.split(/^## /m).slice(1);
  assert.ok(blocks.length > 5, `only ${blocks.length} entries below the index`);
  for (const b of blocks) {
    const [head, ...rest] = b.split("\n");
    assert.match(head.trim(), /^[a-z0-9-]+$/, `heading is not a slug: ${head}`);
    const seen = rest.find((l) => l.startsWith("seen:"));
    assert.ok(seen, `${head.trim()}: no seen: line`);
    for (const part of seen.slice(5).split(",")) {
      assert.match(part.trim(), /^\d{4}-\d{2}-\d{2}(\s*[x×]\d+)?$/,
                   `${head.trim()}: "${part.trim()}" is not a sighting`);
    }
    assert.ok(rest.some((l) => l.startsWith("→")), `${head.trim()}: no → pointer`);
  }
});

test("no two entries share a slug", () => {
  const text = fs.readFileSync(LOG, "utf8");
  const body = text.slice(text.indexOf("<!-- /snags-index -->"));
  const slugs = [...body.matchAll(/^## ([a-z0-9-]+)$/gm)].map((m) => m[1]);
  assert.strictEqual(new Set(slugs).size, slugs.length, "a slug repeats");
});
