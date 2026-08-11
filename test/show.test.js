const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PLACEHOLDER = "🎟️GitHubToken";
const PAGES = fs.readdirSync(path.join(ROOT, "pages")).filter(f => f.endsWith(".html"));

const show = (...args) =>
  execFileSync("python3", [path.join("tools", "show.py"), ...args],
               { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const page = (f) => fs.readFileSync(path.join(ROOT, "pages", f), "utf8");
const len = (link) => decodeURIComponent(link.split("&text=")[1]).length;

// The shell runs in a data: URL on a phone, where nothing can be inspected, so
// run it here instead: the real JavaScript out of a real link, against Node's
// DecompressionStream, with the document it writes to stubbed. What comes back
// is what Safari would have rendered.
function render(link) {
  const payload = decodeURIComponent(link.split("&text=")[1]);
  const js = payload.slice(payload.indexOf("<script>") + 8, payload.lastIndexOf("</script>"));
  let written = "", settle;
  const done = new Promise((resolve, reject) => (settle = { resolve, reject }));
  const ctx = {
    atob, Uint8Array, Blob, Response, DecompressionStream,
    document: {
      open() { written = ""; },
      write(h) { written += h; },
      close() { settle.resolve(written); },
      // The shell's only failure path writes the error here.
      body: { set textContent(v) { settle.reject(new Error(v)); } }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  return done;
}

test("a compressed link inflates back to the page byte for byte", async () => {
  for (const f of PAGES) {
    assert.strictEqual(await render(show(path.join("pages", f))), page(f), f);
  }
});

// Show-Html substitutes into text and cannot reach inside a gzip stream, so the
// shell takes the substitution on the page's behalf and applies it after
// inflating. Standing in for the injector here is a plain text replace, which
// is what the injector does.
test("the injector's substitution reaches the compressed page", async () => {
  const link = show(path.join("pages", "gh-recent-branches.html"));
  assert.ok(page("gh-recent-branches.html").includes(PLACEHOLDER),
    "this test is meaningless if the page stopped carrying the placeholder");
  const injected = link.replace(encodeURIComponent(PLACEHOLDER), encodeURIComponent("ghp_fake"));
  assert.notStrictEqual(injected, link, "the placeholder should be substitutable in the link");

  const html = await render(injected);
  assert.ok(html.includes("ghp_fake"), "the token should arrive in the inflated page");
  assert.ok(!html.includes(PLACEHOLDER), "and the placeholder should be gone from it");
});

test("the shell's search key survives the injector, because the value is the only literal", () => {
  const payload = decodeURIComponent(show(path.join("pages", "gh-recent-branches.html"))
                                     .split("&text=")[1]);
  // Both halves of the pair are in the shell. Written whole, the injector would
  // rewrite the search key along with the value and the substitution would find
  // nothing; escaped, the key is invisible to a text replace.
  assert.strictEqual(payload.split(PLACEHOLDER).length - 1, 1,
    "the literal placeholder should appear exactly once, as the value slot");
  assert.ok(payload.includes("\\ud83c\\udf9f\\ufe0fGitHubToken"),
    "the search key should be \\u-escaped");
});

test("a page with no placeholder is handed no token", () => {
  const payload = decodeURIComponent(show(path.join("pages", "xhr-probe.html")).split("&text=")[1]);
  assert.ok(!page("xhr-probe.html").includes(PLACEHOLDER), "fixture check");
  assert.ok(!payload.includes(PLACEHOLDER),
    "carrying an unused placeholder would put the token in a page that has no use for it");
  assert.match(payload, /var S = \[\]/, "the substitution list should be empty");
});

test("a token-bearing page cannot be sent to a target that does not inject", () => {
  assert.throws(() => show(path.join("pages", "gh-recent-branches.html"), "--target", "Run-Html"),
    /Command failed/, "Run-Html has no injector, so the page would load unauthenticated");
  // The same page to Show-Html is fine, and so is a page that needs nothing.
  assert.ok(show(path.join("pages", "xhr-probe.html"), "--target", "Run-Html"));
});

// The reason compression is the default rather than a flag. The shell costs a
// fixed ~700 characters of link, so this is a claim about real pages, not an
// identity; it is here to fail if the shell ever grows past what it saves.
test("compressing beats sending the page raw, on every page in the repo", () => {
  for (const f of PAGES) {
    const gz = show(path.join("pages", f)), raw = show(path.join("pages", f), "--raw");
    assert.ok(gz.length < raw.length,
      `${f}: compressed ${gz.length} should be under raw ${raw.length}`);
  }
});

test("the same page always yields the same link", () => {
  const f = path.join("pages", "xhr-probe.html");
  assert.strictEqual(show(f), show(f), "gzip's header mtime must be zeroed");
});

test("--verify reads a link back rather than trusting it", () => {
  const link = show(path.join("pages", "gh-recent-branches.html"));
  const report = show(link, "--verify");
  assert.match(report, /target:\s+Show-Html/);
  assert.match(report, /form:\s+gz shell/);
  assert.match(report, new RegExp("carries: " + PLACEHOLDER));
  // Code points, not UTF-16 units: Python counts the page the way the report does.
  assert.match(report, new RegExp([...page("gh-recent-branches.html")].length + " chars of page"));
});

// The hazard pack.py documents is a shortened link that still looks right. Here
// the payload sits early in the shell, so a cut tail takes the code that
// inflates it and leaves the gzip stream readable; a cut in the middle takes
// the stream. Both have to be caught, and neither is caught by inflating alone.
test("a truncated link fails loudly, at either end", () => {
  const link = show(path.join("pages", "gh-recent-branches.html"));
  assert.throws(() => show(link.slice(0, -200), "--verify"), /Command failed/, "cut tail");
  const half = link.slice(0, Math.floor(link.length / 2)) + link.slice(-200);
  assert.throws(() => show(half, "--verify"), /Command failed/, "cut middle");
});

test("Run-Html builds the data URL the way js-data-url does", () => {
  const chain = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "run-html.json"), "utf8"));
  const [encode, url, open] = chain.actions;
  assert.deepStrictEqual(chain.actions.map(a => a.id), [
    "is.workflow.actions.base64encode", "is.workflow.actions.url", "is.workflow.actions.openurl"]);
  assert.strictEqual(encode.p.WFInput.Value.Type, "ExtensionInput",
    "the page arrives as Shortcut Input, not as another action's output");
  assert.strictEqual(url.p.WFURLActionURL.Value.string, "data:text/html;charset=utf-8;base64,￼");
  assert.strictEqual(url.p.WFURLActionURL.Value.attachmentsByRange["{36, 1}"].OutputUUID,
    encode.p.UUID);
  assert.strictEqual(open.p.WFInput.Value.OutputUUID, url.p.UUID);
});
