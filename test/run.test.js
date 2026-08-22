const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

const run = (...args) =>
  execFileSync("python3", [path.join("tools", "run.py"), ...args],
               { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

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
