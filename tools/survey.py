#!/usr/bin/env python3
"""Tier a shortcut library and write a browsable survey page.

    python3 tools/survey.py <index.json> -o <library.html> [--hub NAME ...]

Takes the index `index-dump.py` produces and answers the question a pile of
577 shortcuts cannot: which ones are load-bearing, and which are residue.

The generator lives here and the page it writes does not, because the index
names every shortcut on a device and this repository is public. Point it at an
index in a private repository and write the page beside it.

The tiering is mechanical, and each rule is a claim that can be wrong:

- **core** is the transitive closure of the named hubs over the call graph,
  self-calls excluded. A self-call is the self-demo idiom, not a dependency.
- **sediment** is a numbered duplicate (`Thing 1`) or an `Old`/`Test`/`before`
  suffix, which is what Shortcuts' duplicate-on-edit leaves behind. A name in
  the core is never sediment, however it is spelled.
- **imported** is anything not in `Verb-Noun` form, the library's own
  convention, so it reads as third-party or system rather than authored.
- **rest** is authored and outside the core, split by whether anything calls
  it. The uncalled half is the prune candidate list, and it is the largest
  tier, which is the finding rather than a failure of the rule.

**The tier is a cascade, not a taxonomy, and it loses information.** Three
independent things are being decided: where a shortcut came from
(**provenance**), whether it is a duplicate-on-edit leftover (**lifecycle**),
and how the graph reaches it (**connectivity**). Every shortcut has a value on
all three, and collapsing them to one bucket hides pairs: 28 imported shortcuts
are numbered duplicates and get reported as sediment rather than as imports, so
the Imported count understates the real 237; 5 of the 42 core shortcuts are
imported rather than authored; and 2 core shortcuts are numbered duplicates.
Each row therefore also carries `provenance`, `lifecycle`, and `connectivity`,
and those are the facts. Read the tier as a recommended action over them,
useful for a first pass and wrong to quote as a count.

**And the core is a floor, not a fact.** It is the closure of the named hubs,
so it grows with every entry point the graph cannot see: a shortcut launched
from the Home Screen, a widget, the share sheet, or Siri is invisible here.
Measured by adding random uncalled shortcuts as extra hubs, the core runs about
42 with none, 48 with five, and 57 with ten. Treat 42 as "at least this much is
live."
"""
import argparse, collections, difflib, json, re, sys
from pathlib import Path

HUBS = ["Show-Loop", "Use-Shortcut", "Get-Text"]


def authored(name):
    """The library's convention: Verb-Noun, no space before the hyphen."""
    return bool(re.match(r"^[^\s-]+-[A-Z0-9]", name.split(" ")[0]))


def is_sediment(name):
    return bool(re.search(r" \d+$", name) or re.search(r"(Old|Test|Copy|before|Chunked)$", name))


def tier(index, hubs):
    by = {s["name"]: s for s in index}

    def calls(name):
        s = by.get(name)
        return [] if not s else [t for t in s.get("calls", []) if t != name]

    seen, stack = set(hubs), list(hubs)
    while stack:
        for t in calls(stack.pop()):
            if t not in seen:
                seen.add(t)
                stack.append(t)
    core = seen & set(by)

    callers = collections.defaultdict(list)
    for s in index:
        for t in calls(s["name"]):
            callers[t].append(s["name"])

    depth = {h: 0 for h in hubs if h in by}
    queue = list(depth)
    while queue:
        n = queue.pop(0)
        for t in calls(n):
            if t not in depth:
                depth[t] = depth[n] + 1
                queue.append(t)

    out = []
    for s in sorted(index, key=lambda s: s["name"].lower()):
        n = s["name"]
        if n in core:
            t = "core"
        elif is_sediment(n):
            t = "sediment"
        elif not authored(n):
            t = "imported"
        else:
            t = "kept" if callers.get(n) else "prune"
        out.append({"name": n, "tier": t,
                    "provenance": "authored" if authored(n) else "imported",
                    "lifecycle": "residue" if is_sediment(n) else "live",
                    "connectivity": ("reachable" if n in core
                                     else "called" if callers.get(n) else "uncalled"),
                    "actions": s.get("actions", 0),
                    "calls": calls(n), "callers": sorted(callers.get(n, [])),
                    "depth": depth.get(n), "menu": s.get("menu", False),
                    "input": s.get("takes_input", False), "from": s.get("from", ""),
                    "kinds": [k for k, _ in s.get("kinds", [])][:3]})
    missing = sorted({t for t in callers if t not in by})
    return out, missing


