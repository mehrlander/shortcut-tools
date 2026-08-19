// The reader's job is to put a device dump back into the pipeline, so the test
// that matters is a round trip: a real workflow plist, serialized the way the
// device serializes it, read back, and re-indexed to the same record. The
// fixture is plists/Sync-Manifest.plist, which is committed here, so this runs
// on a public-only clone with no corpus checkout.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const TOOL = path.join(ROOT, "tools", "read-incoming.py");

/** A workflow plist as the JSON the device hands back from Get File of Type. */
function asJson(plistPath) {
  return execFileSync("python3", ["-c",
    "import plistlib,json,sys;print(json.dumps(plistlib.load(open(sys.argv[1],'rb')),default=str))",
    plistPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function record(name, json, modified) {
  return `==shortcut==\n${name}\n` +
         (modified === undefined ? "" : `==modified==\n${modified}\n`) +
         `==json==\n${json}\n`;
}

/** Run the reader in its own temp dir; `zip` names an output inside it. */
function run(text, zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-"));
  fs.writeFileSync(path.join(dir, "incoming.txt"), text);
  const out = zip ? path.join(dir, zip) : null;
  const r = spawnSync("python3",
    [TOOL, path.join(dir, "incoming.txt"), ...(out ? ["--zip", out] : [])],
    { cwd: ROOT, encoding: "utf8", timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  return { ...r, dir, zip: out };
}

const entries = (zip) => execFileSync("python3", ["-c",
  "import zipfile,sys;print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", zip],
  { encoding: "utf8" }).trim();

const PLIST = path.join(ROOT, "plists", "Sync-Manifest.plist");
const JSON_BODY = asJson(PLIST);

test("a dumped shortcut re-indexes to the record the pipeline expects", () => {
  const r = run(record("Sync-Manifest", JSON_BODY, "2026-08-18T19:49:20-07:00"), "out.zip");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const idx = path.join(r.dir, "i.json");
  execFileSync("python3", [path.join(ROOT, "tools", "index-dump.py"), r.zip, "--json", idx],
    { cwd: ROOT, stdio: "ignore" });
  const rec = JSON.parse(fs.readFileSync(idx, "utf8"))[0];
  assert.equal(rec.name, "Sync-Manifest", "the name rides in the zip entry, not the plist");
  assert.equal(rec.actions, 11);
  assert.ok(rec.kinds.some((k) => k[0] === "getmyworkflows"));
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test("a name with a slash is stored the way a device dump stores it", () => {
  // A dump entry name carries ":" where the shortcut has "/", so index.json
  // has one spelling. Writing the slash here would fork the corpus's naming,
  // and it is what made two of the first delta's deletions phantoms.
  const r = run(record("Unzip/Re-zip", JSON_BODY, "2026-08-18T19:49:20-07:00"), "out.zip");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(entries(r.zip), "Unzip:Re-zip.wflow");
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test("both dumpers' formats read the same, with or without a modified field", () => {
  // Dump-Named omits ==modified==; Dump-Recent includes it. Neither chain
  // should have to know what the other emits.
  const withDate = run(record("Sync-Manifest", JSON_BODY, "2026-08-18T19:49:20-07:00"));
  const without = run(record("Sync-Manifest", JSON_BODY));
  assert.equal(withDate.status, 0);
  assert.equal(without.status, 0);
  assert.match(withDate.stdout, /11 actions/);
  assert.match(without.stdout, /11 actions/);
});

test("an unreadable record is named and blocks the zip rather than being dropped", () => {
  // A half-written dump that silently produced a zip of the parts that worked
  // would land in the corpus looking complete.
  const r = run(record("Fine", JSON_BODY, "2026-08-18T19:49:20-07:00") +
                record("Broken", "{not json", "2026-08-18T19:49:20-07:00"), "never.zip");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Broken\s+UNREADABLE/);
  assert.match(r.stderr, /refusing to write a zip/);
  assert.ok(!fs.existsSync(r.zip), "a partial dump must not land looking complete");
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test("JSON that is not a workflow is refused, not written as one", () => {
  const r = run(record("Nope", '{"hello":"world"}', "2026-08-18T19:49:20-07:00"));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not a workflow/);
});

test("a file that is not a dump is refused rather than read as empty", () => {
  const r = run("just some text\n");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /zero records/);
});

test("a dump arriving at Dump-Recent's cap is flagged as probably truncated", () => {
  // A window can name the whole library, so the chain stops at 150. It has no
  // channel to say it dropped anything, which leaves the count as the only tell.
  const many = Array.from({ length: 150 }, (_, i) =>
    record("S" + i, JSON_BODY, "2026-08-18T19:49:20-07:00")).join("");
  const r = run(many);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /exactly Dump-Recent's cap/);
  fs.rmSync(r.dir, { recursive: true, force: true });

  const fewer = Array.from({ length: 149 }, (_, i) =>
    record("S" + i, JSON_BODY, "2026-08-18T19:49:20-07:00")).join("");
  const r2 = run(fewer);
  assert.doesNotMatch(r2.stdout, /cap/, "under the cap says nothing");
  fs.rmSync(r2.dir, { recursive: true, force: true });
});

test("a dump containing the dumpers themselves still splits into whole records", () => {
  // The first real dump was wide enough to include Dump-Recent and Dump-Named,
  // whose own text templates carry these markers, so the file held nine
  // "==shortcut==" where seven were records. An unanchored split cut two
  // records in half and reported them as malformed JSON: the dumper could not
  // dump itself. Anchoring to a whole line is sound rather than lucky, since
  // JSON escapes a newline as two characters and an embedded marker is
  // therefore never alone on a line.
  const selfJson = asJson(path.join(ROOT, "plists", "Dump-Recent.plist"));
  assert.ok(selfJson.includes("==shortcut=="), "fixture must carry the marker inline");
  const r = run(record("Dump-Recent", selfJson, "2026-08-18T20:49:48-07:00") +
                record("Sync-Manifest", JSON_BODY, "2026-08-18T19:49:39-07:00"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2 shortcut\(s\)/);
  assert.doesNotMatch(r.stdout, /UNREADABLE/);
  fs.rmSync(r.dir, { recursive: true, force: true });
});
