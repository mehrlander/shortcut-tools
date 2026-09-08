const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

// Write a real XML plist, since that is what a dump holds and what the reader
// has to survive. plistlib on the other side is the check that it is well formed.
function wflow(actions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sketch-"));
  const f = path.join(dir, "Thing.wflow");
  fs.writeFileSync(f, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>WFWorkflowActions</key><array>${actions}</array></dict></plist>`);
  return f;
}
const sketch = (file, ...args) =>
  execFileSync("python3", [path.join("tools", "sketch.py"), file, ...args],
               { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const act = (id, params = "") =>
  `<dict><key>WFWorkflowActionIdentifier</key><string>${id}</string>` +
  `<key>WFWorkflowActionParameters</key><dict>${params}</dict></dict>`;
const flow = (id, mode, extra = "") =>
  act(id, `<key>GroupingIdentifier</key><string>g</string>` +
          `<key>WFControlFlowMode</key><integer>${mode}</integer>${extra}`);

test("control flow indents the body and closes at the same depth", () => {
  const out = sketch(wflow(
    flow("is.workflow.actions.conditional", 0) +
    act("is.workflow.actions.list") +
    flow("is.workflow.actions.conditional", 1) +
    act("is.workflow.actions.list") +
    flow("is.workflow.actions.conditional", 2)));
  const lines = out.trim().split("\n").slice(1);   // drop the title line
  const indent = l => l.match(/^\s*\d+ (\s*)/)[1].length;
  assert.match(lines[0], /if$/);
  assert.strictEqual(indent(lines[1]), 2, "the body is indented");
  assert.match(lines[2], /else$/);
  assert.strictEqual(indent(lines[2]), 0, "else returns to the opener's depth");
  assert.strictEqual(indent(lines[4]), 0, "and so does end if");
  assert.match(lines[4], /end if$/);
});

// The point of the whole exercise: a text token is a string full of U+FFFC with
// the producing UUID stored elsewhere. Unresolved it is unreadable.
test("an attachment prints as the line that produced it, not as a glyph", () => {
  const out = sketch(wflow(
    act("is.workflow.actions.gettext",
        `<key>UUID</key><string>AAA</string><key>WFTextActionText</key><string>hi</string>`) +
    act("is.workflow.actions.openurl",
        `<key>WFInput</key><dict><key>Value</key><dict>` +
        `<key>string</key><string>￼</string>` +
        `<key>attachmentsByRange</key><dict><key>{0, 1}</key><dict>` +
        `<key>Type</key><string>ActionOutput</string>` +
        `<key>OutputUUID</key><string>AAA</string></dict></dict></dict></dict>`)));
  assert.match(out, /open «0»/, "the reference should name line 0");
  assert.ok(!out.includes("￼"), "no object-replacement character should survive");
  assert.ok(!out.includes("AAA"), "and no raw UUID either");
});

// The range keys are "{offset, length}" strings, so sorting them as text puts
// "{10, 1}" before "{5, 1}". Placeholders are filled left to right, so one
// mis-ordered key shifts every attachment after it and the line names the
// wrong variables while looking perfectly well formed. Found 2026-08-26 by a
// three-attachment record line that rendered its own fields out of order.
test("attachments fill by numeric offset, not by the text of the range key", () => {
  const src = (uuid) =>
    act("is.workflow.actions.gettext",
        `<key>UUID</key><string>${uuid}</string>` +
        `<key>WFTextActionText</key><string>${uuid}</string>`);
  const at = (off, uuid) =>
    `<key>{${off}, 1}</key><dict><key>Type</key><string>ActionOutput</string>` +
    `<key>OutputUUID</key><string>${uuid}</string></dict>`;
  const out = sketch(wflow(
    src("AAA") + src("BBB") + src("CCC") +
    act("is.workflow.actions.gettext",
        `<key>WFTextActionText</key><dict><key>Value</key><dict>` +
        // "Ran: ￼\nQ: ￼\nA: ￼" puts the anchors at 5, 10 and 15
        `<key>string</key><string>Ran: ￼&#10;Q: ￼&#10;A: ￼</string>` +
        `<key>attachmentsByRange</key><dict>` +
        at(5, "AAA") + at(10, "BBB") + at(15, "CCC") +
        `</dict></dict></dict>`)));
  assert.match(out, /Ran: «0» Q: «1» A: «2»/,
    "offset 5 is the first slot even though \"{10, 1}\" sorts before \"{5, 1}\"");
});

test("aggrandizements read as the access they perform", () => {
  const out = sketch(wflow(act("is.workflow.actions.openurl",
    `<key>WFInput</key><dict><key>Value</key><dict>` +
    `<key>Type</key><string>ExtensionInput</string>` +
    `<key>Aggrandizements</key><array>` +
    `<dict><key>Type</key><string>WFCoercionVariableAggrandizement</string>` +
    `<key>CoercionItemClass</key><string>WFDictionaryContentItem</string></dict>` +
    `<dict><key>Type</key><string>WFDictionaryValueVariableAggrandizement</string>` +
    `<key>DictionaryKey</key><string>tok</string></dict>` +
    `</array></dict></dict>`)));
  assert.match(out, /open \$input as Dictionary\[tok\]/);
});

