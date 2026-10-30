// tools/log.py — the session's half of the reader pair.
//
// pages/shortcut-log.html renders the same two facts for whoever tapped the
// link. Both read a device payload and both score it against the same build
// manifest, so what is checked here is that this half says what that half says:
// a run's structure over its base64, and a verdict that is silent when unknown.

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const py = (src) => execFileSync("python3", ["-c", src], { cwd: ROOT, encoding: "utf8" }).trim();

// A run's payload as the device writes it: one enormous base64 field beside the
// few small ones that answer anything.
const PAYLOAD = JSON.stringify({
  Base64: "eyJvcCI6ImltcG9ydCJ9".repeat(40),
  "File Size": 165, Type: "Text",
});
const RUN = `run name=Run-Pick build=b07361d chose=Get-FileInfo\n${PAYLOAD}`;

const render = (body, table) => py(
  `import sys,json; sys.path.insert(0,'tools'); import log;` +
  `print(log.render('2026-08-29-115055', json.loads(${JSON.stringify(JSON.stringify(body))}), ` +
  `json.loads(${JSON.stringify(JSON.stringify(table))})))`);

test("a run shows its structure rather than its base64", () => {
  const row = render(RUN, {});
  assert.match(row, /"File Size": 165/,
    "the small fields are what a row is read for");
  // Eliding decides WHAT is shown; the row cap decides how much. A plain
  // truncation at the same width shows base64 and nothing else.
  assert.match(row, /…\[\d+\]/, "a long string reports its length");
  assert.ok(!/eyJvcCI6ImltcG9ydCJ9eyJvcCI6ImltcG9ydCJ9eyJvcCI6ImltcG9ydCJ9/.test(row),
    "and does not spend the row on base64");
});

test("a row stays one line", () => {
  const row = render(RUN, {});
  assert.ok(!row.includes("\n"), "a row is one line");
  assert.ok(row.length <= 260, `row was ${row.length} chars`);
});

// The verdict: a logged build id says WHICH copy ran, and it takes the manifest
// to say whether that copy is current. That is the question the stamp exists
// for and cannot answer alone.
test("a run is scored against the build manifest", () => {
  assert.match(render(RUN, { "Run-Pick": "b07361d" }), /current/);
  const stale = render(RUN, { "Run-Pick": "ccb6cfc" });
  assert.match(stale, /stale→ccb6cfc/);
  assert.ok(!stale.includes("current"), "one verdict, not both");
});

test("an unknown build gets no verdict at all", () => {
  // Worse than no verdict: an unlooked-up answer reading as a good one.
  const row = render(RUN, {});
  assert.ok(!row.includes("current") && !row.includes("stale"), row);
  assert.match(row, /build=b07361d/, "and the row still renders");
});

test("the manifest this reads is the one plist.py publishes", () => {
  // Two derivations of one number is the $file defect over again.
  const table = JSON.parse(py("import sys,json; sys.path.insert(0,'tools');"
    + " import log; print(json.dumps(log.builds()))"));
  const onDisk = require(path.join(ROOT, "plists", "builds.json"));
  assert.deepStrictEqual(table, onDisk);
});

// --drift: the install rows a row-by-row reader cannot score. An import or
// replace row carries no build of what it installed, so the snag
// branch-install-outlived-the-merge went unseen for thirteen days: Route-Gesture
// was replaced from one merge, main then took a second branch's route, and no
// row said so. Every case below is scored offline: `files` stands in for
// shortcut-tools at a commit, so the suite needs no fetch.
const crypto = require("node:crypto");
const RAW = "https://raw.githubusercontent.com/mehrlander/shortcut-tools";
const A = "79bb270b7f964f38a2208e721e8b502f554a5897";
const B = "3c0d81efec57336aff5d0e4ba23444a232733001";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const drift = (rows, main, files) => JSON.parse(py(
  `import sys,json; sys.path.insert(0,'tools'); import log;` +
  `files=json.loads(${JSON.stringify(JSON.stringify(files))});` +
  `enc=lambda v: None if v is None else (v if isinstance(v, str) else json.dumps(v)).encode();` +
  `show=lambda sha, path: enc(files.get(sha, {}).get(path));` +
  `b,u,n=log.drift(json.loads(${JSON.stringify(JSON.stringify(rows))}), ` +
  `json.loads(${JSON.stringify(JSON.stringify(main))}), show);` +
  `print(json.dumps({"behind": b, "unscored": u, "never": n}))`));

