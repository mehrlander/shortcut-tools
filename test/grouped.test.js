const test = require("node:test");
const assert = require("node:assert");
const grouped = require("../actions-grouped.json");
const actionsData = require("../actions.json");

function parse(raw) {
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const identifiers = new Set();
for (const raw of Object.values(actionsData.actions)) {
  for (const variant of parse(raw)) identifiers.add(variant.WFWorkflowActionIdentifier);
}

// actions-grouped.json decomposes each identifier into bundle root, source, and
// leaf. Reconstructing them is what proves the two files describe one dataset.
function reconstruct(root, source, leaf) {
  if (root === "other") return `${source}.${leaf}`;
  if (source === "") return `${root}.${leaf}`;
  return `${root}.${source}.${leaf}`;
}

function* groupedIdentifiers() {
  for (const [root, sources] of Object.entries(grouped)) {
    for (const [source, leaves] of Object.entries(sources)) {
      for (const leaf of leaves) yield reconstruct(root, source, leaf);
    }
  }
}

test("every grouped entry reconstructs to a dictionary identifier", () => {
  const missing = [];
  for (const id of groupedIdentifiers()) {
    // Control-flow entries carry a `:mode` suffix the flat dictionary lacks.
    if (!identifiers.has(id) && !identifiers.has(id.split(":")[0])) missing.push(id);
  }
  assert.deepEqual(missing, []);
});

test("every dictionary identifier appears in the grouped file", () => {
  const present = new Set();
  for (const id of groupedIdentifiers()) {
    present.add(id);
    present.add(id.split(":")[0]);
  }
  const missing = [...identifiers].filter((id) => !present.has(id));
  assert.deepEqual(missing, []);
});

// The grouped file distinguishes control-flow modes that the flat dictionary
// collapses onto one identifier, which is why its entry count is the larger.
test("the grouped file carries the suffixed control-flow forms", () => {
  const suffixed = [...groupedIdentifiers()].filter((id) => id.includes(":"));
  assert.ok(suffixed.length >= 20, `only ${suffixed.length} suffixed forms`);
  assert.ok(suffixed.includes("is.workflow.actions.conditional:if"));
  assert.ok(suffixed.includes("is.workflow.actions.choosefrommenu:end"));
});
