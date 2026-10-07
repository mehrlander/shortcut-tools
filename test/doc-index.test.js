// The generated contents block in a long doc. Two things can go wrong and only
// one of them is loud: the block falls behind its headings (caught by --check),
// or a slug is subtly not the one GitHub computes, which produces a link that
// scrolls nowhere and is the single way a contents block is worse than none.
// The fixtures below are the shapes this repo's headings actually take:
// backticks, a colon, quotes, an em-free dash, and a duplicate.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DOCS = ["docs/shortcuts-format-notes.md", "workflows/README.md"];

test("every opted-in doc index is current", () => {
  assert.doesNotThrow(
    () => execFileSync("python3", [path.join(ROOT, "tools", "doc-index.py"), "--check"],
                       { cwd: ROOT, stdio: "pipe" }),
    "run: python3 tools/doc-index.py --publish");
});

// GitHub's own rule, which the generator reimplements: lowercase, drop
// punctuation, spaces to hyphens, a numeric suffix on a repeat.
const SLUGS = [
  ["Control flow is three actions sharing a UUID", "control-flow-is-three-actions-sharing-a-uuid"],
  ["`Type: \"Ask\"` is the fourth attachment value", "type-ask-is-the-fourth-attachment-value"],
  ["`Show-Html`: what it does to a page on the way through",
   "show-html-what-it-does-to-a-page-on-the-way-through"],
  ["An `If` with several conditions uses a different shape entirely",
   "an-if-with-several-conditions-uses-a-different-shape-entirely"],
];

test("the generated anchors match GitHub's slug for this repo's heading shapes", () => {
  const text = DOCS.map(d => fs.readFileSync(path.join(ROOT, d), "utf8")).join("\n");
  for (const [title, want] of SLUGS) {
    if (!text.includes("## " + title)) continue;        // the heading may be renamed
    assert.ok(text.includes(`(#${want})`), `no row links to #${want} for "${title}"`);
  }
});

for (const rel of DOCS) {
  test(`${rel}: every index row points at a heading, and no anchor repeats`, () => {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const start = text.indexOf("<!-- doc-index -->");
    const end = text.indexOf("<!-- /doc-index -->");
    assert.ok(start >= 0 && end > start, `${rel} carries no doc-index block`);
    const rows = [...text.slice(start, end).matchAll(/^\s*- \[(.+)\]\(#([^)]+)\)$/gm)];
    assert.ok(rows.length > 5, `${rel}: the block has ${rows.length} rows`);

    const anchors = rows.map(m => m[2]);
    assert.strictEqual(new Set(anchors).size, anchors.length, `${rel}: an anchor repeats`);

    // Every row's title has to be a real heading BELOW the block, so a renamed
    // section cannot keep a row pointing at prose that no longer says it.
    const below = text.slice(end);
    for (const m of rows)
      assert.ok(new RegExp(`^#{2,3} ${m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(below),
                `${rel}: "${m[1]}" is indexed but is not a heading`);
  });
}
