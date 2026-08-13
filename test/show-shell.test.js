const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SHELL = path.join(ROOT, "tools", "show-shell.html");
const CHAIN = path.join(ROOT, "workflows", "show-html-js.json");

const PAGE = "📄PageBase64";
const CLIP = "📋ClipboardBase64";
const TOKEN = "🎟️GitHubToken";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// The shell runs in a data: URL on a phone after three text replaces have
// rewritten it. The harness rewrites it the same way, with a plain text
// replace, and runs the script. What it writes is what Safari would render.
function run({ page = null, clipboard = null, token = null, fetches = {} } = {}) {
  let script = fs.readFileSync(SHELL, "utf8");
  script = script.slice(script.indexOf("<script>") + 8, script.lastIndexOf("</script>"));
  if (page !== null) script = script.split(PAGE).join(b64(page));
  if (clipboard !== null) script = script.split(CLIP).join(b64(clipboard));
  if (token !== null) script = script.split(TOKEN).join(token);

  let written = null, failed = null;
  const ctx = {
    atob: (b) => Buffer.from(b, "base64").toString("binary"),
    Uint8Array, TextDecoder, Error, RegExp,
    XMLHttpRequest: function () {
      this.open = (method, url, async) => Object.assign(this, { url, async });
      this.send = () => {
        ctx.requests.push({ url: this.url, async: this.async });
        const hit = fetches[this.url];
        Object.assign(this, hit === undefined
          ? { status: 404, responseText: "" }
          : { status: 200, responseText: hit });
      };
    },
    requests: [],
    document: {
      open() { written = ""; },
      write(h) { written += h; },
      close() {},
      body: { set textContent(v) { failed = v; } }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return { html: written, error: failed, requests: ctx.requests };
}

test("the page arrives decoded, and UTF-8 rather than bytes", () => {
  const { html } = run({ page: "<p>Inject-🎟️Token</p>" });
  assert.strictEqual(html, "<p>Inject-🎟️Token</p>");
});

test("an unsubstituted page is reported rather than written", () => {
  const { html, error } = run({});
  assert.strictEqual(html, null, "nothing should be written");
  assert.match(error, /no page was substituted/);
});

test("the token reaches a page that asks for it", () => {
  const { html } = run({ page: `<script>var t='${TOKEN}'<\/script>`, token: "ghp_real" });
  assert.ok(html.includes("ghp_real"));
  assert.ok(!html.includes(TOKEN), "the placeholder should be gone");
});

test("a page that does not ask for the token is unchanged by it", () => {
  const { html } = run({ page: "<p>plain</p>", token: "ghp_real" });
  assert.strictEqual(html, "<p>plain</p>");
});

// The reason the payload is base64 rather than plain text. Substitution runs
// against the shell, so an opaque payload cannot be rewritten out from under
// itself, and its own placeholders are resolved here instead.
test("the search keys survive the substitution that fills their values", () => {
  const script = fs.readFileSync(SHELL, "utf8");
  for (const p of [PAGE, CLIP, TOKEN]) {
    assert.strictEqual(script.split(p).length - 1, 1, p + " should appear once, as the value slot");
  }
  assert.ok(script.includes("'📄' + 'PageBase64'"), "page key assembled from halves");
  assert.ok(script.includes("'📋' + 'ClipboardBase64'"), "clipboard key assembled from halves");
  assert.ok(script.includes("'🎟️' + 'GitHubToken'"), "token key assembled from halves");
});

test("the clipboard arrives as the base64 the shortcut supplied, not a re-encoding", () => {
  const { html } = run({ page: `<b>${CLIP}</b>`, clipboard: "hello" });
  assert.strictEqual(html, "<b>" + b64("hello") + "</b>",
    "re-encoding here would double-encode what the shortcut already encoded");
});

test("a URL payload is fetched, and synchronously", () => {
  const { html, requests } = run({
    page: "https://example.com/p.html",
    fetches: { "https://example.com/p.html": "<h1>fetched</h1>" }
  });
  assert.strictEqual(html, "<h1>fetched</h1>");
  assert.deepStrictEqual(requests, [{ url: "https://example.com/p.html", async: false }],
    "async would let the page be read back before the response lands");
});

test("a fetched page still gets its token, which is why the shell carries the slot", () => {
  const { html } = run({
    page: "https://example.com/p.html", token: "ghp_real",
    fetches: { "https://example.com/p.html": `<b>${TOKEN}</b>` }
  });
  assert.strictEqual(html, "<b>ghp_real</b>");
});

test("a failed fetch is reported rather than written as the page", () => {
  const { html, error } = run({ page: "https://example.com/gone.html" });
  assert.strictEqual(html, null);
  assert.match(error, /HTTP 404/);
});

test("a page that merely mentions a URL is not mistaken for one", () => {
  const src = "<p>see https://example.com/p.html for more</p>";
  const { html, requests } = run({ page: src });
  assert.strictEqual(html, src);
  assert.strictEqual(requests.length, 0);
});

// What the four text.replace actions did, minus the one that fed nothing.
test("autocorrect damage is repaired", () => {
  const { html } = run({ page: "<script>var a = “x”, b = ‘y’<\/script>" });
  assert.strictEqual(html, `<script>var a = "x", b = 'y'<\/script>`);
});

test("a fenced page is unwrapped at both ends", () => {
  const { html } = run({ page: "```html\n<p>hi</p>\n```" });
  assert.strictEqual(html, "<p>hi</p>\n");
});

// The shortcut repaired after substituting, so a value carrying a curly quote
// was rewritten on the way out. Repairing first is the whole reason to move it.
test("repair runs before substitution, so a value is delivered as written", () => {
  const { html } = run({ page: `<b>${CLIP}</b>`, clipboard: "a “quoted” word" });
  assert.ok(html.includes(b64("a “quoted” word")), "the clipboard base64 is untouched");
});

test("the chain wires each action to the next and pins no device-local identifier", () => {
  const chain = JSON.parse(fs.readFileSync(CHAIN, "utf8"));
  const ids = chain.actions.map(a => a.id.replace("is.workflow.actions.", ""));
  assert.deepStrictEqual(ids, ["base64encode", "base64encode", "gettext", "text.replace",
                               "text.replace", "runworkflow", "base64encode", "url", "openurl"]);
  assert.ok(ids.length < 23, "the point is that it is shorter than the shortcut it replaces");

  const run3 = chain.actions[5].p;
  assert.strictEqual(run3.WFWorkflowName, "Inject-🎟️GitHubToken");
  assert.ok(!("WFWorkflow" in run3),
    "a WFWorkflow dict carries a workflowIdentifier minted on one device");

  const url = chain.actions[7].p.WFURLActionURL.Value;
  assert.strictEqual(url.string, "data:text/html;charset=utf-8;base64,￼");
  assert.strictEqual(Object.keys(url.attachmentsByRange)[0], "{36, 1}");

  // Each replace has to find something in the shell, or it is a silent no-op.
  const shell = fs.readFileSync(SHELL, "utf8");
  for (const i of [3, 4]) {
    assert.ok(shell.includes(chain.actions[i].p.WFReplaceTextFind),
      chain.actions[i].p.WFReplaceTextFind + " should be in the shell");
  }
});
