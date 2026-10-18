// Every tracked path must be one Windows can hold, or a clone on the laptop
// fails its checkout. The sketches this repo writes into web-tools-private are
// checked here too, because this is where their names are made; that half
// skips where no web-tools-private checkout sits beside this one.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

function illegal(rel) {
  return rel.split("/").some(seg => /[<>:"\\|?*\x00-\x1f]/.test(seg) || /[. ]$/.test(seg) || RESERVED.test(seg));
}

function tracked(dir) {
  const r = spawnSync("git", ["-c", "core.quotePath=false", "-C", dir, "ls-files", "-z"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.split("\0").filter(Boolean);
}

test("every tracked path in this repo is legal on Windows", () => {
  assert.deepEqual(tracked(ROOT).filter(illegal), []);
});

test("every tracked path in web-tools-private is legal on Windows", (t) => {
  const dir = process.env.WEB_TOOLS_PRIVATE || path.join(ROOT, "..", "web-tools-private");
  if (!fs.existsSync(path.join(dir, ".git"))) return t.skip("no web-tools-private checkout");
  assert.deepEqual(tracked(dir).filter(illegal), []);
});

test("file_name and the library page apply one rule", () => {
  const names = ["REF: Edit iCloud JSON", "SVG > PNG", "Unzip/Re-zip", "Where Are You?", "Plain-Name"];
  const r = spawnSync("python3", ["-c",
    "import json, sys; sys.path.insert(0, 'tools'); from sketch import file_name; " +
    "print(json.dumps([file_name(n) for n in json.loads(sys.argv[1])]))", JSON.stringify(names)],
    { cwd: ROOT, encoding: "utf8" });
  const py = JSON.parse(r.stdout);
  const page = fs.readFileSync(path.join(ROOT, "pages", "library.html"), "utf8");
  const m = page.match(/'shortcuts\/sketches\/' \+ name\.replace\((\/.+?\/g), '_'\)/);
  assert.ok(m, "library.html builds the sketch path with a replace() this test can read");
  const rule = eval(m[1]);
  assert.deepEqual(names.map(n => n.replace(rule, "_")), py);
  assert.ok(!py.some(n => illegal(n)), "file_name leaves nothing Windows refuses");
});
