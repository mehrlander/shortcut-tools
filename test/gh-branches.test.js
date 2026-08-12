const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const PAGE = path.join(__dirname, "..", "pages", "gh-recent-branches.html");
const PLACEHOLDER = "🎟️GitHubToken";

// The page runs on device inside a data: URL or a Show-Html webview, where
// nothing can be inspected. So the logic is exercised here against a fixture:
// what gets filtered, how it sorts, the line shape the picker's regex depends
// on, and the href each row carries.
function load(response) {
  const html = fs.readFileSync(PAGE, "utf8");
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const out = {
    _t: "", children: [],
    get textContent() { return this._t; },
    set textContent(v) { this._t = v; this.children.length = 0; },
    appendChild(el) { this.children.push(el); }
  };
  const sent = [];
  // Distinct elements per id: the page wires the form's link by id, and a
  // harness returning #out for everything would hide that it did.
  const byId = { out };
  const ctx = {
    document: {
      body: { className: "" },
      getElementById: (id) => (byId[id] = byId[id] || { textContent: "", href: "" }),
      createElement: () => ({ textContent: "", href: "" }),
      createTextNode: (t) => ({ textContent: t, text: true })
    },
    XMLHttpRequest: function () {
      this.open = () => {};
      this.setRequestHeader = (k, v) => sent.push([k, v]);
      this.send = () => { this.status = response.status || 200;
                          this.responseText = JSON.stringify(response.body); };
    },
    Date, JSON, Math, Error, RegExp, out, sent, byId
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  // Join with nothing: the newlines are text nodes in the list, exactly as
  // they are in the DOM, so this reads the way a raw textContent read would.
  ctx.lines = () => out.children.length
    ? out.children.map(c => c.textContent).join("")
    : out.textContent;
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
  // Inject-🎟️GitHubToken swaps all occurrences, so a literal comparison string
  // would be rewritten too and the page would run with the sentinel as a token.
  const html = fs.readFileSync(PAGE, "utf8");
  const substituted = html.split(PLACEHOLDER).join("Bearer ghp_real");
  assert.ok(substituted.includes("'🎟️' + 'GitHubToken'"),
    "the sentinel must be assembled from halves so substitution cannot reach it");
  assert.strictEqual(substituted.match(/Bearer ghp_real/g).length, 1,
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
  assert.deepStrictEqual(ctx.lines().split("\n"), [
    "mehrlander/web-tools@claude/a · 30m",
    "mehrlander/home@main · 10h",
    "mehrlander/web-tools@claude/b · 1d"
  ]);
});

test("each row links to the branch page for its own address", () => {
  const ctx = load(fixture([
    { nameWithOwner: "mehrlander/web-tools",
      refs: { nodes: [{ name: "claude/x-1", target: commit("mehrlander", 90) }] } }
  ]));
  ctx.run("tok");
  assert.strictEqual(ctx.out.children.find(c => c.href).href,
    "https://mehrlander.github.io/web-tools/pages/branch.html#gh=mehrlander/web-tools@claude/x-1");
});

test("nothing but the rows is rendered, since a text coercion reads all of it", () => {
  const ctx = load(fixture([
    { nameWithOwner: "o/r", refs: { nodes: [
      { name: "a", target: commit("mehrlander", 5) },
      { name: "b", target: commit("mehrlander", 9) }] } }
  ]));
  ctx.run("tok");
  assert.strictEqual(ctx.out.children.filter(c => !c.text).length, 2);
  assert.strictEqual(ctx.out.textContent, "", "no stray text beside the rows");
});

test("a branch whose tip is someone else's is dropped", () => {
  const ctx = load(fixture([
    { nameWithOwner: "o/r", refs: { nodes: [
      { name: "mine", target: commit("mehrlander", 10) },
      { name: "theirs", target: commit("someone-else", 5) }
    ] } }
  ]));
  ctx.run("tok");
  assert.strictEqual(ctx.lines(), "o/r@mine · 10m");
});

// The branch this page was written on was missing from it, because the session
// that wrote it commits as the `claude` account rather than as the viewer.
test("a branch an agent pushed for you is kept, since it is still your branch", () => {
  const ctx = load(fixture([
    { nameWithOwner: "o/r", refs: { nodes: [
      { name: "agent", target: commit("claude", 3) },
      { name: "mine", target: commit("mehrlander", 10) },
      { name: "theirs", target: commit("someone-else", 5) }
    ] } }
  ]));
  ctx.run("tok");
  assert.strictEqual(ctx.lines(), "o/r@agent · 3m\no/r@mine · 10m",
    "the agent branch sorts by its own date, and a stranger's is still dropped");
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
  assert.strictEqual(ctx.lines(), "o/r@mine · 10m");
});

test("the line shape is what the picker's regex strips back to an address", () => {
  const ctx = load(fixture([
    { nameWithOwner: "mehrlander/web-tools",
      refs: { nodes: [{ name: "claude/x-1", target: commit("mehrlander", 90) }] } }
  ]));
  ctx.run("tok");
  assert.strictEqual(ctx.lines().replace(/ · .*$/, ""), "mehrlander/web-tools@claude/x-1");
});

test("a stored value carrying its own scheme is not given a second one", () => {
  const ctx = load(fixture([]));
  ctx.run("Bearer ghp_abc");
  assert.deepStrictEqual(ctx.sent.find(([k]) => k === "Authorization"),
    ["Authorization", "Bearer ghp_abc"]);
});

test("a bare stored value gets a scheme, so config.json's exact contents are not load-bearing", () => {
  const ctx = load(fixture([]));
  ctx.run("ghp_abc");
  assert.deepStrictEqual(ctx.sent.find(([k]) => k === "Authorization"),
    ["Authorization", "Bearer ghp_abc"]);
});

test("no matches says so instead of returning an empty result", () => {
  const ctx = load(fixture([]));
  ctx.run("tok");
  assert.match(ctx.lines(), /^No branches found/);
});

// The fixture message used to be "Bad credentials", which now means something
// specific; the claim under test is that any GraphQL error comes back as text
// rather than throwing, so an ordinary one carries it.
test("a GraphQL error surfaces as text, since the coercion returns text or nothing", () => {
  const ctx = load({ body: { errors: [{ message: "Something went wrong" }] } });
  ctx.run("tok");
  assert.strictEqual(ctx.lines(), "ERROR Something went wrong");
});

test("a non-200 surfaces its status", () => {
  const ctx = load({ status: 401, body: { message: "Unauthorized" } });
  ctx.run("tok");
  assert.match(ctx.lines(), /^ERROR HTTP 401/);
});

// An expired token is the one failure with a single obvious fix, and reading a
// status code off a phone is not it.
const TOKEN_PAGE = /^https:\/\/github\.com\/settings\/tokens\/new\?scopes=repo/;

test("an expired token offers the page that makes a new one", () => {
  const ctx = load({ status: 401, body: { message: "Bad credentials" } });
  ctx.run("tok");
  const link = ctx.out.children.find(c => c.href);
  assert.ok(link, "the error should carry a link, not only a status");
  assert.match(link.href, TOKEN_PAGE, "prefilled with the scope the page needs");
  assert.match(ctx.lines(), /^ERROR HTTP 401/, "and still say what happened");
});

test("the form comes back with it, so a fresh token can be pasted in place", () => {
  const ctx = load({ status: 401, body: { message: "Bad credentials" } });
  ctx.run("tok");
  assert.strictEqual(ctx.document.body.className, "ask");
});

test("the link names the config key without spelling the placeholder", () => {
  const ctx = load({ status: 401, body: { message: "Bad credentials" } });
  ctx.run("tok");
  assert.ok(ctx.lines().includes(PLACEHOLDER),
    "the key is what the next run reads, so the message has to name it");
  assert.ok(!ctx.out.children.find(c => c.href).textContent.includes(PLACEHOLDER),
    "but not inside the link, which stays short enough to sit on one phone line");
  // Spelled whole in the source, the injector would paste the live token here.
  assert.strictEqual(fs.readFileSync(PAGE, "utf8").split(PLACEHOLDER).length - 1, 1);
});

test("a credential failure inside a 200 is caught too", () => {
  // A fine-grained token that has lost access to a resource answers this way
  // rather than with a 401, so the status alone is not enough.
  const ctx = load({ body: { errors: [{ message: "Bad credentials" }] } });
  ctx.run("tok");
  assert.ok(ctx.out.children.find(c => c.href), "the message should be enough on its own");
});

test("an ordinary failure is not dressed up as an expired token", () => {
  const ctx = load({ status: 502, body: { message: "Bad gateway" } });
  ctx.run("tok");
  assert.ok(!ctx.out.children.find(c => c.href), "nothing to mint here");
  assert.strictEqual(ctx.document.body.className, "", "and no form to fill in");
});

test("the form's own link is wired from the script, not a second copy of the URL", () => {
  const ctx = load(fixture([]));
  assert.match(ctx.byId.mint.href, TOKEN_PAGE);
});

test("the request is synchronous, which is the whole reason it is an XHR", () => {
  const html = fs.readFileSync(PAGE, "utf8");
  assert.match(html, /\.open\('POST', 'https:\/\/api\.github\.com\/graphql', false\)/);
});

const chain = (f) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "workflows", f), "utf8"));