// The log as it stood after 2026-09-20 08:45, newest first, and main after the
// merge that combined both routes.
const SNAG = [
  ["2026-09-20-084355", { op: "replace", name: "Route-Gesture", from: `${RAW}/${B}/plists/Route-Gesture.plist` }],
  ["2026-09-20-084327", { op: "fetch", name: "Triple-BackTap", build: "16b4f91", from: `${RAW}/${B}/signed/Triple-BackTap.shortcut` }],
  ["2026-09-19-192528", { op: "replace", name: "Route-Gesture", from: `${RAW}/${A}/plists/Route-Gesture.plist` }],
];
const SNAG_MAIN = { "Route-Gesture": "1646ecd", "Triple-BackTap": "2b155e9" };
const SNAG_FILES = {
  [A]: { "plists/builds.json": { "Route-Gesture": "2b74b4f" } },
  [B]: { "plists/builds.json": { "Route-Gesture": "945f3f9", "Triple-BackTap": "2b155e9" },
         "plists/Triple-BackTap.plist": "<plist/>",
         "signed/manifest.json": { "Triple-BackTap": { plist_sha256: sha256("<plist/>") } } },
};

test("drift reads an install's build off the commit it came from", () => {
  const got = drift(SNAG, SNAG_MAIN, SNAG_FILES);
  assert.deepStrictEqual(got.behind,
    [["Route-Gesture", "2026-09-20-084355", "replace", "945f3f9", "3c0d81e"]],
    "the newest install decides, and the older branch build is not reported");
  assert.deepStrictEqual(got.unscored, {}, "the fetch is scored: its signed copy is that commit's plist");
  assert.deepStrictEqual(got.never, []);
});

test("a fetch row's own build is Library-Fetch's, and a paste's is Library-Paste's", () => {
  // Scoring `build` for an install compared the installer's hash against the
  // installed chain's and called every paste stale; the kit says so too.
  const paste = (target) => [["2026-10-03-153036", { op: "paste", name: "Route-Gesture",
    from: `${RAW}/a67a58c744c9e0ee5b12317c362d93c1c7fe0a52/packed/route-gesture.json`,
    target, build: "f18efdb" }]];
  assert.deepStrictEqual(drift(paste("1646ecd"), { "Route-Gesture": "1646ecd" }, {}).behind, []);
  assert.deepStrictEqual(drift(paste("945f3f9"), { "Route-Gesture": "1646ecd" }, {}).behind,
    [["Route-Gesture", "2026-10-03-153036", "paste", "945f3f9", "a67a58c"]]);
});

test("a newer install that matches main clears an older one that does not", () => {
  const rows = [["2026-10-03-153036", { op: "paste", name: "Route-Gesture", target: "1646ecd",
    build: "f18efdb", from: `${RAW}/a67a58c744c9e0ee5b12317c362d93c1c7fe0a52/packed/route-gesture.json` }],
    ...SNAG];
  assert.deepStrictEqual(drift(rows, SNAG_MAIN, SNAG_FILES).behind, []);
});

test("an install no file ties to a build gets no verdict, current or behind", () => {
  // Silent when unknown: an unlooked-up answer must not read as a good one.
  const rows = [
    ["2026-09-16-174223", { op: "import", name: "Library-Replace", from: `${RAW}/main/plists/Library-Replace.plist` }],
    ["2026-08-26-225027", { op: "import", name: "Dictate", from: `${RAW}/${A}/plists/Dictate.plist` }],
    ["2026-08-30-204213", { op: "fetch", name: "Run-BackTap", build: "16b4f91", from: `${RAW}/${B}/signed/Run-BackTap.shortcut` }],
  ];
  const main = { "Library-Replace": "ec68fe9", Dictate: "ca646c0", "Run-BackTap": "ca97583", "Library-Stage": "43be0c3" };
  const files = { [A]: { "plists/builds.json": {} },
    [B]: { "plists/builds.json": { "Run-BackTap": "5898f84" }, "plists/Run-BackTap.plist": "<new/>",
           "signed/manifest.json": { "Run-BackTap": { plist_sha256: sha256("<old/>") } } } };
  const got = drift(rows, main, files);
  assert.deepStrictEqual(got.behind, [], "none of these is a verdict");
  assert.deepStrictEqual(got.unscored, {
    branch: ["Library-Replace"],   // main has moved since; its head today is not what was fetched
    unbuilt: ["Dictate"],          // a commit with no builds.json entry for the name
    signed: ["Run-BackTap"],       // signed from a plist that commit no longer holds
  });
  assert.deepStrictEqual(got.never, ["Library-Stage"], "a name no install row names is reported apart");
});

test("a paste row's ref is read like a plist's", () => {
  // build_of matched plists/ and signed/ only, so a paste row rendered no ref.
  const ref = py(`import sys; sys.path.insert(0,'tools'); import log;` +
    `print(log.build_of('${RAW}/a67a58c744c9e0ee5b12317c362d93c1c7fe0a52/packed/route-gesture.json'))`);
  assert.strictEqual(ref, "a67a58c");
});
