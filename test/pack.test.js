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

// A link that carries its payload has to be transcribed whole, and the party
// transcribing it may be a model rather than a person. packed/ exists so a link
// can carry an address instead, which is short enough to get right and 404s
// when it is not.
test("packed/ holds a payload for every chain, and is current", () => {
  pack("--check");   // throws with the command to run when it is behind
  const chains = fs.readdirSync(path.join(ROOT, "workflows")).filter(f => f.endsWith(".json"));
  const packed = fs.readdirSync(path.join(ROOT, "packed")).filter(f => f.endsWith(".json"));
  assert.deepStrictEqual(packed.sort(), chains.sort(), "one payload per chain, no orphans");
});

// The address form was documented and not emitted, so it was typed by hand
// every time, which is exactly the failure packed/ was built to end.
test("--url emits the address link rather than leaving it to be typed", () => {
  const link = pack("workflows/show-html-js.json", "--url").trim();
  assert.match(link, /^shortcuts:\/\/run-shortcut\?name=Copy-ActionFromUrl&input=text&text=/);
  const url = decodeURIComponent(link.split("&text=")[1]);
  assert.strictEqual(url,
    "https://raw.githubusercontent.com/mehrlander/shortcut-tools/main/packed/show-html-js.json");
  assert.ok(link.length < 200, `an address link should stay short, got ${link.length}`);
});

test("--ref addresses a branch, since a chain is testable before it merges", () => {
  const url = decodeURIComponent(
    pack("workflows/show-html-js.json", "--url", "--ref", "claude/x").trim().split("&text=")[1]);
  assert.match(url, /shortcut-tools\/claude\/x\/packed\/show-html-js\.json$/);
});

test("--url refuses a chain that is not published, rather than minting a 404", () => {
  assert.throws(() => pack("workflows/nonesuch.json", "--url"), /Command failed/);
});

test("a published payload is what the receiver expects, not a link", () => {
  const body = JSON.parse(fs.readFileSync(path.join(ROOT, "packed", "dump-shortcuts.json"), "utf8"));
  assert.ok(Array.isArray(body.actions) && body.actions.length === 3);
  assert.match(body.report, /^Dump-Shortcuts:/, "the label the banner shows, in plain text");
  const doc = require("node:child_process").execFileSync("python3",
    ["-c", "import base64,plistlib,sys;print(plistlib.loads(base64.b64decode(sys.argv[1]))['WFWorkflowActionIdentifier'])",
     body.actions[0]], { encoding: "utf8" }).trim();
  assert.strictEqual(doc, "is.workflow.actions.getmyworkflows");
});

test("Copy-ActionFromUrl coerces the download to text before handing it on", () => {
  const chain = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "copy-action-from-url.json"), "utf8"));
  const [get, run] = chain.actions;
  assert.strictEqual(get.id, "is.workflow.actions.downloadurl");
  assert.strictEqual(run.p.WFWorkflowName, "Copy-ActionFromClaude");
  // Get Contents of URL parses a JSON response into a dictionary, and the
  // receiver wants the text. The coercion is what undoes that.
  assert.deepStrictEqual(run.p.WFInput.Value.Aggrandizements,
    [{ CoercionItemClass: "WFStringContentItem", Type: "WFCoercionVariableAggrandizement" }]);
});