def suggest(name, names):
    """The shortcut a dangling reference was probably renamed to.

    Two passes, because a rename is not always a small edit. `Get-Jina` became
    `Get-LinkSummaryJina`, which is far apart as strings and obvious once the
    distinctive word is matched instead of the whole name.
    """
    close = difflib.get_close_matches(name, names, n=1, cutoff=0.75)
    if close:
        return close[0]
    words = [w for w in re.findall(r"[A-Z][a-z]+|[A-Z]{2,}", name) if len(w) > 3]
    for w in sorted(words, key=len, reverse=True):
        hits = [n for n in names if w in n]
        if len(hits) == 1:
            return hits[0]
    return None


def dangling(index, rows):
    """Names something calls that the archive does not hold.

    A dangling reference is usually not a missing backup. It is a rename whose
    callers were never updated, and the cost is a menu branch that fails when
    tapped rather than anything lost. Grouping by who calls it is what separates
    the two: a name only imported shortcuts want is a third-party companion
    never installed, and a name a live shortcut wants is a branch to fix.
    """
    tiers = {r["name"]: r["tier"] for r in rows}
    names = set(tiers)
    callers = collections.defaultdict(list)
    for s in index:
        for t in s.get("calls", []):
            if t != s["name"] and t not in names:
                callers[t].append(s["name"])

    out = []
    for target in sorted(callers):
        who = sorted(callers[target])
        kinds = {tiers.get(c, "?") for c in who}
        if kinds == {"imported"}:
            verdict = "imported callers only"
        elif "core" in kinds:
            verdict = "reachable from the core"
        elif kinds <= {"sediment", "prune"}:
            verdict = "dead code calling dead code"
        else:
            verdict = "called from the kept tier"
        out.append({"target": target, "callers": who, "verdict": verdict,
                    "maybe": suggest(target, names)})
    return out


TIERS = [
    ("core", "Core", "Reachable from the hubs. This is the library that is actually running."),
    ("kept", "Called", "Authored, outside the core, but something calls it. Check the caller before removing."),
    ("prune", "Uncalled", "Authored, outside the core, called by nothing. The prune list."),
    ("sediment", "Sediment", "Numbered duplicates and Old/Test suffixes. Duplicate-on-edit residue."),
    ("imported", "Imported", "Not Verb-Noun, so third-party or system rather than authored."),
]

