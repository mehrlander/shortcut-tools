const test = require("node:test");
const assert = require("node:assert");
const { Shortcut, tokenString, variable, attachment, ANCHOR } = require("../index");

// The offsets are the whole point: counting them by hand is what goes wrong.
test("tokenString derives the anchor offset from the text before it", () => {
  const t = tokenString(["The text said: ", { uuid: "U-1" }]);
  assert.deepStrictEqual(Object.keys(t.Value.attachmentsByRange), ["{15, 1}"]);
  assert.strictEqual(t.Value.string, "The text said: " + ANCHOR);
  assert.strictEqual(t.Value.string.indexOf(ANCHOR), 15);
});

test("a token at the start anchors at 0", () => {
  const t = tokenString([{ uuid: "U-1" }]);
  assert.deepStrictEqual(Object.keys(t.Value.attachmentsByRange), ["{0, 1}"]);
});

test("several tokens each anchor after the anchors before them", () => {
  // "(￼)(￼)" is the invocation shape Get-FromJs uses: offsets 1 and 4.
  const t = tokenString(["(", { uuid: "U-1" }, ")(", { input: true }, ")"]);
  assert.deepStrictEqual(Object.keys(t.Value.attachmentsByRange), ["{1, 1}", "{4, 1}"]);
  assert.strictEqual(t.Value.string, "(" + ANCHOR + ")(" + ANCHOR + ")");
});

test("the anchor is one UTF-16 unit, so offsets are string lengths", () => {
  assert.strictEqual(ANCHOR.length, 1);
});

test("attachment covers action output, Shortcut Input, and both aggrandizements", () => {
  assert.deepStrictEqual(attachment({ input: true }), { Type: "ExtensionInput" });
  assert.strictEqual(attachment({ uuid: "U-1" }).Type, "ActionOutput");
  assert.deepStrictEqual(attachment({ uuid: "U-1", key: "report" }).Aggrandizements,
    [{ DictionaryKey: "report", Type: "WFDictionaryValueVariableAggrandizement" }]);
  assert.deepStrictEqual(attachment({ uuid: "U-1", as: "WFStringContentItem" }).Aggrandizements,
    [{ CoercionItemClass: "WFStringContentItem", Type: "WFCoercionVariableAggrandizement" }]);
  assert.throws(() => attachment({}), /needs a uuid/);
});

// The second attachment form: a value that IS an output, with no surrounding
// text, so no offset and no anchor.
test("variable() is the attachment form, with no attachmentsByRange", () => {
  const v = variable({ uuid: "U-1", name: "Dictionary" });
  assert.strictEqual(v.WFSerializationType, "WFTextTokenAttachment");
  assert.ok(!("attachmentsByRange" in v.Value));
  assert.strictEqual(v.Value.OutputUUID, "U-1");
});

test("lastUUID wires one action to the next", () => {
  const s = new Shortcut("t").add("text", { WFTextActionText: "hi" });
  const u = s.lastUUID();
  assert.match(u, /^[0-9A-F-]{36}$/);
  s.add("showresult", { Text: tokenString([{ uuid: u }]) });
  const ref = s.actions[1].WFWorkflowActionParameters.Text.Value.attachmentsByRange["{0, 1}"];
  assert.strictEqual(ref.OutputUUID, u);
});

test("toActionChain emits the { id, p } shape tools/pack.py consumes", () => {
  const chain = new Shortcut("Demo").add("comment", { WFCommentActionText: "x" }).toActionChain();
  assert.strictEqual(chain.label, "Demo");
  assert.deepStrictEqual(Object.keys(chain.actions[0]).sort(), ["id", "p"]);
  assert.strictEqual(chain.actions[0].id, "is.workflow.actions.comment");
  assert.strictEqual(chain.actions[0].p.WFCommentActionText, "x");
});

test("toActionChain carries control flow through intact", () => {
  const s = new Shortcut("m").menu("Pick", { A: (x) => x.comment("a"), B: (x) => x.comment("b") });
  const modes = s.toActionChain().actions
    .filter((a) => a.id === "is.workflow.actions.choosefrommenu")
    .map((a) => a.p.WFControlFlowMode);
  assert.strictEqual(modes.filter((m) => m === 0).length, 1);
  assert.strictEqual(modes.filter((m) => m === 2).length, 1);
});

// Both defaults were measured against real exports; see docs/shortcuts-format-notes.md.
test("build() carries the observed envelope values, not the 2019 ones", () => {
  const w = new Shortcut("t").build();
  assert.strictEqual(w.WFWorkflowClientVersion, "4711");
  assert.ok(!w.WFWorkflowTypes.includes("WatchKit"));
  assert.strictEqual(w.WFWorkflowMinimumClientVersion, 900);
});
