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

test("getActionsByApp returns names that getAction resolves", () => {
  const api = require("../index");
  const unresolvable = [];
  for (const { appId } of api.listApps()) {
    for (const name of api.getActionsByApp(appId)) {
      // Entries with no unambiguous name fall back to the identifier.
      if (name.includes(".")) continue;
      if (!api.getAction(name)) unresolvable.push(name);
    }
  }
  assert.deepEqual(unresolvable, []);
});

test("getActionsByApp accepts a full bundle id and a bare source", () => {
  const api = require("../index");
  assert.deepEqual(api.getActionsByApp("com.apple.mobilenotes"),
    api.getActionsByApp("mobilenotes"));
  assert.equal(api.getActionsByApp("no.such.app"), null);
});

test("listApps reports full bundle ids", () => {
  const api = require("../index");
  const ids = api.listApps().map((a) => a.appId);
  assert.ok(ids.includes("is.workflow.actions"));
  assert.ok(ids.includes("com.apple.mobilenotes"));
  assert.ok(!ids.includes(""), "the empty source should resolve to its root");
});

// 14 generic conditional operators and one genuinely ambiguous leaf have no
// single dictionary name. Reporting null beats picking one arbitrarily.
test("ambiguous leaves resolve to null, not to a guess", () => {
  const api = require("../index");
  const detailed = api.getActionsByApp("is.workflow.actions", { detailed: true });
  const byLeaf = new Map(detailed.map((a) => [a.leaf, a]));
  assert.equal(byLeaf.get("conditional:contains").name, null);
  assert.equal(byLeaf.get("conditional:if").name, "if");
  assert.equal(byLeaf.get("conditional:else").name, "otherwise");
  assert.equal(byLeaf.get("conditional:end").name, "endif");
});