PAGE = """<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shortcut library</title>
<style>
  :root { color-scheme: light dark; --line: #8883; --dim: #8889; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 1rem 1rem 4rem; }
  h1 { font-size: 1.2rem; margin: 0 0 .2rem; }
  .sub { color: var(--dim); margin: 0 0 1rem; font-size: .85rem; }
  .tiers { display: flex; flex-wrap: wrap; gap: .3rem; }
  .t { border: 1px solid var(--line); border-radius: 999px; padding: .25rem .7rem; cursor: pointer;
       background: none; color: inherit; font: inherit; font-size: .85rem; white-space: nowrap; }
  .t[aria-pressed="true"] { border-color: currentColor; background: #8882; }
  .t b { font-weight: 600; }
  .t span { color: var(--dim); }
  .why { font-size: .82rem; color: var(--dim); margin: .7rem 0 .4rem; min-height: 2.4em; }
  input { width: 100%; box-sizing: border-box; font: inherit; padding: .5rem .6rem;
          border: 1px solid var(--line); border-radius: .5rem; background: none; color: inherit; }
  ul { list-style: none; padding: 0; margin: .6rem 0 0; }
  li { border-bottom: 1px solid var(--line); padding: .5rem 0; }
  .n { font-weight: 600; }
  .m { font-size: .78rem; color: var(--dim); }
  .m code { font-size: .95em; }
  details summary { cursor: pointer; font-size: .78rem; color: var(--dim); }
  .d { display: inline-block; min-width: 1.4em; font-size: .7rem; color: var(--dim); }
</style>

<h1>Shortcut library</h1>
<p class="sub">__SUB__</p>
<div class="tiers">__CARDS__</div>
<p class="why" id="why"></p>
<input id="q" placeholder="Filter by name, or by a shortcut it calls">
<p class="m" id="count"></p>
<ul id="list"></ul>

<script>
var DATA = __DATA__, MISSING = __MISSING__, WHY = __WHY__;
var tier = null, list = document.getElementById('list');

function row(s) {
  var li = document.createElement('li');
  var d = s.depth === null ? '' : '<span class="d">' + s.depth + '</span>';
  var bits = [s.actions + ' actions'];
  if (s.input) bits.push('takes input');
  if (s.menu) bits.push('menu');
  if (s.callers.length) bits.push(s.callers.length + ' caller' + (s.callers.length > 1 ? 's' : ''));
  var html = d + '<span class="n">' + esc(s.name) + '</span>' +
             '<div class="m">' + bits.join(' &middot; ') + '</div>';
  if (s.calls.length || s.callers.length) {
    html += '<details><summary>graph</summary><div class="m">' +
      (s.calls.length ? 'calls: ' + s.calls.map(esc).join(', ') + '<br>' : '') +
      (s.callers.length ? 'called by: ' + s.callers.map(esc).join(', ') : '') + '</div></details>';
  }
  li.innerHTML = html;
  return li;
}

function esc(t) { return String(t).replace(/[&<>]/g, function (c) {
  return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

function draw() {
  var q = document.getElementById('q').value.toLowerCase();
  var rows = DATA.filter(function (s) {
    if (tier && s.tier !== tier) return false;
    if (!q) return true;
    return s.name.toLowerCase().indexOf(q) >= 0 ||
           s.calls.concat(s.callers).join(' ').toLowerCase().indexOf(q) >= 0;
  });
  // Core reads as a tree from the hubs; every other tier reads alphabetically.
  if (tier === 'core') rows = rows.slice().sort(function (a, b) {
    return (a.depth - b.depth) || a.name.localeCompare(b.name); });
  list.replaceChildren.apply(list, rows.map(row));
  document.getElementById('count').textContent = rows.length + ' shown';
  document.getElementById('why').textContent = tier ? WHY[tier] : MISSING;
}

document.querySelectorAll('.t').forEach(function (b) {
  b.onclick = function () {
    tier = tier === b.dataset.t ? null : b.dataset.t;
    document.querySelectorAll('.t').forEach(function (o) {
      o.setAttribute('aria-pressed', o.dataset.t === tier); });
    draw();
  };
});
document.getElementById('q').oninput = draw;
draw();
</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("index")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--hub", action="append", default=None,
                    help="a hub to reach from; repeatable (default: %s)" % ", ".join(HUBS))
    ap.add_argument("--dangling", action="store_true",
                    help="report calls to names the archive does not hold, and stop")
    args = ap.parse_args()

    index = json.load(open(args.index))
    rows, missing = tier(index, args.hub or HUBS)
    counts = collections.Counter(r["tier"] for r in rows)

    if args.dangling:
        rep = dangling(index, rows)
        for verdict, n in collections.Counter(r["verdict"] for r in rep).most_common():
            print("%3d  %s" % (n, verdict))
        print()
        for r in rep:
            if r["verdict"] != "reachable from the core":
                continue
            live = [c for c in r["callers"] if
                    next(x["tier"] for x in rows if x["name"] == c) == "core"]
            print("%-22s <- %s%s" % (r["target"], ", ".join(live),
                                     "   maybe now: " + r["maybe"] if r["maybe"] else ""))
        return

    cards = "".join(
        '<button class="t" data-t="%s" aria-pressed="false"><b>%s</b> <span>%d</span></button>'
        % (key, label, counts.get(key, 0)) for key, label, _ in TIERS)
    sub = "%d shortcuts, %d actions. Hubs: %s." % (
        len(rows), sum(r["actions"] for r in rows), ", ".join(args.hub or HUBS))
    note = "%d names are called and absent from the archive. Tap a tier." % len(missing)

    page = PAGE
    for slot, fill in (("__SUB__", sub),
                       ("__CARDS__", cards),
                       ("__DATA__", json.dumps(rows, ensure_ascii=False, separators=(",", ":"))),
                       ("__MISSING__", json.dumps(note)),
                       ("__WHY__", json.dumps({k: w for k, _, w in TIERS}, ensure_ascii=False))):
        if page.count(slot) != 1:
            raise SystemExit("slot %s appears %d times, expected once" % (slot, page.count(slot)))
        page = page.replace(slot, fill)

    Path(args.out).write_text(page)
    print("wrote %s" % args.out, file=sys.stderr)
    for key, label, _ in TIERS:
        print("%-9s %3d  %s" % (label, counts.get(key, 0), key))


if __name__ == "__main__":
    main()
