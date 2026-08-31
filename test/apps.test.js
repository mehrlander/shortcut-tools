const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const apps = (...args) =>
  execFileSync("python3", [path.join("tools", "apps.py"), ...args],
               { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// A two-shortcut corpus: one picks an app, one calls a vendor's action.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apps-"));
  const wflow = (actions) =>
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>" +
    "<key>WFWorkflowActions</key><array>" + actions + "</array></dict></plist>";
  const pick = (bundle, name) =>
    "<dict><key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.openapp</string>" +
    "<key>WFWorkflowActionParameters</key><dict><key>WFSelectedApp</key><dict>" +
    `<key>BundleIdentifier</key><string>${bundle}</string>` +
    `<key>Name</key><string>${name}</string></dict></dict></dict>`;
  const vend = (ident) =>
    `<dict><key>WFWorkflowActionIdentifier</key><string>${ident}</string>` +
    "<key>WFWorkflowActionParameters</key><dict/></dict>";

  const zip = path.join(dir, "fix.zip");
  const a = path.join(dir, "A.wflow"), b = path.join(dir, "B.wflow");
  // WhatsApp's Name carries a leading LTR mark on the device; Charty's does not.
  fs.writeFileSync(a, wflow(pick("net.whatsapp.WhatsApp", "‎WhatsApp") +
                            pick("com.brogrammers.charty", "Charty")));
  fs.writeFileSync(b, wflow(vend("com.brogrammers.charty.MakeChartIntent")));
  execFileSync("zip", ["-qj", zip, a, b]);
  return { dir, zip };
}

const read = (zip, extra = []) =>
  JSON.parse(apps(zip, ...extra));

test("a bundle id is counted separately as picked and as a vendor", () => {
  const { zip } = fixture();
  const rows = read(zip).apps;
  const charty = rows.find((r) => r.bundle_id === "com.brogrammers.charty");
  assert.equal(charty.picked_in_actions, 1, "picked once via the app picker");
  assert.equal(charty.actions_used, 1, "and vends one action that is called");
  const wa = rows.find((r) => r.bundle_id === "net.whatsapp.WhatsApp");
  assert.equal(wa.actions_used, 0, "picked but never called: the two columns differ");
});

// The whole point of the registry is that these two are different questions,
// so `installed` must stay unknown rather than defaulting to false.
test("installed is null until a screenshot pass supplies names", () => {
  const { zip } = fixture();
  assert.ok(read(zip).apps.every((r) => r.installed === null));
});

test("the name join tolerates how differently iOS writes one app's name", () => {
  const { dir, zip } = fixture();
  const names = path.join(dir, "names.txt");
  // As they read off a Home Screen: no LTR mark, and a comment line to ignore.
  fs.writeFileSync(names, "# from Settings -> Apps\nWhatsApp\n");
  const rows = read(zip, ["--names", names]).apps;
  const wa = rows.find((r) => r.bundle_id === "net.whatsapp.WhatsApp");
  assert.equal(wa.installed, true, "the LTR mark must not break the join");
  const charty = rows.find((r) => r.bundle_id === "com.brogrammers.charty");
  assert.equal(charty.installed, null, "a name the pass did not carry stays unproven");
});

test("a screenshot name with no bundle id becomes its own row, not an error", () => {
  const { dir, zip } = fixture();
  const names = path.join(dir, "names.txt");
  fs.writeFileSync(names, "Overcast\n");
  const rows = read(zip, ["--names", names]).apps;
  const orphan = rows.find((r) => r.name === "Overcast");
  assert.ok(orphan, "an app you own but never scripted still gets a row");
  assert.equal(orphan.bundle_id, null);
  assert.equal(orphan.installed, true);
});

// The shot list has to shrink as the catalog covers more, or it is not a list.
test("--targets names only vendors with actions used and no catalog entry", () => {
  const { dir, zip } = fixture();
  const cat = path.join(dir, "cat.json");
  fs.writeFileSync(cat, JSON.stringify({ ids: [] }));
  assert.match(apps(zip, "--targets"), /com\.brogrammers\.charty/);

  fs.writeFileSync(cat, JSON.stringify({ ids: ["com.brogrammers.charty.MakeChartIntent"] }));
  const covered = apps(zip, "--targets", "--catalog", cat);
  assert.doesNotMatch(covered, /com\.brogrammers\.charty/,
                      "a documented vendor drops off the shot list");
  assert.match(covered, /^0 vendors/);
});

// The capture can only prove presence. Settings -> Apps omits SpringBoard and
// Camera, and a pass can miss a screen, so absence from it is not absence.
test("a names pass never marks a row false", () => {
  const { dir, zip } = fixture();
  const names = path.join(dir, "names.txt");
  fs.writeFileSync(names, "WhatsApp\n");
  const rows = read(zip, ["--names", names]).apps;
  assert.ok(rows.every((r) => r.installed !== false));
  const charty = rows.find((r) => r.bundle_id === "com.brogrammers.charty");
  assert.equal(charty.installed, null, "not seen is unproven, not absent");
});

// Apple ships com.apple.mobilenotes and com.apple.Notes both labelled "Notes";
// a screenshot cannot tell them apart, so both must be marked.
test("one label marks every bundle id that answers to it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apps2-"));
  const dup =
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>" +
    "<key>WFWorkflowActions</key><array>" +
    ["com.apple.mobilenotes", "com.apple.Notes"].map((b) =>
      "<dict><key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.openapp</string>" +
      "<key>WFWorkflowActionParameters</key><dict><key>WFSelectedApp</key><dict>" +
      `<key>BundleIdentifier</key><string>${b}</string>` +
      "<key>Name</key><string>Notes</string></dict></dict></dict>").join("") +
    "</array></dict></plist>";
  const f = path.join(dir, "N.wflow"), zip = path.join(dir, "dup.zip");
  fs.writeFileSync(f, dup);
  execFileSync("zip", ["-qj", zip, f]);
  const names = path.join(dir, "names.txt");
  fs.writeFileSync(names, "Notes\n");
  const rows = JSON.parse(apps(zip, "--names", names)).apps;
  const marked = rows.filter((r) => r.installed === true);
  assert.equal(marked.length, 2, "both Notes bundles are proven installed");
});

