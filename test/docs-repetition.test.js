const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DOCS = [
  "README.md", "CLAUDE.md", "workflows/README.md",
  ...fs.readdirSync(path.join(ROOT, "docs")).filter(f => f.endsWith(".md")).map(f => "docs/" + f),
];

// A paragraph repeated verbatim inside one document is invisible to a
// cross-file duplicate scanner by construction, and to a word cap because it
// fits inside the budget. It happened here: shortcuts-format-notes.md carried
// two copies of two sections for three weeks, one with the condition-code
// table settled and one still saying "do not guess". Long paragraphs only, so
// a repeated one-line list item or table separator does not trip it.
const MIN = 120;
const paragraphs = (text) => text.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length >= MIN);

for (const rel of DOCS) {
  test(`${rel} repeats no paragraph`, () => {
    const seen = new Map();
    const dups = [];
    for (const p of paragraphs(fs.readFileSync(path.join(ROOT, rel), "utf8"))) {
      if (seen.has(p)) dups.push(p.slice(0, 80).replace(/\n/g, " "));
      seen.set(p, true);
    }
    assert.deepStrictEqual(dups, [], `repeated paragraph(s) in ${rel}`);
  });

  test(`${rel} repeats no section heading`, () => {
    const heads = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n").filter(l => /^##+ /.test(l));
    const dups = heads.filter((h, i) => heads.indexOf(h) !== i);
    assert.deepStrictEqual([...new Set(dups)], [], `repeated heading(s) in ${rel}`);
  });
}
