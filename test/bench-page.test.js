const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "pages", "bench-run.html"), "utf8");

// The page runs inside a data: URL on a phone, and this sandbox's Chromium gives
// a data: document no network at all, so a headless browser cannot exercise the
// library path either. Run the real script here instead, the way show.test.js
// runs the shell's: substituted exactly as the chain substitutes it, against a
// stubbed document and a stubbed XMLHttpRequest.
//
// What is NOT covered, and cannot be: whether the device's rich-text coercion
// waits for the blocking fetch. probe-coercion measured that on 2026-08-28
// (40,214 bytes off jsDelivr, evaluated and used, 738 ms) and only a device can.
function run(op, input, xhr) {
  const b64 = Buffer.from(input, "utf8").toString("base64");
  const js = SRC.slice(SRC.indexOf("<script>") + 8, SRC.lastIndexOf("</script>"))
    .replaceAll("__OP__", op).replaceAll("__IN__", b64);
  let text = null;
  const ctx = {
    atob: s => Buffer.from(s, "base64").toString("binary"),
    Uint8Array, TextDecoder, JSON, Error, Object,
    XMLHttpRequest: function () {
      this.open = (m, u) => { this.url = u; };
      this.send = () => Object.assign(this, xhr ? xhr(this.url) : { status: 404 });
    },
    document: {
      getElementById: () => ({ set textContent(v) { text = v; }, get textContent() { return text; } }),
      createElement: () => ({ set innerHTML(h) { this._t = h.replace(/<[^>]*>/g, ""); },
                              get textContent() { return this._t; } })
    }
  };
  vm.createContext(ctx);
  ctx.window = ctx;              // the page reads window[<global>] after eval
  vm.runInContext(js, ctx);
  return text;
}

test("each placeholder occurs exactly once in the file", () => {
  // Both were also written in the page's own comment, so the chain's first
  // Replace Text landed there and the page reported an op it was never given.
  assert.strictEqual((SRC.match(/__OP__/g) || []).length, 1, "__OP__");
  assert.strictEqual((SRC.match(/__IN__/g) || []).length, 1, "__IN__");
});

test("the payload survives base64 with quotes, newlines and non-ASCII", () => {
  const s = 'héllo ✅ "quotes" `ticks`\nsecond line';
  assert.strictEqual(run("echo", s), s);
});

test("ops that need no library answer without a request", () => {
  assert.deepStrictEqual(JSON.parse(run("stats", "one two\nthree")),
    { chars: 13, words: 3, lines: 2 });
  assert.match(run("json", '{"z":1,"a":[2]}'), /\n {2}"z": 1/);
});

test("a library-backed op fetches its own file, evaluates it, and uses the global", () => {
  let asked = null;
  const out = run("md", "hi", url => {
    asked = url;
    return { status: 200, responseText: 'var marked = { parse: function (s) { return "<p>" + s + "</p>"; } };' };
  });
  assert.strictEqual(asked, "https://cdn.jsdelivr.net/npm/marked/marked.min.js",
    "each op names its own dist file; a bare package name would take a CommonJS default");
  assert.strictEqual(out, "<p>hi</p>", "the evaluated global has to be reachable as window.marked");
});

test("a CDN failure is reported rather than thrown", () => {
  // A throw inside the page leaves the <pre> at its placeholder, and the caller
  // gets a value that looks like a runtime answer. Every failure is a value.
  assert.match(run("md", "hi", () => ({ status: 503, responseText: "" })), /^BENCH ERR: .*503/);
});

test("an unknown op names the ones that exist", () => {
  const out = run("nope", "x");
  assert.match(out, /^BENCH ERR: Error: no op nope/);
  for (const op of ["echo", "stats", "json", "md", "mdplain", "html2md", "yaml", "csv"])
    assert.ok(out.includes(op), `${op} should be listed`);
});
