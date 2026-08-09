const test = require("node:test");
const assert = require("node:assert");
const { Shortcut } = require("../shortcut");

function groupsOf(shortcut) {
  const groups = new Map();
  for (const action of shortcut.build().WFWorkflowActions) {
    const params = action.WFWorkflowActionParameters;
    if (!params || params.GroupingIdentifier === undefined) continue;
    const key = params.GroupingIdentifier;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(params.WFControlFlowMode);
  }
  return groups;
}

test("add() refuses control-flow actions instead of emitting a dangling opener", () => {
  for (const name of ["if", "endif", "otherwise", "repeat", "endrepeat",
                      "repeatwitheach", "choosefrommenu", "endmenu",
                      "ifclipboardcontains"]) {
    const s = new Shortcut();
    assert.throws(() => s.add(name), /control-flow/, `add("${name}") did not throw`);
    assert.equal(s.actions.length, 0, `add("${name}") left an action behind`);
  }
});

test("add() still accepts ordinary actions", () => {
  const s = new Shortcut();
  s.add("text");
  assert.equal(s.actions.length, 1);
  assert.equal(s.actions[0].WFWorkflowActionIdentifier, "is.workflow.actions.gettext");
  assert.ok(s.actions[0].WFWorkflowActionParameters.UUID);
});

test("every emitted action carries a UUID", () => {
  const s = new Shortcut();
  s.ifElse({}, (x) => x.add("text"), (x) => x.add("text"));
  for (const action of s.build().WFWorkflowActions) {
    assert.ok(action.WFWorkflowActionParameters.UUID, "action without UUID");
  }
});

test("if/otherwise/end share one grouping and run modes 0,1,2", () => {
  const s = new Shortcut();
  s.ifElse({}, (x) => x.add("text"), (x) => x.add("text"));
  const groups = [...groupsOf(s).values()];
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], [0, 1, 2]);
});

test("a menu emits one mode-1 marker per case", () => {
  const s = new Shortcut();
  s.menu("Pick", { A: (x) => x.add("text"), B: (x) => x.add("text"),
                   C: (x) => x.add("text") });
  const groups = [...groupsOf(s).values()];
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], [0, 1, 1, 1, 2]);
});

test("repeat opens and closes with one grouping", () => {
  const s = new Shortcut();
  s.repeat(3, (x) => x.add("text"));
  const groups = [...groupsOf(s).values()];
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], [0, 2]);
});

test("nested blocks get distinct groupings and stay balanced", () => {
  const s = new Shortcut();
  s.ifBegin({});
  s.repeat(2, (x) => x.add("text"));
  s.ifEnd();
  const groups = [...groupsOf(s).values()];
  assert.equal(groups.length, 2);
  for (const modes of groups) {
    assert.equal(modes[0], 0);
    assert.equal(modes[modes.length - 1], 2);
  }
});

test("ifBegin accepts a dictionary preset and merges its condition", () => {
  const s = new Shortcut();
  s.ifBegin({}, "ifclipboardcontains");
  s.ifEnd();
  const opener = s.build().WFWorkflowActions[0].WFWorkflowActionParameters;
  assert.equal(opener.WFCondition, 99);
  assert.equal(opener.WFInput.Variable.Value.Type, "Clipboard");
  assert.equal(opener.WFControlFlowMode, 0);
  assert.ok(opener.GroupingIdentifier);
});

test("ifBegin rejects a preset that is not a conditional", () => {
  const s = new Shortcut();
  assert.throws(() => s.ifBegin({}, "repeat"), /not a conditional preset/);
});

test("explicit params win over the preset", () => {
  const s = new Shortcut();
  s.ifBegin({ WFCondition: 4 }, "ifclipboardcontains");
  assert.equal(s.build().WFWorkflowActions[0].WFWorkflowActionParameters.WFCondition, 4);
});

test("the XML plist escapes markup and declares the plist doctype", () => {
  const s = new Shortcut("a & b <c>");
  const xml = s.toXMLPlist();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<!DOCTYPE plist PUBLIC/);
  assert.match(xml, /<string>a &amp; b &lt;c&gt;<\/string>/);
  assert.doesNotMatch(xml, /<string>a & b <c><\/string>/);
});
