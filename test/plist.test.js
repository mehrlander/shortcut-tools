const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const plib = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const run = (...a) => plib.execFileSync("python3", [path.join("tools", "plist.py"), ...a],
  { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const named = () => fs.readdirSync(path.join(ROOT, "workflows"))
  .filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", f), "utf8")))
  .filter(c => c.name);

test("plists/ holds a file for every named chain, and nothing else", () => {
  const want = new Set(named().map(c => c.name + ".plist"));
  const have = new Set(fs.readdirSync(path.join(ROOT, "plists")).filter(f => f.endsWith(".plist")));
  assert.deepStrictEqual([...have].sort(), [...want].sort(),
    "plists/ is receivers only: a chain opts in by declaring a name");
});

// A stale plist serves an install that works and delivers the wrong shortcut,
// which is the same failure packed/ is guarded against.
test("plists/ is current with workflows/", () => {
  assert.doesNotThrow(() => run("--check"));
});

test("a shortcut reading Shortcut Input says so in the file", () => {
  // The mismatch that makes an imported shortcut look broken for no visible
  // reason: the chain reads ExtensionInput, the envelope claims it does not.
  const src = fs.readFileSync(path.join(ROOT, "plists", "Log-Repo.plist"), "utf8");
  assert.match(src, /<key>WFWorkflowHasShortcutInputVariables<\/key>\s*<true\/>/);
});

test("file-level settings only a plist can carry survive the build", () => {
  const src = fs.readFileSync(path.join(ROOT, "plists", "Capture-Link.plist"), "utf8");
  assert.match(src, /ActionExtension/, "Show in Share Sheet is a WFWorkflowTypes entry");
  assert.match(src, /WFSafariWebPageContentItem/, "and the accepted input classes ride with it");
  // No paste reaches either, which is the whole reason this generator exists.
  const packed = fs.readFileSync(path.join(ROOT, "packed", "capture-link.json"), "utf8");
  assert.ok(!packed.includes("ActionExtension"),
    "the packed form carries actions only, by construction");
});

test("two chains claiming one name fail loudly rather than overwriting", () => {
  // In a temp directory, not workflows/: two chains claiming one name are
  // exactly what every other test globbing that directory must never see.
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "plist-"));
  const chain = { name: "Dupe-Probe", label: "x", actions: [{ id: "is.workflow.actions.comment", p: {} }] };
  fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify(chain));
  fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify(chain));
  try {
    assert.throws(() => run("--publish", "--workflows", dir), /both name themselves/);
    // And it fails clean. A one-pass publish wrote the first claimant before
    // noticing the second, leaving a plist no chain regenerates; one such file
    // sat in plists/ across two pull requests, failing the check above.
    assert.ok(!fs.existsSync(path.join(ROOT, "plists", "Dupe-Probe.plist")),
      "a refused publish must not leave a partial write behind");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The receivers-only assertion at the top of this file caught an orphan; the
// tool's own --check did not, and reported the same tree current. A withdrawn
// receiver therefore kept serving an install link that worked and delivered
// something the repo had retracted. Both gates now say the same thing.
//
// In a temp pair, for the reason the duplicate-name probe above gives: an
// orphan visible in the real plists/ is precisely what that first assertion
// would trip over.
test("a plist no chain claims is reported by --check and removed by --publish", () => {
  const os = require("node:os");
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "plist-src-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "plist-out-"));
  try {
    fs.writeFileSync(path.join(src, "kept.json"), JSON.stringify(
      { name: "Kept-Probe", label: "x", actions: [{ id: "is.workflow.actions.comment", p: {} }] }));
    run("--publish", "--workflows", src, "--out", out);
    fs.writeFileSync(path.join(out, "Withdrawn-Probe.plist"), "not a plist");

    assert.throws(() => run("--check", "--workflows", src, "--out", out),
      /Withdrawn-Probe\.plist \(no chain claims it\)/,
      "--check must name the orphan as unclaimed, not as stale");

    run("--publish", "--workflows", src, "--out", out);
    // builds.json rides along: a paired publish writes the whole-set manifest
    // beside the plists, and the prune globs *.plist so it survives.
    assert.deepStrictEqual(fs.readdirSync(out).sort(), ["Kept-Probe.plist", "builds.json"]);
    assert.doesNotThrow(() => run("--check", "--workflows", src, "--out", out));
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

// The prune can delete, so the case that must hold is the one the duplicate
// probe already exercises: --workflows alone aims a foreign chain set at the
// real plists/, where deleting everything unclaimed would take all 21.
test("--workflows without --out never prunes, since the pair is not matched", () => {
  const os = require("node:os");
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "plist-foreign-"));
  const before = fs.readdirSync(path.join(ROOT, "plists")).sort();
  try {
    fs.writeFileSync(path.join(src, "lone.json"), JSON.stringify(
      { name: "Lone-Probe", label: "x", actions: [{ id: "is.workflow.actions.comment", p: {} }] }));
    run("--publish", "--workflows", src);
    assert.deepStrictEqual(
      fs.readdirSync(path.join(ROOT, "plists")).filter(f => f !== "Lone-Probe.plist").sort(),
      before, "a foreign chain set must not take the real receiver mirror with it");
  } finally {
    fs.rmSync(path.join(ROOT, "plists", "Lone-Probe.plist"), { force: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test("--link emits the install link rather than leaving it to be typed", () => {
  // Same failure --url fixed for the paste route: the form was documented and
  // nothing emitted it, so it was retyped on every install.
  const out = run("workflows/sync-manifest.json", "--link", "--ref", "some/branch").trim();
  assert.match(out, /^shortcuts:\/\/run-shortcut\?name=Library-Import&input=text&text=/);
  const payload = decodeURIComponent(out.split("&text=")[1]);
  const [name, url] = payload.split("\n");
  assert.equal(name, "Sync-Manifest", "Library-Import reads the name from line one");
  assert.equal(url, "https://raw.githubusercontent.com/mehrlander/shortcut-tools/" +
                    "some/branch/plists/Sync-Manifest.plist");
});

test("--link refuses a chain that declares no name", () => {
  // A chain without a name has no plist, so the link would 404 on tap.
  assert.throws(() => run("workflows/menu.json", "--link"), /declares no name/);
});

test("no plist ships an unresolved $file directive", () => {
  // The bug this replaces cost a day of wrong conclusions. pack.py resolved
  // {"$file": path} and plist.py did not, so a chain carrying a page packed
  // correctly and installed as a shortcut whose Text action held the literal
  // dictionary. Nothing errored anywhere: the shortcut imported, ran, and
  // returned an empty string, which was read as evidence about the rich-text
  // coercion rather than as a missing page.
  //
  // Checked on the parsed plist, not the text, because a chain may legitimately
  // mention "$file" in a comment and Probe-Coercion does.
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, "plists")).filter(n => n.endsWith(".plist"))) {
    const xml = fs.readFileSync(path.join(ROOT, "plists", f), "utf8");
    if (/<key>\$file<\/key>/.test(xml)) bad.push(f);
  }
  assert.deepStrictEqual(bad, [],
    "these carry a literal {$file: path} where the file's text belongs; " +
    "regenerate with: python3 tools/plist.py --publish");
});

test("#BUILD# resolves in both mirrors, and anchor offsets survive it", () => {
  // The recurring waste was not knowing whether the copy that RAN is the copy
  // just pushed: an install logs the ref it came from, a run had no way to say,
  // so a stale copy and a fresh failure looked identical. The token is the same
  // width as the id it becomes, so every U+FFFC offset beside it stays valid.
  const chain = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "run-pick.json"), "utf8"));
  const card = chain.actions.find(a => {
    const t = a.p && a.p.WFTextActionText;
    return t && t.Value && String(t.Value.string).startsWith("run name=");
  });
  assert.ok(card, "run-pick must report its run");
  assert.match(card.p.WFTextActionText.Value.string, /build=#BUILD#/);
  // A header line, then the raw result. The first cut was JSON with the result
  // interpolated into it and the result carried quotes, so the object never
  // parsed and the reader showed it as untyped text.
  assert.match(card.p.WFTextActionText.Value.string, /^run name=\S+ build=#BUILD# chose=/);

  const xml = fs.readFileSync(path.join(ROOT, "plists", "Run-Pick.plist"), "utf8");
  assert.doesNotMatch(xml, /#BUILD#/, "the plist mirror must substitute it");
  // The packed mirror base64s each action, so decode before looking.
  const packed = JSON.parse(fs.readFileSync(path.join(ROOT, "packed", "run-pick.json"), "utf8"));
  const decoded = packed.actions.map(a => Buffer.from(a, "base64").toString("utf8")).join("");
  assert.doesNotMatch(decoded, /#BUILD#/, "the packed mirror must substitute it too; " +
    "a directive one mirror resolves and the other does not is the $file defect again");

  const stamped = /build=([0-9a-f]{7})/.exec(xml);
  assert.ok(stamped, "the plist carries a 7-char build id");
  assert.ok(decoded.includes(stamped[1]),
    `both mirrors must carry the SAME id; plist has ${stamped[1]}`);
});

test("run-pick puts the clipboard back after logging", () => {
  // Log-Repo writes its payload to the clipboard first and unconditionally, so
  // without this the next run reads the log line instead of the user's text: a
  // tool poisoning its own input. Caught by the first run that actually logged.
  const chain = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "run-pick.json"), "utf8"));
  const ids = chain.actions.map(a => a.id);
  const clip = ids.indexOf("is.workflow.actions.getclipboard");
  // The Log-Repo call specifically, not the last Run Shortcut: the chain ends by
  // calling Show-Log, so lastIndexOf finds the wrong one.
  const logged = chain.actions.findIndex(a => (a.p || {}).WFWorkflowName === "Log-Repo");
  const restore = ids.lastIndexOf("is.workflow.actions.setclipboard");
  assert.ok(clip >= 0 && logged > clip, "it reads the clipboard, then logs");
  assert.ok(restore > logged, "and puts the clipboard back after logging, not before");
  const back = chain.actions[restore].p.WFInput.Value;
  assert.strictEqual(back.OutputUUID, chain.actions[clip].p.UUID,
    "restoring the value Get Clipboard captured, not something else");
});

test("run-pick ends by opening the log, not by clipping it into Show Result", () => {
  // Show Result renders a long payload as a few lines that do not scroll, so the
  // useful half of a run was legible to the session reading git and not to the
  // person who ran it. Show-Log is the same log, on the device, scrollable.
  const chain = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "run-pick.json"), "utf8"));
  const last = chain.actions[chain.actions.length - 1];
  assert.strictEqual(last.id, "is.workflow.actions.runworkflow");
  assert.strictEqual(last.p.WFWorkflowName, "Show-Log");
  assert.ok(!chain.actions.some(a => a.id === "is.workflow.actions.showresult"),
    "Show Result is what this replaces");
});

