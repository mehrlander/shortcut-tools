const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PRIVATE = process.env.WEB_TOOLS_PRIVATE || path.join(ROOT, "..", "web-tools-private");

// edit.py reads the device's exported copy of a shortcut, so it needs the
// private checkout; without one there is nothing to apply an edit to.
test("edit.py puts the cards right after the named line, and says nothing else changed",
  { skip: !fs.existsSync(path.join(PRIVATE, "shortcuts", "dumps")) && "no web-tools-private checkout" }, () => {
  const r = spawnSync("python3", ["tools/edit.py", "Show-Loop", "workflows/stop-output-card.json", "--after", "26", "--payload"],
    { cwd: ROOT, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  const b = JSON.parse(r.stdout);
  const strip = t => t.split("\n").map(l => l.slice(4).replace(/«\d+»/g, "«»"));
  const before = strip(b.before), after = strip(b.after);
  assert.strictEqual(after.length, before.length + 1);
  assert.match(b.after.split("\n")[27], /^ 27\s+output$/);
  assert.deepStrictEqual([...after.slice(0, 27), ...after.slice(28)], before, "every other line is unchanged");
  assert.match(b.cards, /packed\/stop-output-card\.json$/);
});
