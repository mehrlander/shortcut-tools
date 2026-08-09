const test = require("node:test");
const assert = require("node:assert");
const actionsData = require("../actions.json");

const entries = Object.entries(actionsData.actions);

function parse(raw) {
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("every value parses as newline-delimited JSON", () => {
  for (const [name, raw] of entries) {
    assert.doesNotThrow(() => parse(raw), `${name} did not parse`);
  }
});

test("every variant carries a well-formed action identifier", () => {
  for (const [name, raw] of entries) {
    for (const variant of parse(raw)) {
      const id = variant.WFWorkflowActionIdentifier;
      assert.equal(typeof id, "string", `${name} has no identifier`);
      assert.match(id, /^[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+$/, `${name} identifier "${id}"`);
    }
  }
});

test("no variant carries a key outside the two known top-level ones", () => {
  const allowed = new Set(["WFWorkflowActionIdentifier", "WFWorkflowActionParameters"]);
  for (const [name, raw] of entries) {
    for (const variant of parse(raw)) {
      for (const key of Object.keys(variant)) {
        assert.ok(allowed.has(key), `${name} carries unexpected key "${key}"`);
      }
    }
  }
});

// The multi-variant entry is asserted rather than left to be rediscovered.
// A consumer calling JSON.parse on a raw value breaks on exactly this one.
test("choosefrommenu is the only multi-variant entry", () => {
  const multi = entries.filter(([, raw]) => raw.includes("\n")).map(([name]) => name);
  assert.deepEqual(multi, ["choosefrommenu"]);
  assert.throws(() => JSON.parse(actionsData.actions.choosefrommenu));
});

// No entry supplies a GroupingIdentifier, which is why add() must refuse
// control-flow actions rather than emit an unpaired opener.
test("no entry carries a GroupingIdentifier", () => {
  const withGrouping = entries.filter(([, raw]) => raw.includes("GroupingIdentifier"));
  assert.deepEqual(withGrouping.map(([name]) => name), []);
});

test("every entry carrying a control-flow mode uses a known mode", () => {
  for (const [name, raw] of entries) {
    for (const variant of parse(raw)) {
      const params = variant.WFWorkflowActionParameters;
      if (!params || !("WFControlFlowMode" in params)) continue;
      assert.ok([0, 1, 2].includes(params.WFControlFlowMode),
        `${name} has mode ${params.WFControlFlowMode}`);
    }
  }
});
