const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PAGE = path.join(ROOT, "pages", "session-lines.html");
const CHAIN = path.join(ROOT, "workflows", "claude-session.json");
const TOKEN = "🎟️GitHubToken";
const CLIP = "📋ClipboardBase64";

// The page runs on device inside a data: URL that is never displayed, so
// nothing about it can be inspected there. It is exercised here whole: the
// substitutions, the sync read, the caption, and the row format the chain's
// own regex has to be able to reverse.
function render({ rows = [], status = 200, token = "ghp_x", clip = null, generatedAt = null } = {}) {
  const html = fs.readFileSync(PAGE, "utf8");
  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const sent = [];
  const el = { textContent: "" };
  const ctx = {
    document: { getElementById: () => el },
    XMLHttpRequest: function () {
      this.open = (method, url, async) => sent.push({ method, url, async });
      this.setRequestHeader = (k, v) => sent.push([k, v]);
      this.send = () => { this.status = status; this.responseText = JSON.stringify({ generatedAt, rows }); };
    },
    TextDecoder, Uint8Array, Date, JSON, Math, RegExp, Error, isFinite,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    sent,
  };
  // The substitutions the device performs, performed here the same way.
  let src = script;
  if (token) src = src.replace(TOKEN, token);
  if (clip !== null) src = src.replace(CLIP, Buffer.from(clip, "utf8").toString("base64"));
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { text: el.textContent, sent, ctx };
}

const row = (id, started, ask, branches) => ({ id, started, ask, branches: branches || [], repos: [] });
const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();

test("each placeholder appears exactly once, comments included, and the sentinels are built from halves", () => {
  const html = fs.readFileSync(PAGE, "utf8");
  for (const p of [TOKEN, CLIP]) assert.strictEqual(html.split(p).length - 1, 1, p);
  assert.match(html, /'🎟️' \+ 'GitHubToken'/);
  assert.match(html, /'📋' \+ 'ClipboardBase64'/);
});

test("an unsubstituted token is reported rather than sent", () => {
  const { text, sent } = render({ token: null });
  assert.match(text, /^ERROR no token substituted/);
  assert.strictEqual(sent.length, 0, "nothing should be fetched without a token");
});

test("the index is read synchronously, raw, and with the token as sent", () => {
  const { sent } = render({ token: "ghp_x", rows: [] });
  const open = sent.find((s) => s.method);
  assert.strictEqual(open.async, false, "an async read returns after the coercion has captured the page");
  assert.match(open.url, /state\/sessions\.json\?ref=main$/);
  assert.deepStrictEqual(sent.find((s) => s[0] === "Authorization"), ["Authorization", "Bearer ghp_x"]);
  assert.deepStrictEqual(sent.find((s) => s[0] === "Accept"), ["Accept", "application/vnd.github.raw"]);
});

test("a stored token that carries its own scheme is not given a second one", () => {
  const { sent } = render({ token: "token ghp_x" });
  assert.deepStrictEqual(sent.find((s) => s[0] === "Authorization"), ["Authorization", "token ghp_x"]);
});

test("a failed read becomes one ERROR line and no rows", () => {
  const { text } = render({ status: 401 });
  assert.strictEqual(text, "ERROR HTTP 401 reading state/sessions.json");
});

test("the clipboard's shapes all reduce to the branch name", () => {
  const want = "claude/double-tap-read-aloud-shortcut-wb6uh9";
  const rows = [row("aaaaaaaa", iso(30), "On the branch", [want])];
  for (const clip of [
    want, "origin/" + want, "refs/heads/" + want, "  " + want + "\n",
    "https://github.com/mehrlander/web-tools/tree/" + want,
    "https://github.com/mehrlander/web-tools/compare/" + want + "?expand=1",
    "https://mehrlander.github.io/web-tools/pages/branch.html#gh=mehrlander/web-tools@" + want,
    want + "\nsecond line of a caption",
  ]) {
    const { text } = render({ rows, clip });
    assert.strictEqual(text.split("§§")[0], "1 on " + want, JSON.stringify(clip));
  }
});

test("the caption names each of the three cases in words", () => {
  const here = row("aaaaaaaa", iso(30), "Ask", ["claude/x"]);
  const other = row("bbbbbbbb", iso(90), "Ask", ["claude/y"]);
  assert.strictEqual(render({ rows: [here, other], clip: "claude/x" }).text.split("§§")[0], "1 on claude/x");
  assert.strictEqual(render({ rows: [other], clip: "claude/x" }).text.split("§§")[0],
    "No session on claude/x yet, showing recent");
  assert.strictEqual(render({ rows: [other], clip: "not a branch" }).text.split("§§")[0],
    "No branch on the clipboard, showing recent");
});

