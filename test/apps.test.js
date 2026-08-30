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
  assert.equal(charty.installed, false, "absent from a complete pass means absent");
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
