const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const pack = (...args) =>
  execFileSync("python3", [path.join("tools", "pack.py"), ...args],
               { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// The point of $file is that a chain carrying an HTML payload references the
// real page instead of a pasted copy of it. If the inlining silently stopped
// working, the chain would still pack, and the payload would be the literal
// JSON object. So assert the page's own text comes out the far end.
test("a $file parameter inlines the file's text, not the directive", () => {
  const link = pack(path.join("workflows", "sync-xhr-probe.json")).trim();
  const decoded = pack(link, "--verify");
  assert.match(decoded, /is\.workflow\.actions\.gettext/);

  const body = JSON.parse(decodeURIComponent(link.split("&text=")[1]));
  const xml = Buffer.from(body.actions[0], "base64").toString();
  const page = fs.readFileSync(path.join(ROOT, "pages", "xhr-probe.html"), "utf8");
  assert.ok(xml.includes("api.github.com/zen"), "the page's text should be in the plist");
  assert.ok(!xml.includes("$file"), "the directive should not survive packing");
  assert.ok(page.includes("api.github.com/zen"), "and it should be the page on disk");
});

test("a missing $file fails loudly instead of packing an empty payload", () => {
  const chain = path.join(ROOT, "workflows", ".tmp-missing.json");
  fs.writeFileSync(chain, JSON.stringify({
    label: "x", actions: [{ id: "is.workflow.actions.gettext",
                            p: { WFTextActionText: { $file: "pages/nope.html" } } }]
  }));
  try {
    assert.throws(() => pack(path.join("workflows", ".tmp-missing.json")), /Command failed/);
  } finally {
    fs.unlinkSync(chain);
  }
});

test("every committed chain packs and round-trips", () => {
  for (const f of fs.readdirSync(path.join(ROOT, "workflows")).filter(f => f.endsWith(".json"))) {
    const link = pack(path.join("workflows", f)).trim();
    assert.match(link, /^shortcuts:\/\/run-shortcut\?name=/, f);
    const report = pack(link, "--verify");
    const declared = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", f), "utf8"));
    for (const action of declared.actions) assert.ok(report.includes(action.id), f + ": " + action.id);
  }
});
