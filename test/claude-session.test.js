const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const PAGE = path.join(__dirname, "..", "pages", "claude-session.html");
const TOKEN = "🎟️GitHubToken";
const CLIP = "📋ClipboardBase64";

// The page runs on device inside a data: URL, where nothing can be inspected,
// so the logic block (the first <script>, no DOM in it) is exercised here: the
// branch reduction, the index match, the record path, the card grouping and
// the Speak-Text link. The Alpine half is layout and is not tested.
function logic() {
  const html = fs.readFileSync(PAGE, "utf8");
  const open = html.indexOf('<script id="logic">');
  const script = html.slice(html.indexOf(">", open) + 1, html.indexOf("</script>", open));
  const ctx = { Date, JSON, Math, RegExp, encodeURIComponent, TextDecoder, atob: (s) => Buffer.from(s, "base64").toString("binary") };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return ctx;
}

test("each placeholder appears exactly once, comments included, and the sentinels are built from halves", () => {
  const html = fs.readFileSync(PAGE, "utf8");
  for (const p of [TOKEN, CLIP]) assert.strictEqual(html.split(p).length - 1, 1, p);
  assert.match(html, /'🎟️' \+ 'GitHubToken'/);
  assert.match(html, /'📋' \+ 'ClipboardBase64'/);
});

test("a raw open sees both sentinels unsubstituted", () => {
  const c = logic();
  assert.strictEqual(c.TOKEN, c.TOKEN_KEY);
  assert.strictEqual(c.CLIP, c.CLIP_KEY);
});

test("the clipboard's shapes all reduce to the branch name", () => {
  const { branchOf } = logic();
  const want = "claude/double-tap-read-aloud-shortcut-wb6uh9";
  for (const s of [
    want, "origin/" + want, "refs/heads/" + want, "  " + want + "\n",
    "https://github.com/mehrlander/web-tools/tree/" + want,
    "https://github.com/mehrlander/web-tools/compare/" + want + "?expand=1",
    "https://mehrlander.github.io/web-tools/pages/branch.html#gh=mehrlander/web-tools@" + want,
    "https://mehrlander.github.io/web-tools/pages/session.html#branch=" + want,
    want + "\nsecond line of a caption",
  ]) assert.strictEqual(branchOf(s), want, JSON.stringify(s));
  assert.strictEqual(branchOf(""), "");
  assert.strictEqual(branchOf("a sentence with spaces"), "");
  assert.strictEqual(branchOf("nobranchhere"), "");
});

test("the index match reads both branch carriers and sorts newest first", () => {
  const { matches, latest } = logic();
  const rows = [
    { id: "a", started: "2026-09-01T00:00:00Z", branches: ["claude/x"], repos: [] },
    { id: "b", started: "2026-09-02T00:00:00Z", branches: [], repos: [{ name: "home", branch: "claude/x" }] },
    { id: "c", started: "2026-09-03T00:00:00Z", branches: ["claude/y"], repos: [] },
  ];
  assert.deepStrictEqual(matches(rows, "claude/x").map(r => r.id), ["b", "a"]);
  assert.deepStrictEqual(matches(rows, ""), []);
  assert.deepStrictEqual(latest(rows, 2).map(r => r.id), ["c", "b"]);
  assert.deepStrictEqual(rows.map(r => r.id), ["a", "b", "c"], "the index is not reordered in place");
});

test("a row names its record the way the store lays them out", () => {
  const { recordPath } = logic();
  assert.strictEqual(recordPath({ id: "df643be7", day: "2026-09-02" }), "sessions/2026/09/2026-09-02-df643be7.json");
});

test("a card is an ask and its prose replies, tool calls left out, in time order", () => {
  const { cards } = logic();
  const rec = {
    prompts: [{ at: "2026-09-02T09:00:00Z", text: "First ask" }, { at: "2026-09-02T10:00:00Z", text: "Second ask" }],
    replies: [
      { at: "2026-09-02T09:00:05Z", text: "I'll start." },
      { at: "2026-09-02T09:30:00Z", text: "Done with the first." },
      { at: "2026-09-02T10:00:00Z", text: "On the second." },
    ],
    calls: [{ at: "2026-09-02T09:00:06Z", name: "Bash", arg: "ls" }],
  };
  const d = cards(rec);
  assert.strictEqual(d.length, 2);
  assert.strictEqual(d[0].md, "First ask\n\nI'll start.\n\nDone with the first.");
  assert.strictEqual(d[0].closing, "Done with the first.");
  assert.strictEqual(d[0].ts, "09:00");
  // Same second as the ask: the ask sorts first, so the reply joins its card.
  assert.strictEqual(d[1].md, "Second ask\n\nOn the second.");
  assert.ok(!JSON.stringify(d).includes("Bash"));
});

test("a preview line drops markdown marks and a link's URL", () => {
  const { plain } = logic();
  assert.strictEqual(plain("**Bold** and `code` and [label](https://x.y/z)\n\n```\nfence\n```\n# head"), "Bold and code and label head");
});

test("a record with no replies still speaks its last message", () => {
  const { cards } = logic();
  const d = cards({ prompts: [{ at: "2026-08-01T00:00:00Z", text: "Ask" }], last_message: "The one line." });
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].md, "Ask\n\nThe one line.");
});

test("the Speak-Text link carries the text encoded, to the receiver by name", () => {
  const { speakLink } = logic();
  const u = speakLink("Read this & that");
  assert.ok(u.startsWith("shortcuts://run-shortcut?name=Speak-Text&input=text&text="));
  assert.strictEqual(decodeURIComponent(u.split("&text=")[1]), "Read this & that");
});
