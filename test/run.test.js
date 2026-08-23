const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

const run = (...args) =>
  execFileSync("python3", [path.join("tools", "run.py"), ...args],
               { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// The markdown handover goes to stderr, so capture that stream on its own.
const handover = (...args) => {
  const r = require("node:child_process").spawnSync(
    "python3", [path.join("tools", "run.py"), ...args],
    { cwd: ROOT, encoding: "utf8" });
  return r.stderr.trim();
};

const fails = (...args) => {
  try {
    execFileSync("python3", [path.join("tools", "run.py"), ...args],
                 { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return (e.stderr || "") + (e.stdout || "");
  }
  assert.fail(`expected run.py ${args.join(" ")} to fail`);
};

const text = (link) => decodeURIComponent((link.split("&text=")[1] ?? ""));
const name = (link) => decodeURIComponent(link.split("name=")[1].split("&")[0]);

test("one target with no input carries no text parameter", () => {
  const link = run("Get-FromJs");
  assert.strictEqual(link, "shortcuts://run-shortcut?name=Get-FromJs");
  // An empty text= is a value, and the diagnostics branch on "no value".
  assert.ok(!link.includes("text="));
});

test("one target bakes its input in rather than asking for one", () => {
  const link = run("Show-Loop", "--text", "hello world");
  assert.strictEqual(name(link), "Show-Loop");
  assert.strictEqual(text(link), "hello world");
});

test("--log appends Log-Repo through Run-Steps so the result returns itself", () => {
  const link = run("Get-FromJs", "--log");
  assert.strictEqual(name(link), "Run-Steps");
  assert.deepStrictEqual(text(link).split("\n"), ["Get-FromJs", "Log-Repo"]);
});

test("several targets pipe in the order given", () => {
  const link = run("Get-FileInfo", "Show-Table", "--log");
  assert.deepStrictEqual(text(link).split("\n"),
                         ["Get-FileInfo", "Show-Table", "Log-Repo"]);
});

test("a multi-step link refuses a baked input instead of dropping it", () => {
  // Run-Steps consumes its input as the step list, so a payload has no slot.
  assert.match(fails("A", "B", "--text", "x"), /takes the step list/);
});

test("a newline in a name is refused, since it would forge a step", () => {
  assert.match(fails("A\nLog-Repo"), /cannot contain a newline/);
});

test("verify reads back the exact link that would be sent", () => {
  const out = run("--verify", run("Get-FromJs", "--log"));
  assert.match(out, /receiver: Run-Steps/);
  assert.match(out, /1\. Get-FromJs/);
  assert.match(out, /2\. Log-Repo/);
});

test("naming nothing is an error, not an empty link", () => {
  assert.match(fails(), /name at least one shortcut/);
});

test("the handover carries the phone mark and an explicit markdown link", () => {
  const md = handover("Get-FileInfo", "--log");
  // SURFACING.md: a run link is marked with the phone icon, and a bare or
  // code-spanned custom scheme renders as dead text in the chat client.
  assert.ok(md.startsWith("\u{1F4F2} ["), md);
  assert.match(md, /\]\(shortcuts:\/\/run-shortcut\?/);
  assert.match(md, /Get-FileInfo then Log-Repo/);
});

test("--label names the handover without changing the link", () => {
  const md = handover("Get-FromJs", "--label", "does the coercion still run JS");
  assert.match(md, /\[does the coercion still run JS\]/);
});
