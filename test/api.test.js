const test = require("node:test");
const assert = require("node:assert");
const api = require("../index");
const { Shortcut } = require("../shortcut");

test("the documented exports are all present", () => {
  for (const name of ["getAction", "searchActions", "getActionsByApp", "listApps",
                      "listActions", "allActions", "Shortcut"]) {
    assert.ok(name in api, `missing export ${name}`);
  }
});

test("every lookup returns an array of variants", () => {
  assert.ok(Array.isArray(api.getAction("takescreenshot")));
  assert.equal(api.getAction("choosefrommenu").length, 3);
  for (const { variants } of api.searchActions("clipboard")) {
    assert.ok(Array.isArray(variants));
  }
});

test("getAction is exact and does not fall back", () => {
  assert.equal(api.getAction("gettext"), undefined);
  assert.ok(api.getAction("TAKESCREENSHOT"), "should lowercase its argument");
});

test("listActions covers the whole dictionary", () => {
  assert.equal(api.listActions().length, 810);
});

// add() falls back to prefix then substring, shortest first. Documented in the
// README because the result can surprise: "gettext" is not a key, so a longer
// name wins the match.
test("add() falls back to the shortest prefix match", () => {
  const s = new Shortcut();
  s.add("gettext");
  assert.equal(s.actions[0].WFWorkflowActionIdentifier,
    "is.workflow.actions.gettextfrompdf");
});

// The README's opening example. Kept as a test so it cannot rot.
test("the README example resolves", () => {
  const s = new Shortcut("Shout")
    .add("getclipboard")
    .add("changecase", { WFCaseType: "UPPERCASE" })
    .add("copytoclipboard");
  assert.deepEqual(s.actions.map((a) => a.WFWorkflowActionIdentifier), [
    "is.workflow.actions.getclipboard",
    "is.workflow.actions.text.changecase",
    "is.workflow.actions.setclipboard",
  ]);
});
