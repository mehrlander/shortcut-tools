const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Parameter shapes, held to the census rather than to inference.
//
// On 2026-09-03 a chain handed Inject-🎟️GitHubToken an empty input and the
// injector ran its demo instead, opening a GitHub API dump in Safari. The
// cause was a Replace Text action whose input and replacement were serialised
// as variable attachments, a shape that appears in none of the 754 uses of
// that action across fifteen library dumps. The chain had copied it from the
// one chain the README flagged as carrying inferred shapes.
//
// So the census is a gate now: for the parameters where the corpus is
// unanimous, a chain here must use the corpus's form. Each rule below names
// its count; docs/shortcuts-format-notes.md carries the table.

const ROOT = path.join(__dirname, "..");
const chains = fs.readdirSync(path.join(ROOT, "workflows"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", f), "utf8"))]);

const kind = (v) => (v === undefined ? "absent" : typeof v === "string" ? "literal" : v.WFSerializationType || "other");

test("Replace Text: input and replacement are token strings or literals, never attachments (600 + 88 of 754, 0 attachments)", () => {
  const bad = [];
  for (const [f, c] of chains)
    for (const a of c.actions)
      if (a.id.endsWith("text.replace"))
        for (const field of ["WFInput", "WFReplaceTextReplace"])
          if (kind(a.p[field]) === "WFTextTokenAttachment") bad.push(`${f} ${field}`);
  assert.deepStrictEqual(bad, []);
});

test("Run Shortcut: the input is an attachment or absent, never a token string (955 of 1130, 0 token strings)", () => {
  // The shape that took the 2026-09-03 ERROR arm down: a Run Shortcut card
  // handed a token string shows an empty parameter, and Shortcuts stops with
  // "Please choose a value for each parameter in this action".
  const bad = [];
  for (const [f, c] of chains)
    for (const a of c.actions)
      if (a.id.endsWith("runworkflow") && kind(a.p.WFInput) === "WFTextTokenString") bad.push(f);
  assert.deepStrictEqual(bad, []);
});

test("If: a text condition on a Get Dictionary Value output reads it as text (158 of 158 coerce, 0 do not)", () => {
  // The red "contains" of 2026-09-03: a dictionary value offers only has-value
  // conditions, so an If comparing it as text is invalid until the variable is
  // coerced to WFStringContentItem, which every corpus instance does.
  const TEXT = new Set([4, 5, 8, 9, 99, 999]);
  const bad = [];
  for (const [f, c] of chains) {
    const kinds = Object.fromEntries(c.actions.filter((a) => a.p.UUID).map((a) => [a.p.UUID, a.id.split(".").pop()]));
    for (const a of c.actions) {
      if (!a.id.endsWith("conditional") || a.p.WFControlFlowMode !== 0 || !TEXT.has(a.p.WFCondition)) continue;
      const v = a.p.WFInput?.Variable?.Value || {};
      if (kinds[v.OutputUUID] !== "getvalueforkey") continue;
      const coerced = (v.Aggrandizements || []).some((g) => g.CoercionItemClass === "WFStringContentItem");
      if (!coerced) bad.push(`${f} If ${a.p.WFConditionalActionString}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

test("Get Dictionary Value: a variable key is a token string (276 of 911, 0 attachments)", () => {
  const bad = [];
  for (const [f, c] of chains)
    for (const a of c.actions)
      if (a.id.endsWith("getvalueforkey") && kind(a.p.WFDictionaryKey) === "WFTextTokenAttachment") bad.push(f);
  assert.deepStrictEqual(bad, []);
});

test("every U+FFFC anchor sits where its range says, in every chain", () => {
  const walk = (node, f, seen) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, f, seen));
    if (!node || typeof node !== "object") return;
    if (typeof node.string === "string" && node.attachmentsByRange) {
      for (const range of Object.keys(node.attachmentsByRange)) {
        const at = Number(range.match(/\{(\d+), 1\}/)[1]);
        assert.strictEqual(node.string[at], "￼", `${f}: ${JSON.stringify(node.string)} @${at}`);
        seen.n++;
      }
    }
    Object.values(node).forEach((v) => walk(v, f, seen));
  };
  const seen = { n: 0 };
  for (const [f, c] of chains) walk(c.actions, f, seen);
  assert.ok(seen.n > 50, "expected many anchored strings across the library, saw " + seen.n);
});

// ── The op route, as the two chains carry it ────────────────────────────────

const runOp = chains.find(([f]) => f === "run-op.json")[1];
const claude = chains.find(([f]) => f === "claude-session.json")[1];

test("Run-Op fetches the op by name from web-tools, evaluates it synchronously, and spells the token placeholder once", () => {
  const expr = runOp.actions.find((a) => a.id.endsWith("gettext")).p.WFTextActionText.Value.string;
  assert.ok(expr.includes("https://cdn.jsdelivr.net/gh/mehrlander/web-tools@main/lib/ops/"), "the op address");
  assert.ok(expr.includes("x.open('GET'") && expr.includes(",false)"), "synchronous XMLHttpRequest");
  assert.ok(expr.includes("eval(x.responseText)"), "the file is a value");
  // jsDelivr serves a branch ref with max-age=604800, and a sync XMLHttpRequest
  // honours the phone's HTTP cache: without this the op ran stale for seven
  // days (2026-09-03, two runs of an already-replaced op).
  assert.ok(expr.includes(".js?_='+Date.now()"), "the op address defeats the client cache");
  assert.strictEqual(expr.split("🎟️GitHubToken").length - 1, 1, "the placeholder is spelled once in the expression");
  // Get-JsonFromJs calls the injector only inside its no-input demo branch
  // (actions 0 to 5 of the dump); the real path never does. The first device
  // run to reach the op failed at setRequestHeader with a bare TypeError, which
  // is what a header value carrying the literal emoji placeholder produces.
  const names = runOp.actions.filter((a) => a.id.endsWith("runworkflow")).map((a) => a.p.WFWorkflowName);
  assert.deepStrictEqual(names, ["Inject-🎟️GitHubToken", "Get-JsonFromJs"], "inject, then evaluate");
  const inject = runOp.actions.find((a) => a.p.WFWorkflowName === "Inject-🎟️GitHubToken");
  const evalr = runOp.actions.find((a) => a.p.WFWorkflowName === "Get-JsonFromJs");
  assert.strictEqual(inject.p.WFInput.Value.OutputName, "Text");
  assert.strictEqual(evalr.p.WFInput.Value.OutputUUID, inject.p.UUID, "the evaluator receives the injected text");
  assert.ok(!runOp.actions.some((a) => a.id.endsWith("openurl") || a.id.endsWith("detect.text")),
    "Run-Op neither opens nor coerces: Get-JsonFromJs owns the data: URL");
});

test("Claude-Session reads the clipboard as an action, names the op, and opens the op's own URL for the chosen row", () => {
  const ids = claude.actions.map((a) => a.id.split(".").pop());
  assert.strictEqual(ids[0], "getclipboard", "the clipboard is read by an action, not inlined as a token");
  const ask = claude.actions[1].p.WFTextActionText.Value.string;
  assert.strictEqual(ask, "session-menu\n￼");
  assert.ok(claude.actions.some((a) => a.p.WFWorkflowName === "Run-Op"));
  const keys = claude.actions.filter((a) => a.id.endsWith("getvalueforkey")).map((a) => a.p.WFDictionaryKey);
  assert.deepStrictEqual(keys.filter((k) => typeof k === "string"), ["caption", "rows", "urls"]);
  assert.ok(!ids.includes("replace"), "no row is parsed: the chosen row is a key into `urls`");
  assert.strictEqual(ids.filter((i) => i === "openurl").length, 1);
  assert.ok(!JSON.stringify(claude).includes("session.html"), "the destination is the op's to decide");
});

test("Claude-Session's error arm logs with its build id before showing", () => {
  const i = claude.actions.findIndex((a) => a.p.WFConditionalActionString === "ERROR");
  assert.ok(i > 0);
  const line = claude.actions[i + 1], log = claude.actions[i + 2], show = claude.actions[i + 3];
  assert.ok(line.id.endsWith("gettext") && line.p.WFTextActionText.Value.string.includes('"build":"#BUILD#"'));
  assert.strictEqual(log.p.WFWorkflowName, "Log-Repo");
  assert.strictEqual(log.p.WFInput.WFSerializationType, "WFTextTokenAttachment");
  assert.ok(show.id.endsWith("showresult"));
});