// A vendor-only row has no picker Name, so without a derived one it can never
// join and the app splits into two rows that disagree about being installed.
test("a vendor-only row gets a name from its bundle id and can join", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apps3-"));
  const w =
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>" +
    "<key>WFWorkflowActions</key><array>" +
    "<dict><key>WFWorkflowActionIdentifier</key>" +
    "<string>dk.simonbs.DataJar.SetValueIntent</string>" +
    "<key>WFWorkflowActionParameters</key><dict/></dict>" +
    "</array></dict></plist>";
  const f = path.join(dir, "V.wflow"), zip = path.join(dir, "v.zip");
  fs.writeFileSync(f, w);
  execFileSync("zip", ["-qj", zip, f]);
  const bare = JSON.parse(apps(zip)).apps[0];
  assert.equal(bare.name, "Data Jar", "camelCase splits back into the label");

  const names = path.join(dir, "names.txt");
  fs.writeFileSync(names, "Data Jar\n");
  const rows = JSON.parse(apps(zip, "--names", names)).apps;
  assert.equal(rows.length, 1, "one app, not an orphan row beside a vendor row");
  assert.equal(rows[0].installed, true);
});

// A payload from a chain running two recognizers is a dict per screenshot. One
// engine space-joins a screen, losing the line breaks that mark a label's end,
// so the parse must take the richer read rather than the first one.
test("a dual-read payload parses from the richer engine", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
  const p = path.join(dir, "dual.txt");
  fs.writeFileSync(p, "shots name=Read-Shots build=abc count=1\n" + JSON.stringify({
    "Extract text from": "Apps\nAcrobat\nAirtable\nQ Search Apps",
    "Recognize text in": "Apps Acrobat Airtable Q Search Apps",
  }) + "\n");
  const out = execFileSync("python3", [path.join("tools", "shots.py"), p],
                           { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(out, ["Acrobat", "Airtable"]);
});

// The registry is derived from dumps, catalogs and a names file, none of which
// announce a change, so without a gate it is the one artifact here that could
// silently disagree with all three.
test("--check passes on a current registry and fails on a stale one", () => {
  const { dir, zip } = fixture();
  const out = path.join(dir, "apps.json");
  apps(zip, "--json", out);
  assert.match(apps(zip, "--json", out, "--check"), /is current/);

  const reg = JSON.parse(fs.readFileSync(out, "utf8"));
  reg.apps[0].picked_in_actions = 999;
  fs.writeFileSync(out, JSON.stringify(reg, null, 1) + "\n");
  assert.throws(() => apps(zip, "--json", out, "--check"), /stale/);
});

// Rows are built from a set and two bundle ids can carry one label, so a
// name-only sort key left ties to hash order. The gate caught it on first use.
test("the registry is byte-identical across runs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apps4-"));
  const w = (b) =>
    "<dict><key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.openapp</string>" +
    "<key>WFWorkflowActionParameters</key><dict><key>WFSelectedApp</key><dict>" +
    `<key>BundleIdentifier</key><string>${b}</string>` +
    "<key>Name</key><string>GitHub</string></dict></dict></dict>";
  const f = path.join(dir, "G.wflow"), zip = path.join(dir, "g.zip");
  fs.writeFileSync(f,
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>" +
    "<key>WFWorkflowActions</key><array>" +
    w("com.github.stormbreaker") + w("com.github.stormbreaker.prod") +
    "</array></dict></plist>");
  execFileSync("zip", ["-qj", zip, f]);
  const runs = [0, 1, 2].map(() => apps(zip));
  assert.equal(new Set(runs).size, 1, "two ids sharing a label must not reorder");
});