test("the picker calls the injector itself, since nothing else in that chain will", () => {
  const inject = chain("gh-recent-branches-picker.json")
    .actions.find(a => a.p.WFWorkflowName === "Inject-" + PLACEHOLDER);
  assert.ok(inject, "the picker should call the injector");
});

// The WFWorkflow dict carries a workflowIdentifier minted per install, which
// pinned every chain here to one device. run-by-name showed the name alone
// resolves, so carrying it is not portability-neutral, it is the opposite.
test("no chain pins a target by device-local identifier", () => {
  for (const f of fs.readdirSync(path.join(__dirname, "..", "workflows")).filter(f => f.endsWith(".json"))) {
    for (const a of chain(f).actions) {
      if (a.id !== "is.workflow.actions.runworkflow") continue;
      assert.ok(a.p.WFWorkflowName, f + ": a target needs a name");
      assert.ok(!a.p.WFWorkflow, f + ": WFWorkflow pins this chain to one install");
    }
  }
});

test("the Show-Html chain does not inject, because Show-Html already does", () => {
  // Injecting first is harmless, since the second pass finds no placeholder to
  // replace. It is still an action that does nothing, and the reason it does
  // nothing is not visible from this chain.
  const actions = chain("gh-recent-branches.json").actions;
  assert.strictEqual(actions.length, 2);
  assert.ok(!actions.some(a => a.p.WFWorkflowName === "Inject-" + PLACEHOLDER),
    "Show-Html substitutes the placeholder on the way through");
  assert.strictEqual(actions[1].p.WFWorkflowName, "Show-Html");
});

