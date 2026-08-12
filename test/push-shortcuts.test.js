const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const PAGE = path.join(__dirname, "..", "pages", "push-shortcuts.html");
const TOKEN = "🎟️GitHubToken";
const CLIP = "📋ClipboardBase64";

// The page runs inside a data: URL after Show-Html has rewritten two
// placeholders in it, so the harness rewrites them the same way and runs the
// script. Substitution is a plain text replace, exactly as the injector does it.
function load({ clipboard = null, token = "ghp_test", requests = [] } = {}) {
  let script = fs.readFileSync(PAGE, "utf8");
  script = script.slice(script.indexOf("<script>") + 8, script.lastIndexOf("</script>"));
  if (clipboard !== null) script = script.split(CLIP).join(Buffer.from(clipboard).toString("base64"));
  if (token !== null) script = script.split(TOKEN).join(token);

  const els = {};
  const el = (id) => (els[id] = els[id] || { textContent: "", className: "", hidden: true, onclick: null });
  const ctx = {
    atob: (b) => Buffer.from(b, "base64").toString("binary"),
    Uint8Array, TextDecoder, XMLHttpRequest: function () {
      this.open = (method, url) => Object.assign(this, { method, url });
      this.setRequestHeader = (k, v) => (this.headers = Object.assign(this.headers || {}, { [k]: v }));
      this.send = (body) => {
        const r = requests.shift() || { status: 404, text: "{}" };
        Object.assign(this, { status: r.status, responseText: r.text });
        ctx.sent.push({ method: this.method, url: this.url, headers: this.headers, body });
      };
    },
    document: { getElementById: el }, JSON, Object, Array, Date, Error, RegExp, els, sent: []
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  ctx.out = () => els.out.textContent;
  return ctx;
}

test("an unsubstituted clipboard is reported rather than decoded", () => {
  const ctx = load({ clipboard: null, token: "ghp_test" });
  assert.match(ctx.out(), /No clipboard was substituted/);
  assert.strictEqual(ctx.sent.length, 0, "and nothing is sent");
});

test("an unsubstituted token is reported before anything is read", () => {
  const ctx = load({ clipboard: '[]', token: null });
  assert.match(ctx.out(), /No token was substituted/);
});

test("the clipboard is decoded as UTF-8, not as bytes", () => {
  // atob returns a binary string, so a multi-byte character survives only if it
  // is decoded properly afterwards. Shortcut names contain emoji routinely.
  const ctx = load({ clipboard: JSON.stringify([{ name: "Inject-🎟️Token" }]) });
  assert.match(ctx.out(), /Parses as JSON: 1 items/);
  assert.match(ctx.out(), /First item keys: name/);
});

test("a dump that is not JSON says so instead of failing at push time", () => {
  const ctx = load({ clipboard: "not json at all" });
  assert.match(ctx.out(), /Does not parse as JSON/);
  assert.ok(!ctx.els.go.hidden, "and the push is still offered, since the bytes are the point");
});

// A shortcut library routinely carries keys inline. The scan is a heuristic, so
// it warns rather than blocks, and the destination is private either way.
test("a credential in the dump is named before the push", () => {
  const ctx = load({ clipboard: 'x ghp_' + "a".repeat(30) + ' y' });
  assert.match(ctx.out(), /WARNING: found a GitHub token/);
  assert.strictEqual(ctx.els.out.className, "warn");
});

test("a clean dump raises no warning", () => {
  const ctx = load({ clipboard: '[{"a":1}]' });
  assert.ok(!/WARNING/.test(ctx.out()));
});

test("pushing sends the base64 the injector supplied, not a re-encoding", () => {
  const payload = JSON.stringify([{ name: "one" }]);
  const ctx = load({ clipboard: payload, requests: [{ status: 404, text: "{}" }, { status: 201, text: "{}" }] });
  ctx.els.go.onclick();
  const [head, write] = ctx.sent;
  assert.strictEqual(head.method, "GET", "the existing file is looked up first");
  assert.strictEqual(write.method, "PUT");
  assert.match(write.url, /repos\/mehrlander\/web-tools-private\/contents\/shortcuts\/dump-\d{4}-\d{2}-\d{2}\.json$/);
  const body = JSON.parse(write.body);
  assert.strictEqual(body.content, Buffer.from(payload).toString("base64"),
    "re-encoding here would double-encode what Show-Html already encoded");
  assert.ok(!("sha" in body), "absent means a new file");
  assert.match(write.headers.Authorization, /^Bearer ghp_test$/);
  assert.match(ctx.out(), /Pushed \d+ characters/);
});

test("a second push the same day replaces rather than failing", () => {
  const ctx = load({ clipboard: '[]',
                     requests: [{ status: 200, text: '{"sha":"abc123"}' }, { status: 200, text: "{}" }] });
  ctx.els.go.onclick();
  assert.strictEqual(JSON.parse(ctx.sent[1].body).sha, "abc123",
    "the contents API refuses an update without the current sha");
  assert.match(ctx.out(), /replaced today's earlier dump/);
});

test("a failed push reports the status instead of claiming success", () => {
  const ctx = load({ clipboard: '[]',
                     requests: [{ status: 404, text: "{}" }, { status: 403, text: '{"message":"nope"}' }] });
  ctx.els.go.onclick();
  assert.match(ctx.out(), /^ERROR HTTP 403/);
});

test("each placeholder appears exactly once, comments included", () => {
  const html = fs.readFileSync(PAGE, "utf8");
  for (const p of [TOKEN, CLIP]) {
    assert.strictEqual(html.split(p).length - 1, 1, p + " should appear once");
  }
  assert.ok(html.includes("'🎟️' + 'GitHubToken'") && html.includes("'📋' + 'ClipboardBase64'"),
    "both sentinels must be assembled from halves");
});