test("show-log takes a hosted URL, never HTML text", () => {
  // Show Web View accepts either, and the difference decides whether it works:
  // HTML text lands at a file:// origin, a different storage partition, where
  // localStorage.ghToken is not, and the page needs it to read a private repo.
  const chain = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "show-log.json"), "utf8"));
  const web = chain.actions.find(a => a.id === "is.workflow.actions.showwebpage");
  assert.ok(web, "it shows a web page");
  assert.strictEqual(typeof web.p.WFURL, "string", "a plain https string, not a rich-text payload");
  assert.match(web.p.WFURL, /^https:\/\/mehrlander\.github\.io\/web-tools\/pages\/shortcut-log\.html$/);
});

// WHAT THE MANIFEST IS FOR. A chain stamps its own build id and a run logs it,
// which says which copy ran and not whether that copy is current. Answering
// the second took a checkout and a hand-run hash; plists/builds.json publishes
// name -> id so a reader with no checkout compares the two directly.
test("builds.json names every installable chain with its build id", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "plists", "builds.json"), "utf8"));
  const named = fs.readdirSync(path.join(ROOT, "workflows"))
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", f), "utf8")).name)
    .filter(Boolean).sort();
  assert.deepStrictEqual(Object.keys(manifest).sort(), named,
    "the manifest is the installable set, exactly");
  for (const [name, id] of Object.entries(manifest))
    assert.match(id, /^[0-9a-f]{7}$/, `${name} must carry a short content hash`);
  // The id a chain stamps into itself and the id published for it are one
  // value. Two derivations of one number is the $file defect over again.
  const stamped = require("node:child_process")
    .execSync("python3 -c \"import sys,json;sys.path.insert(0,'tools');"
            + "from pack import build_id;"
            + "print(build_id(json.load(open('workflows/run-pick.json'))))\"",
              { cwd: ROOT, encoding: "utf8" }).trim();
  assert.equal(manifest["Run-Pick"], stamped);
});