test("branch matches lead, are marked, and are not repeated among the recent", () => {
  const rows = [
    row("aaaaaaaa", iso(600), "Older, on the branch", ["claude/x"]),
    row("bbbbbbbb", iso(30), "Newest, elsewhere", ["claude/y"]),
    row("cccccccc", iso(60), "On the branch too", ["claude/x"]),
  ];
  const lines = render({ rows, clip: "claude/x" }).text.split("§§")[1].split("\n");
  assert.deepStrictEqual(lines.map((l) => l.slice(0, 8)), ["cccccccc", "aaaaaaaa", "bbbbbbbb"]);
  assert.match(lines[0], /^cccccccc · this branch · 1h · On the branch too$/);
  assert.ok(!lines[2].includes("this branch"));
  assert.strictEqual(lines.filter((l) => l.startsWith("aaaaaaaa")).length, 1);
});

test("a session is matched by a repo's branch as well as the branches list", () => {
  const r = { id: "aaaaaaaa", started: iso(10), ask: "Ask", branches: [], repos: [{ name: "home", branch: "claude/x" }] };
  assert.strictEqual(render({ rows: [r], clip: "claude/x" }).text.split("§§")[0], "1 on claude/x");
});

test("a row's ask is plain and bounded, so a long ask cannot push the id off screen", () => {
  const rows = [row("aaaaaaaa", iso(5), "**Bold** and `code` and [label](https://x.y/z) " + "word ".repeat(60))];
  const line = render({ rows }).text.split("§§")[1];
  assert.ok(line.length < 100, "row was " + line.length + " characters");
  assert.ok(!/[*`\[\]]/.test(line));
  assert.ok(line.endsWith("…"));
});

test("an ask carrying the separator cannot split the caption off the rows", () => {
  const rows = [row("aaaaaaaa", iso(5), "An ask with §§ inside it")];
  const parts = render({ rows }).text.split("§§");
  assert.strictEqual(parts.length, 2, "the separator should survive only as structure");
  assert.match(parts[1], /^aaaaaaaa · 5m · An ask with inside it$/);
});

test("the chain's own regex recovers the id from every row the page can emit", () => {
  // The joint between the two files: the page decides the row format and the
  // chain deletes from the first separator onward. A row carrying its own
  // " · " must still reduce to the id.
  const chain = JSON.parse(fs.readFileSync(CHAIN, "utf8"));
  const strip = chain.actions.find((a) => a.p.WFReplaceTextRegularExpression === true);
  assert.ok(strip, "the chain should recover the id with a regular expression");
  const re = new RegExp(strip.p.WFReplaceTextFind);
  const rows = [
    row("aaaaaaaa", iso(5), "An ask · with the separator · inside it", ["claude/x"]),
    row("bbbbbbbb", iso(5000), "Plain"),
  ];
  for (const line of render({ rows, clip: "claude/x" }).text.split("§§")[1].split("\n"))
    assert.match(line.replace(re, ""), /^[0-9a-f]{8}$/, line);
});

test("the chain runs the page headless and opens the hosted page, never a data URL", () => {
  const chain = JSON.parse(fs.readFileSync(CHAIN, "utf8"));
  const ids = chain.actions.map((a) => a.id);
  assert.ok(ids.includes("is.workflow.actions.detect.text"), "the data URL is coerced, not opened");
  assert.ok(ids.includes("is.workflow.actions.choosefromlist"), "the menu is Shortcuts' own");
  const opened = chain.actions.filter((a) => a.id === "is.workflow.actions.openurl");
  assert.strictEqual(opened.length, 1);
  const built = JSON.stringify(chain.actions.find((a) => a.p.WFTextActionText?.Value?.string?.includes("session.html")));
  assert.ok(built.includes("mehrlander.github.io/web-tools/pages/session.html#id="));
  assert.ok(!JSON.stringify(chain.actions.find((a) => a.id === "is.workflow.actions.openurl")).includes("data:"));
});

test("every U+FFFC anchor in the chain sits where its string says it does", () => {
  const chain = JSON.parse(fs.readFileSync(CHAIN, "utf8"));
  let seen = 0;
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.string === "string" && node.attachmentsByRange) {
      for (const range of Object.keys(node.attachmentsByRange)) {
        const at = Number(range.match(/\{(\d+), 1\}/)[1]);
        assert.strictEqual(node.string[at], "￼", node.string);
        seen++;
      }
    }
    Object.values(node).forEach(walk);
  };
  walk(chain.actions);
  assert.ok(seen >= 5, "expected several anchored strings, saw " + seen);
});
