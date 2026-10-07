const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOWS = path.join(__dirname, "..", "workflows");

// Shortcuts supplies these inside a Repeat block; no action in the chain sets
// them and none has to.
const BUILTIN = new Set(["Repeat Item", "Repeat Index"]);

function varRefs(node, out = []) {
  if (Array.isArray(node)) { for (const v of node) varRefs(v, out); return out }
  if (node && typeof node === "object") {
    if (node.Type === "Variable" && typeof node.VariableName === "string") out.push(node.VariableName);
    for (const v of Object.values(node)) varRefs(v, out);
  }
  return out;
}

// A variable name is a string nothing validates, exactly like a Run Shortcut
// target. Library-Replace carried `{"Type":"Variable","VariableName":"Shortcut
// name"}` pointing at action 1's CustomOutputName, which renames a MAGIC
// variable and creates no named one. Shortcuts drew the token red and the
// filter matched nothing, so the delete would have found no shortcut. It had
// never been installed, so nothing caught it until the editor did.
test("every variable a receiver reads is one it sets", () => {
  const broken = [];
  for (const file of fs.readdirSync(WORKFLOWS).filter(f => f.endsWith(".json"))) {
    const chain = JSON.parse(fs.readFileSync(path.join(WORKFLOWS, file), "utf8"));
    // Fragments without a name are demos that may read an ambient variable the
    // embedding chain sets; trace.json reads $Trace on purpose.
    if (!chain.name) continue;
    const set = new Set(chain.actions
      .filter(a => /\.(setvariable|appendvariable)$/.test(a.id))
      .map(a => a.p && a.p.WFVariableName));
    for (const name of new Set(varRefs(chain.actions)))
      if (!BUILTIN.has(name) && !set.has(name)) broken.push(`${file}: ${name}`);
  }
  assert.deepStrictEqual(broken, [],
    "a Variable reference resolves to nothing, which renders red in the editor " +
    "and silently matches nothing at run time");
});
