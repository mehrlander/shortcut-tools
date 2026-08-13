const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const run = (...args) =>
  execFileSync("python3", [path.join("tools", "restore.py"), ...args],
               { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// A dump is a zip of unsigned XML plists named by the shortcut. Build one here
// rather than reaching for the real archive, which is private and lives in
// another repository.
function archive(shortcuts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dump-"));
  const files = [];
  for (const [name, actions] of Object.entries(shortcuts)) {
    const body = actions.map(a =>
      `<dict><key>WFWorkflowActionIdentifier</key><string>${a.id}</string>` +
      `<key>WFWorkflowActionParameters</key><dict>` +
      Object.entries(a.p || {}).map(([k, v]) =>
        `<key>${k}</key><string>${v}</string>`).join("") +
      `</dict></dict>`).join("");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ` +
      `"http://www.apple.com/DTDs/PropertyList-1.0.dtd">` +
      `<plist version="1.0"><dict><key>WFWorkflowActions</key><array>${body}</array></dict></plist>`;
    const f = path.join(dir, name + ".wflow");
    fs.writeFileSync(f, plist);
    files.push(name + ".wflow");
  }
  const zip = path.join(dir, "dump.zip");
  execFileSync("zip", ["-q", "-X", zip, ...files], { cwd: dir });
  return zip;
}

const FIXTURE = {
  "Show-Thing": [
    { id: "is.workflow.actions.gettext", p: { WFTextActionText: "hello" } },
    { id: "is.workflow.actions.openurl", p: {} }
  ],
  "Inject-🎟️Token": [{ id: "is.workflow.actions.comment", p: { WFCommentActionText: "x" } }]
};

test("--list names everything in the archive, emoji included", () => {
  const out = run(archive(FIXTURE), "--list").trim().split("\n");
  assert.deepStrictEqual(out.sort(), ["Inject-🎟️Token", "Show-Thing"]);
});

// The whole claim behind deleting a shortcut off the device is that this comes
// back unchanged. Assert the parameters survive, not merely the identifiers.
test("a restored link decodes back to the archived actions, parameters included", () => {
  const link = run(archive(FIXTURE), "Show-Thing").trim();
  const body = JSON.parse(decodeURIComponent(link.split("&text=")[1]));
  assert.strictEqual(body.actions.length, 2);

  const decoded = execFileSync("python3", ["-c",
    "import base64,json,plistlib,sys;print(json.dumps([plistlib.loads(base64.b64decode(b)) for b in json.load(sys.stdin)]))"
  ], { input: JSON.stringify(body.actions), encoding: "utf8" });
  const [first, second] = JSON.parse(decoded);
  assert.strictEqual(first.WFWorkflowActionIdentifier, "is.workflow.actions.gettext");
  assert.strictEqual(first.WFWorkflowActionParameters.WFTextActionText, "hello",
    "a parameter that did not survive is a shortcut that did not come back");
  assert.strictEqual(second.WFWorkflowActionIdentifier, "is.workflow.actions.openurl");
});

// The plist has no field naming the shortcut, so the name lives only in the zip
// entry. If restore stopped printing it the caller graph would break silently,
// since a Run Shortcut action resolves its target by name.
test("the name is printed, because the plist does not carry it", () => {
  const err = execFileSync("python3", [path.join("tools", "restore.py"),
    archive(FIXTURE), "Show-Thing"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // stdout is the link; the name rides stderr so a pipe to a file stays clean.
  const proc = require("node:child_process").spawnSync("python3",
    [path.join("tools", "restore.py"), archive(FIXTURE), "Show-Thing"],
    { cwd: ROOT, encoding: "utf8" });
  assert.match(proc.stderr, /Name the new shortcut: Show-Thing/);
  assert.match(proc.stdout, /^shortcuts:\/\/run-shortcut/);
  assert.ok(!proc.stdout.includes("Name the new shortcut"), "and not into the link");
  assert.ok(err.length > 0);
});

test("a name the archive does not hold fails loudly", () => {
  assert.throws(() => run(archive(FIXTURE), "Nope-Missing"), /Command failed/);
});

test("a near miss suggests what is there, since the name has to be exact", () => {
  const proc = require("node:child_process").spawnSync("python3",
    [path.join("tools", "restore.py"), archive(FIXTURE), "Thing"], { cwd: ROOT, encoding: "utf8" });
  assert.notStrictEqual(proc.status, 0);
  assert.match(proc.stderr, /did you mean: Show-Thing/);
});