test("the page still carries the placeholder, since Show-Html is what resolves it", () => {
  const html = fs.readFileSync(PAGE, "utf8");
  assert.ok(html.includes(PLACEHOLDER));
});

test("the picker opens its URL the way the exports do it", () => {
  // Open URLs takes an attachment referencing a url action, which references a
  // text action. Handing it a bare string skips the coercion the export shows.
  const a = chain("gh-recent-branches-picker.json").actions.slice(-3);
  assert.deepStrictEqual(a.map(x => x.id), [
    "is.workflow.actions.gettext", "is.workflow.actions.url", "is.workflow.actions.openurl"]);
  assert.strictEqual(a[1].p.WFURLActionURL.Value.OutputUUID, a[0].p.UUID);
  assert.strictEqual(a[2].p.WFInput.Value.OutputUUID, a[1].p.UUID);
  assert.strictEqual(a[1].p.WFURLActionURL.WFSerializationType, "WFTextTokenAttachment");
});

// Every chain, not a named few: an anchor is written by hand, the offset is
// counted by hand, and a new chain is exactly where that goes wrong.
test("every anchor offset lands on the glyph it addresses", () => {
  const dir = path.join(__dirname, "..", "workflows");
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
    for (const action of chain(f).actions) {
      for (const v of Object.values(action.p)) {
        if (v && v.WFSerializationType !== "WFTextTokenString") continue;
        if (!v || !v.Value || !v.Value.attachmentsByRange) continue;
        for (const range of Object.keys(v.Value.attachmentsByRange)) {
          const at = Number(range.replace(/[{}]/g, "").split(",")[0]);
          assert.strictEqual(v.Value.string[at], "\uFFFC",
            `${f} ${action.id}: anchor ${range} misses the glyph`);
        }
      }
    }
  }
});
