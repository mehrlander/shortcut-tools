const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const PAGE = path.join(__dirname, "..", "pages", "gh-recent-branches.html");

// The page runs on device inside a data: URL, where nothing can be inspected.
// So the logic is exercised here against a fixture instead: what gets filtered,
// how it sorts, and the exact line shape the shortcut's Replace Text depends on.
function load(response) {
  const html = fs.readFileSync(PAGE, "utf8");
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const out = { textContent: "" };
  const ctx = {
    document: { body: { className: "" }, getElementById: () => out },
    XMLHttpRequest: function () {
      this.open = () => {};
      this.setRequestHeader = () => {};
      this.send = () => { this.status = response.status || 200;
                          this.responseText = JSON.stringify(response.body); };
    },
    Date, JSON, Math, Error, out
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return ctx;
}

const NOW = Date.now();
const iso = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();
const commit = (login, minsAgo) => ({ committedDate: iso(minsAgo), author: { user: { login } } });

function fixture(repos) {
  return { body: { data: { viewer: { login: "mehrlander", repositories: { nodes: repos } } } } };
}

test("the page waits in ask mode until the token placeholder is substituted", () => {
  const ctx = load(fixture([]));
  assert.strictEqual(ctx.document.body.className, "ask");
});

test("the sentinel survives a substitution that rewrites every placeholder", () => {
  // Replace Text swaps all occurrences, so a literal comparison string would be
  // rewritten too and the page would run with the sentinel as its token.
  const html = fs.readFileSync(PAGE, "utf8");
  const substituted = html.split("__GH_TOKEN__").join("ghp_realtoken");
  assert.ok(substituted.includes("'__GH' + '_TOKEN__'"),
    "the sentinel must be assembled from halves so substitution cannot reach it");
  assert.strictEqual(substituted.match(/ghp_realtoken/g).length, 1,
    "exactly one placeholder should exist to substitute");
});

test("branches sort newest first across repositories, not within them", () => {
  const ctx = load(fixture([
    { nameWithOwner: "mehrlander/home",
      refs: { nodes: [{ name: "main", target: commit("mehrlander", 600) }] } },
    { nameWithOwner: "mehrlander/web-tools",
      refs: { nodes: [{ name: "claude/a", target: commit("mehrlander", 30) },
                      { name: "claude/b", target: commit("mehrlander", 2000) }] } }
  ]));
  ctx.run("tok");
  assert.deepStrictEqual(ctx.out.textContent.split("\n"), [
    "mehrlander/web-tools@claude/a · 30m",
    "mehrlander/home@main · 10h",
    "mehrlander/web-tools@claude/b · 1d"
  ]);
});

test("a branch whose tip is someone else's is dropped", () => {
  const ctx = load(fixture([
    { nameWithOwner: "o/r", refs: { nodes: [
      { name: "mine", target: commit("mehrlander", 10) },
      { name: "theirs", target: commit("someone-else", 5) }
    ] } }
  ]));
  ctx.run("tok");
  assert.strictEqual(ctx.out.textContent, "o/r@mine · 10m");
});

test("an unlinked commit author is dropped rather than throwing", () => {
  const ctx = load(fixture([
    { nameWithOwner: "o/r", refs: { nodes: [
      { name: "orphan", target: { committedDate: iso(5), author: { user: null } } },
      { name: "empty", target: null },
      { name: "mine", target: commit("mehrlander", 10) }
    ] } }
  ]));
  ctx.run("tok");
  assert.strictEqual(ctx.out.textContent, "o/r@mine · 10m");
});

test("the line shape is what the shortcut's regex strips back to an address", () => {
  const ctx = load(fixture([
    { nameWithOwner: "mehrlander/web-tools",
      refs: { nodes: [{ name: "claude/x-1", target: commit("mehrlander", 90) }] } }
  ]));
  ctx.run("tok");
  const line = ctx.out.textContent;
  assert.match(line, / · \d+[mhd]|mo$/);
  assert.strictEqual(line.replace(/ · .*$/, ""), "mehrlander/web-tools@claude/x-1");
});

test("no matches says so instead of returning an empty result", () => {
  const ctx = load(fixture([]));
  ctx.run("tok");
  assert.match(ctx.out.textContent, /^No branches found/);
});

test("a GraphQL error surfaces as text, since the coercion returns text or nothing", () => {
  const ctx = load({ body: { errors: [{ message: "Bad credentials" }] } });
  ctx.run("tok");
  assert.strictEqual(ctx.out.textContent, "ERROR Bad credentials");
});

test("a non-200 surfaces its status", () => {
  const ctx = load({ status: 401, body: { message: "Unauthorized" } });
  ctx.run("tok");
  assert.match(ctx.out.textContent, /^ERROR HTTP 401/);
});

test("the request is synchronous, which is the whole reason it is an XHR", () => {
  const html = fs.readFileSync(PAGE, "utf8");
  assert.match(html, /\.open\('POST', 'https:\/\/api\.github\.com\/graphql', false\)/);
});