// The doctrine this file already states, now held: an unpaired --workflows
// aims a foreign chain set at the real plists/. The prune is gated on that,
// and the manifest is whole-set too, so it must be gated the same way. It was
// not, and a two-row probe set briefly replaced the real manifest.
test("an unpaired publish leaves the real builds.json alone", () => {
  const before = fs.readFileSync(path.join(ROOT, "plists", "builds.json"), "utf8");
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "plist-unpaired-"));
  try {
    fs.writeFileSync(path.join(dir, "solo.json"), JSON.stringify(
      { name: "Solo-Probe", label: "x", actions: [{ id: "is.workflow.actions.comment", p: {} }] }));
    run("--publish", "--workflows", dir);
    assert.equal(fs.readFileSync(path.join(ROOT, "plists", "builds.json"), "utf8"), before,
      "a foreign chain set must not rewrite the real manifest");
  } finally {
    fs.rmSync(path.join(ROOT, "plists", "Solo-Probe.plist"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// THE NOTICE IS THE THING EVERY CHAIN SHOWS. Log-Repo ended in a Show Result of
// the GitHub API's whole PUT response, which Shortcuts clips to a few lines and
// will not scroll, so the one screen a run always produces said nothing a person
// could read. It now names the entry it wrote and the name the server confirmed,
// which is short enough to fit and specific enough to check against Show-Log.
test("Log-Repo's notice reads the entry, not the API response", () => {
  const chain = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "log-repo.json"), "utf8"));
  const uuid = (id) => chain.actions.find(a => a.id.endsWith(id)).p.UUID;
  const put = uuid("downloadurl");
  const notice = chain.actions.find(a => a.id.endsWith("showresult"));

  const refs = Object.values(notice.p.Text.Value.attachmentsByRange).map(a => a.OutputUUID);
  assert.ok(!refs.includes(put),
    "the raw PUT response is what made this notice unreadable");
  assert.equal(refs.length, 2, "what was written, and what the server confirmed");
  assert.ok(refs.includes(uuid("format.date")), "the stem is known before the PUT");

  // Absence has to be legible: on a failed PUT there is no content.name, so the
  // confirmation renders empty beside a stem that is always present. A notice
  // that claimed success either way would be worse than the wall of JSON.
  assert.match(notice.p.Text.Value.string, /^Logged ￼\nConfirmed: ￼$/);

  // Every anchor offset must land on its own U+FFFC, or the attachments bind to
  // the wrong characters and the notice silently renders the wrong values.
  for (const [range, a] of Object.entries(notice.p.Text.Value.attachmentsByRange)) {
    const i = Number(range.match(/^\{(\d+), 1\}$/)[1]);
    assert.equal(notice.p.Text.Value.string[i], "￼",
      `${a.OutputName} anchors at ${i}, which is not a placeholder`);
  }
});

// The viewer cannot live inside Log-Repo: probe-coercion calls it five times, so
// a web view there would be five sheets. It stays one card in Show-Log, which a
// chain calls once at the end when it wants the rich view.
test("Log-Repo shows a sheet nowhere, whatever it is called from", () => {
  const chain = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "log-repo.json"), "utf8"));
  assert.ok(!chain.actions.some(a => a.id.endsWith("showwebpage")),
    "a logger called N times must not open N sheets");
});
