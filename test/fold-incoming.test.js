const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const tool = (...a) => spawnSync("python3", [path.join("tools", "fold-incoming.py"), ...a],
  { cwd: ROOT, encoding: "utf8" });

// A private checkout shaped like the real one: an index.json so the tool finds
// it, and whatever incoming/ holds. Nothing else is read in --check mode.
function fakePrivate(incomingNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wtp-"));
  fs.mkdirSync(path.join(dir, "shortcuts", "incoming"), { recursive: true });
  fs.writeFileSync(path.join(dir, "shortcuts", "index.json"), "[]");
  for (const n of incomingNames) fs.writeFileSync(path.join(dir, "shortcuts", "incoming", n), "==shortcut==\nX\n");
  return dir;
}

test("--check is quiet and green when incoming/ is empty", () => {
  const r = tool("--check", "--private", fakePrivate([]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /incoming\/ is empty/);
});

test("--check names every unfolded export and exits 1", () => {
  const r = tool("--check", "--private", fakePrivate(["2026-08-22-164102.txt", "2026-09-01-000000.txt"]));
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /2 file\(s\)/);
  assert.match(r.stderr, /2026-08-22-164102\.txt/);
  assert.match(r.stderr, /2026-09-01-000000\.txt/);
  assert.match(r.stderr, /fold-incoming\.py/, "the fix is printed, not described");
});

// The harvest flags used to live in README prose. With them in a file, the
// same output has to come out of --config as out of the flags, or the gate
// freshness.py runs over core/ is checking against a different pipeline.
test("harvest --config reproduces the same chains as the flags", () => {
  const priv = process.env.WEB_TOOLS_PRIVATE || path.join(ROOT, "..", "web-tools-private");
  const cfg = path.join(priv, "shortcuts", "core", "harvest.json");
  if (!fs.existsSync(cfg)) return;
  const dumps = fs.readdirSync(path.join(priv, "shortcuts", "dumps")).filter(f => f.endsWith(".zip"))
    .sort().map(f => path.join(priv, "shortcuts", "dumps", f));
  const index = path.join(priv, "shortcuts", "index.json");
  const c = JSON.parse(fs.readFileSync(cfg, "utf8"));
  const flags = [];
  for (const [o, n] of Object.entries(c.rename || {})) flags.push("--rename", `${o}=${n}`);
  for (const d of c.drop_call || []) flags.push("--drop-call", d);
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "hv-a-")), b = fs.mkdtempSync(path.join(os.tmpdir(), "hv-b-"));
  const run = (out, extra) => spawnSync("python3", [path.join("tools", "harvest.py"), ...dumps, "--index", index, ...extra, "-o", out],
    { cwd: ROOT, encoding: "utf8" });
  assert.strictEqual(run(a, ["--config", cfg]).status, 0);
  assert.strictEqual(run(b, flags).status, 0);
  const la = fs.readdirSync(a).sort(), lb = fs.readdirSync(b).sort();
  assert.deepStrictEqual(la, lb);
  for (const f of la) assert.strictEqual(fs.readFileSync(path.join(a, f), "utf8"), fs.readFileSync(path.join(b, f), "utf8"), f);
});
