const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

function archive(shortcuts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harvest-"));
  const files = [];
  for (const [name, actions] of Object.entries(shortcuts)) {
    const body = actions.map(a =>
      `<dict><key>WFWorkflowActionIdentifier</key><string>${a.id}</string>` +
      `<key>WFWorkflowActionParameters</key><dict>${a.p || ""}</dict></dict>`).join("");
    const f = path.join(dir, name + ".wflow");
    fs.writeFileSync(f, `<?xml version="1.0" encoding="UTF-8"?>` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ` +
      `"http://www.apple.com/DTDs/PropertyList-1.0.dtd">` +
      `<plist version="1.0"><dict><key>WFWorkflowActions</key><array>${body}</array></dict></plist>`);
    files.push(name + ".wflow");
  }
  const zip = path.join(dir, "dump.zip");
  execFileSync("zip", ["-q", "-X", zip, ...files], { cwd: dir });
  return zip;
}

function harvest(zip, ...args) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "core-"));
  const proc = require("node:child_process").spawnSync("python3",
    [path.join("tools", "harvest.py"), zip, "-o", out, ...args],
    { cwd: ROOT, encoding: "utf8" });
  return { out, stderr: proc.stderr, status: proc.status,
           read: n => JSON.parse(fs.readFileSync(path.join(out, n + ".json"), "utf8")) };
}

const run = (name, extra = "") =>
  ({ id: "is.workflow.actions.runworkflow",
     p: `<key>WFWorkflowName</key><string>${name}</string>` +
        `<key>WFWorkflow</key><dict><key>workflowIdentifier</key>` +
        `<string>DEVICE-LOCAL</string></dict>${extra}` });
const flow = (mode, gid) =>
  ({ id: "is.workflow.actions.conditional",
     p: `<key>GroupingIdentifier</key><string>${gid}</string>` +
        `<key>WFControlFlowMode</key><integer>${mode}</integer>` });
const plain = { id: "is.workflow.actions.list", p: "" };

// A workflowIdentifier is minted per install, so a harvested chain that keeps
// one is wrong on every other device. The name alone resolves.
test("the device-local pin is dropped from every call, renamed or not", () => {
  const h = harvest(archive({ A: [run("Untouched")] }), "--name", "A");
  const [action] = h.read("A").actions;
  assert.strictEqual(action.p.WFWorkflowName, "Untouched");
  assert.ok(!("WFWorkflow" in action.p), "the pin should be gone");
});

test("--rename repoints a target and reports it", () => {
  const h = harvest(archive({ A: [run("Old-Name")] }), "--name", "A", "--rename", "Old-Name=New-Name");
  assert.strictEqual(h.read("A").actions[0].p.WFWorkflowName, "New-Name");
  assert.match(h.stderr, /A: Old-Name -> New-Name/);
});

test("a rename that matched nothing fails, since it is a typo not a no-op", () => {
  const h = harvest(archive({ A: [run("Real")] }), "--name", "A", "--rename", "Ghost=Other");
  assert.notStrictEqual(h.status, 0);
  assert.match(h.stderr, /matched no call/);
});

// Show-Versions dispatches on type and two handlers do not exist, so those
// inputs enter a branch that calls nothing. Deleting the branch is the fix.
test("--drop-call removes the call and the branch it emptied", () => {
  const h = harvest(archive({ A: [plain, flow(0, "g"), run("Gone"), flow(2, "g"), plain] }),
                    "--name", "A", "--drop-call", "Gone");
  const ids = h.read("A").actions.map(a => a.id.replace("is.workflow.actions.", ""));
  assert.deepStrictEqual(ids, ["list", "list"], "the whole empty block goes");
  assert.match(h.stderr, /A: dropped the call to Gone/);
});

test("a branch with a surviving sibling keeps its block", () => {
  const h = harvest(archive({ A: [flow(0, "g"), run("Gone"), plain, flow(2, "g")] }),
                    "--name", "A", "--drop-call", "Gone");
  const ids = h.read("A").actions.map(a => a.id.replace("is.workflow.actions.", ""));
  assert.deepStrictEqual(ids, ["conditional", "list", "conditional"],
    "removing a block that still holds work would be a judgment, not a cleanup");
});

test("a block with an else is left alone entirely", () => {
  const h = harvest(archive({ A: [flow(0, "g"), run("Gone"), flow(1, "g"), plain, flow(2, "g")] }),
                    "--name", "A", "--drop-call", "Gone");
  const ids = h.read("A").actions.map(a => a.id.replace("is.workflow.actions.", ""));
  assert.deepStrictEqual(ids, ["conditional", "conditional", "list", "conditional"],
    "an else means the branch still means something");
});

test("a computed target does not crash the rewrite", () => {
  // WFWorkflowName may be a token dict rather than a string, and 149 calls in
  // the real library are exactly that.
  const computed = { id: "is.workflow.actions.runworkflow",
    p: `<key>WFWorkflowName</key><dict><key>Value</key><dict>` +
       `<key>Type</key><string>Variable</string>` +
       `<key>VariableName</key><string>Target</string></dict></dict>` };
  const h = harvest(archive({ A: [computed] }), "--name", "A", "--drop-call", "Gone");
  assert.notStrictEqual(h.status, 0, "the drop matched nothing, which is still an error");
  assert.match(h.stderr, /matched no call/);
});

test("--drop-call that matched nothing fails the same way a rename does", () => {
  const h = harvest(archive({ A: [run("Real")] }), "--name", "A", "--drop-call", "Ghost");
  assert.notStrictEqual(h.status, 0);
});
