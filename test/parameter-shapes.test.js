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
const choose = chains.find(([f]) => f === "choose-claude.json")[1];

test("Run-Op fetches the op through the API that needs no purge, evaluates it synchronously, and spells the token placeholder once", () => {
  const expr = runOp.actions.find((a) => a.id.endsWith("gettext")).p.WFTextActionText.Value.string;
  // NOT jsDelivr, and the header is the whole reason. Measured 2026-09-08:
  // jsDelivr serves a branch ref `public, max-age=604800, s-maxage=43200`, so
  // an edge holds a replaced op for twelve hours and every publish owed a purge
  // of the ref path. The contents API serves `private, max-age=60`: no shared
  // cache exists to go stale, so a merge is the whole publish. The op's own
  // data fetch has always used this route and has never needed a purge, which
  // is what made the choice obvious once anyone compared the two.
  assert.ok(expr.includes("https://api.github.com/repos/mehrlander/web-tools/contents/lib/ops/"), "the op address");
  assert.ok(!expr.includes("cdn.jsdelivr.net"), "no CDN in the path, or the purge comes back");
  assert.ok(expr.includes("x.open('GET'") && expr.includes(",false)"), "synchronous XMLHttpRequest");
  assert.ok(expr.includes("eval(x.responseText)"), "the file is a value");
  // The envelope this API returns by default base64s the body; the raw media
  // type is what makes `eval(x.responseText)` the file rather than JSON around
  // it. Same pair of headers the op sets on its own fetch, which is the reason
  // this route is known to survive the data: page's null origin at all.
  assert.ok(expr.includes("'Accept','application/vnd.github.raw'"), "raw, not the contents envelope");
  assert.ok(expr.includes("x.setRequestHeader('Authorization'"), "authenticated, for the rate limit and for a private repo");
  // A sync XMLHttpRequest honours the phone's own HTTP cache, which the API
  // still sets to 60 seconds. Cheap to defeat, and it keeps "current" meaning
  // current (2026-09-03, two runs of an already-replaced op under the old CDN).
  assert.ok(expr.includes("&_='+Date.now()"), "the op address defeats the client cache");
  assert.strictEqual(expr.split("🎟️GitHubToken").length - 1, 1, "the placeholder is spelled once in the expression");
  // BOTH ANCHORS SIT ABOVE THE PLACEHOLDER, deliberately. U+FFFC offsets are
  // stored as one number, and `🎟️` is two code points but three UTF-16 units,
  // so an anchor below it lands in a different place depending on which
  // convention writes the file and which reads it. Keeping the placeholder last
  // makes the two agree and removes the question.
  const anchors = Object.keys(runOp.actions.find((a) => a.id.endsWith("gettext"))
    .p.WFTextActionText.Value.attachmentsByRange).map((k) => Number(k.match(/\{(\d+), 1\}/)[1]));
  assert.ok(Math.max(...anchors) < expr.indexOf("🎟️GitHubToken"),
    "an anchor below the placeholder makes code-point and UTF-16 offsets disagree");
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

test("Choose-Claude is a shell: it asks the op for the whole menu and draws it", () => {
  // The menu moved into web-tools' lib/ops/session-menu.js on 2026-09-08, so
  // this chain names no row, no address and no session. That is the point: the
  // menu's wording, order and verbs are now a commit there rather than an
  // install here, and shortcut-tools' CLAUDE.md ranks the device as the
  // expensive resource.
  //
  // The two-line input is built with Get Text and handed over by attachment,
  // which is the 2026-09-03 corrective: a field that interpolates a variable
  // itself arrives empty on the phone. The format notes carry the measurement.
  const [clip, text, run] = choose.actions;
  assert.ok(clip.id.endsWith("getclipboard"), "the clipboard is read by an action, not inlined as a token");
  assert.ok(text.id.endsWith("gettext"), "the op's input is built as text first");
  assert.strictEqual(text.p.WFTextActionText.Value.string, "session-menu\n\uFFFC",
    "Run-Op splits on newlines: the op's name, then one line of input");
  assert.strictEqual(run.p.WFWorkflowName, "Run-Op");
  assert.strictEqual(run.p.WFInput.Value.OutputUUID, text.p.UUID);

  // Three reads off one result, and no fourth: anything else the menu needs is
  // the op's job to put in one of them.
  const keys = choose.actions.filter((a) => a.id.endsWith("getvalueforkey"))
    .map((a) => a.p.WFDictionaryKey).filter((k) => typeof k === "string");
  assert.deepStrictEqual(keys, ["caption", "menu", "urls"]);
  const list = choose.actions.find((a) => a.id.endsWith("choosefromlist"));
  const by = (name) => choose.actions.find((a) => a.p.CustomOutputName === name);
  assert.strictEqual(list.p.WFChooseFromListActionPrompt.Value.attachmentsByRange["{0, 1}"].OutputUUID,
    by("Caption").p.UUID, "the caption is the menu's prompt");
  assert.strictEqual(list.p.WFInput.Value.OutputUUID, by("Menu").p.UUID,
    "the rows are `menu`, which the op guarantees is never empty, an ERROR included");
});

test("Choose-Claude dispatches a row by the map first and by name second, and Out leaves", () => {
  // The dispatch that lets the op mix sessions and verbs in one list: look the
  // chosen row up in `urls`; a hit is a page, a miss is a shortcut name. Same
  // has-value idiom Get-AppRoute uses. Reverse the two arms and every session
  // row becomes a search for a shortcut named after somebody's ask.
  const out = choose.actions.find((a) => a.p.WFConditionalActionString === "Out");
  assert.ok(out, "Out is tested explicitly, not left to fail a name lookup");
  assert.strictEqual(out.p.WFCondition, 5, "`is not`, so every other row falls through to the dispatch");
  // "Out" is web-tools' VERBS, the tail lib/ops/session-menu.js appends to every
  // result; tools/test/ops.test.mjs pins the other half of this pair. Two repos,
  // no shared CI, so each side pins the string it names.
  const list = choose.actions.find((a) => a.id.endsWith("choosefromlist"));
  assert.strictEqual(out.p.WFInput.Variable.Value.OutputUUID, list.p.UUID);

  const lookup = choose.actions.find((a) => a.p.CustomOutputName === "Url");
  assert.strictEqual(lookup.p.WFDictionaryKey.WFSerializationType, "WFTextTokenString",
    "the chosen row is the key, and a variable key is a token string");
  assert.strictEqual(lookup.p.WFInput.Value.OutputUUID,
    choose.actions.find((a) => a.p.CustomOutputName === "Urls").p.UUID);

  const i = choose.actions.indexOf(lookup);
  const [has, url, open, other, run] = choose.actions.slice(i + 1, i + 6);
  assert.strictEqual(has.p.WFCondition, 100, "has any value");
  assert.strictEqual(has.p.WFInput.Variable.Value.OutputUUID, lookup.p.UUID);
  assert.ok(url.id.endsWith("url") && open.id.endsWith("openurl"), "a hit opens the page");
  assert.strictEqual(url.p.WFURLActionURL.WFSerializationType, "WFTextTokenAttachment",
    "the URL card takes the looked-up value by attachment, never a string it interpolates itself");
  assert.strictEqual(other.p.WFControlFlowMode, 1);
  assert.ok(run.id.endsWith("runworkflow"), "a miss runs the row as a shortcut name");
  assert.strictEqual(run.p.WFWorkflowName.Value.attachmentsByRange["{0, 1}"].OutputUUID, list.p.UUID);
});
