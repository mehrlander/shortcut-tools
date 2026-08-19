// Which copy of a duplicated name wins. Irrelevant while every dump was one
// day's folder-scoped export, and load-bearing the moment they span dates:
// then a duplicate is one shortcut at two points in its life, and the older one
// is the wrong answer.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

/** A zip holding one shortcut, built from a real committed plist. */
function dump(dir, file, name, actionCount) {
  const out = path.join(dir, file);
  execFileSync("python3", ["-c", `
import plistlib, zipfile, sys
d = plistlib.load(open(sys.argv[1], 'rb'))
d['WFWorkflowActions'] = d['WFWorkflowActions'][:int(sys.argv[4])]
with zipfile.ZipFile(sys.argv[2], 'w') as z:
    z.writestr(sys.argv[3] + '.wflow', plistlib.dumps(d, fmt=plistlib.FMT_XML))
`, path.join(ROOT, "plists", "Sync-Manifest.plist"), out, name, String(actionCount)]);
  return out;
}

function index(...zips) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "id-"));
  const json = path.join(dir, "i.json");
  execFileSync("python3", [path.join(ROOT, "tools", "index-dump.py"), ...zips, "--json", json],
    { cwd: ROOT, stdio: "ignore" });
  const out = JSON.parse(fs.readFileSync(json, "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test("a duplicated name keeps the copy from the last dump passed", () => {
  // The documented pipeline globs dumps/*.zip, which sorts by date, so "last
  // wins" is what makes a catch-up dump actually update the corpus. First-wins
  // would have made the sync quietly sync backwards.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "id-"));
  const older = dump(dir, "2026-08-13-01.zip", "Show-Html", 23);
  const newer = dump(dir, "2026-08-18-recent.zip", "Show-Html", 9);

  const rows = index(older, newer);
  assert.equal(rows.length, 1, "one name, one row");
  assert.equal(rows[0].actions, 9, "the newer dump wins");
  assert.equal(rows[0].from, "2026-08-18-recent.zip", "and `from` says which it came from");

  // Order is by first sighting, so a re-run against the same set is stable.
  const second = dump(dir, "2026-08-19-later.zip", "Other", 3);
  const three = index(older, newer, second);
  assert.deepEqual(three.map((r) => r.name), ["Show-Html", "Other"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an unparseable plist still occupies its name", () => {
  // A record with `error` and no action count is how the corpus already carries
  // Get-YamlFromDictionary; it must not be silently replaced by nothing.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "id-"));
  const z = path.join(dir, "broken.zip");
  execFileSync("python3", ["-c", `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('Broken.wflow', b'not a plist at all')
`, z]);
  const rows = index(z);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Broken");
  assert.ok(rows[0].error, "the parse failure is recorded, not dropped");
  fs.rmSync(dir, { recursive: true, force: true });
});