// Three keys carry a condition's operand and reading only the string one drops
// every numeric and measured comparison silently.
test("a condition prints its operand whichever key holds it", () => {
  const cond = (extra) => sketch(wflow(flow("is.workflow.actions.conditional", 0,
    `<key>WFCondition</key><integer>4</integer>${extra}`) +
    flow("is.workflow.actions.conditional", 2)));
  assert.match(cond(`<key>WFConditionalActionString</key><string>yes</string>`), /if is yes/);
  assert.match(cond(`<key>WFNumberValue</key><integer>7</integer>`), /if is 7/);
  assert.match(cond(`<key>WFMeasurement</key><dict><key>Value</key><dict>` +
    `<key>Magnitude</key><string>1</string><key>Unit</key><string>MB</string>` +
    `</dict></dict>`), /if is 1 MB/);
});

// An earlier table guessed 2 and 3 from their neighbours and had them inverted,
// which made Combine-JsonList's correct "if count > 1 then join" read as
// "count < 1" and got reported as a bug. A renderer is a claim about semantics.
test("the ordering codes read the way the corpus and the dictionary agree they do", () => {
  const cond = (code, value) => sketch(wflow(
    flow("is.workflow.actions.conditional", 0,
         `<key>WFCondition</key><integer>${code}</integer>` +
         `<key>WFNumberValue</key><integer>${value}</integer>`) +
    flow("is.workflow.actions.conditional", 2)));
  assert.match(cond(2, 1), /if > 1/, "2 is greater than: count > 1 then combine");
  assert.match(cond(0, 1), /if < 1/, "0 is less than, the dictionary's 'is before'");
  assert.match(cond(3, 1), /if >= 1/);
  assert.match(cond(1, 0), /if <= 0/);
  assert.match(cond(4, 1), /if is 1/, "4 is equality, never an ordering");
});

// 100 and 101 are pinned by the self-demo prologue, which fires on NO input.
test("the value tests are named, not left as a shrug", () => {
  const out = sketch(wflow(
    flow("is.workflow.actions.conditional", 0, `<key>WFCondition</key><integer>101</integer>`) +
    flow("is.workflow.actions.conditional", 2)));
  assert.match(out, /no value/);
  assert.ok(!/value\?/.test(out), "the earlier placeholder should be gone");
});

test("an unmapped action still prints its identifier rather than vanishing", () => {
  const out = sketch(wflow(act("is.workflow.actions.somethingnew")));
  assert.match(out, /somethingnew/, "a reader must be able to see what was not named");
});

test("a menu opens, names each case, and closes", () => {
  const out = sketch(wflow(
    flow("is.workflow.actions.choosefrommenu", 0, `<key>WFMenuPrompt</key><string>Pick</string>`) +
    flow("is.workflow.actions.choosefrommenu", 1, `<key>WFMenuItemTitle</key><string>One</string>`) +
    act("is.workflow.actions.list") +
    flow("is.workflow.actions.choosefrommenu", 2)));
  assert.match(out, /menu Pick/);
  assert.match(out, /case One/);
  assert.match(out, /end menu/);
});

test("the title carries the name and the action count", () => {
  const out = sketch(wflow(act("is.workflow.actions.list") + act("is.workflow.actions.list")));
  assert.match(out.split("\n")[0], /^Thing {2}\(2 actions\)$/);
});

test("long text is reported by length, since the sketch is a shape not a copy", () => {
  const long = "x".repeat(300);
  const out = sketch(wflow(act("is.workflow.actions.gettext",
    `<key>WFTextActionText</key><string>${long}</string>`)));
  assert.match(out, /\(300 chars\)/);
  assert.ok(out.length < 200, "the sketch should not carry the payload");
});

test("a duplicated name sketches from the last dump passed", () => {
  // The same precedence index-dump.py uses, and it has to be the same one:
  // fixing only the index would leave the two derivatives disagreeing in
  // silence, index.json saying 9 actions while the sketch still showed 23.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-"));
  const mk = (file, n) => {
    const out = path.join(dir, file);
    execFileSync("python3", ["-c", `
import plistlib, zipfile, sys
d = plistlib.load(open(sys.argv[1], 'rb'))
d['WFWorkflowActions'] = d['WFWorkflowActions'][:int(sys.argv[3])]
with zipfile.ZipFile(sys.argv[2], 'w') as z:
    z.writestr('Probe.wflow', plistlib.dumps(d, fmt=plistlib.FMT_XML))
`, path.join(ROOT, "plists", "Sync-Manifest.plist"), out, String(n)]);
    return out;
  };
  const older = mk("2026-08-13-01.zip", 11);
  const newer = mk("2026-08-18-recent.zip", 3);
  const out = execFileSync("python3",
    [path.join(ROOT, "tools", "sketch.py"), older, newer, "--name", "Probe"],
    { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /Probe\s+\(3 actions\)/, "the newer dump wins");
  fs.rmSync(dir, { recursive: true, force: true });
});
