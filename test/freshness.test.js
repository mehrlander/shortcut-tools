// The cross-repo half of the staleness guarantee. packed/ and plists/ are
// mirrors inside this repo and their tests always run; the corpus derivatives
// live in web-tools-private and exist only where that checkout does, so this
// wrapper skips (never fails) on a public-only clone. Exit codes are the
// tool's contract: 0 current, 1 stale, 2 no checkout.
const test = require("node:test");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

test("web-tools-private derivatives are current with the dumps", (t) => {
  const r = spawnSync("python3", [path.join("tools", "freshness.py")],
    { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  if (r.status === 2) return t.skip("no web-tools-private checkout");
  if (r.status !== 0) {
    throw new Error("freshness.py exit " + r.status + "\n" + (r.stderr || r.stdout));
  }
});
