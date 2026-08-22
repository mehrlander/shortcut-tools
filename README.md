# Shortcut Tools

Search, look up, and programmatically build iOS/macOS Shortcuts. A dictionary of Shortcuts actions mapped to their internal workflow identifiers, a CLI over it, and a builder that emits a `.shortcut` file.

```bash
npx shortcut-tools search screenshot
```

```js
const { Shortcut } = require("shortcut-tools");

new Shortcut("Shout")
  .add("getclipboard")
  .add("changecase", { WFCaseType: "UPPERCASE" })
  .add("copytoclipboard")
  .export("shout.shortcut");
```

## Overview

`actions.json` contains **810 action definitions** that map human-readable action names to Apple's `WFWorkflowActionIdentifier` format used internally by the Shortcuts app.

### Structure

```json
{
  "actions": {
    "takescreenshot": "{\"WFWorkflowActionIdentifier\":\"is.workflow.actions.takescreenshot\"}",
    "replacetext": "{\"WFWorkflowActionIdentifier\":\"is.workflow.actions.text.replace\"}",
    ...
  }
}
```

Each key is a lowercase action name. Each value is a JSON-encoded string containing at minimum a `WFWorkflowActionIdentifier`. 38 of the 810 actions also include `WFWorkflowActionParameters` with pre-configured parameter templates.

One entry, `choosefrommenu`, holds **three** newline-separated JSON objects rather than one, being a menu opener and two sample cases. `JSON.parse` on that value throws. Split on `\n` first, as `parseActionValue` in `index.js` and `shortcut.js` does.

Those 38 parameter-bearing entries are exactly the 38 that carry a `WFControlFlowMode`: block openers, block closers, and 30 pre-configured conditionals. The dictionary holds no parameter examples for ordinary actions, so the other 772 entries are a bare identifier.

## Documentation

Apple documents neither the file format nor the runtime, so three files under `docs/` carry what is known. They split by question:

- [`docs/shortcuts-format-notes.md`](docs/shortcuts-format-notes.md): how a shortcut is **serialized**. Control-flow blocks pairing through `GroupingIdentifier` and `WFControlFlowMode`, variable references binding by producing UUID, the derived `WFCondition` table, the Run JavaScript performance cliff, and the limits of the builder in `shortcut.js`.
- [`docs/dataflow.md`](docs/dataflow.md): how values **flow at runtime**. Implicit passthrough through a compact `If`, and the switch-like conditional chains it makes possible.
- [`docs/idioms.md`](docs/idioms.md): how a real library is **written**. Read from a 577-shortcut corpus: the self-demo prologue that is really a test harness, the naming convention as a runtime type, one type system everything that dispatches consults, and JavaScript through a `data:` URL as the escape hatch. It also records the four claims that did not survive being checked, and why raw frequency over a mixed corpus is not evidence about one author.

## Chains and payloads

`workflows/` holds action chains as source, and `tools/pack.py` turns one into a
tappable link that pastes those actions onto the device clipboard. `pages/` holds
the HTML payloads a chain carries, referenced as `{"$file": "pages/x.html"}` so
each page has exactly one copy and stays testable in a browser.

The worked example is `gh-recent-branches`: two actions that build a page and
hand it to `Show-Html`, which substitutes the credential and opens it. The page
queries the GitHub GraphQL API and lists the branches whose latest commit is
yours, each one a link. See [`workflows/README.md`](workflows/README.md), plus
[what `Show-Html` does to a page](docs/shortcuts-format-notes.md#show-html-what-it-does-to-a-page-on-the-way-through)
and [the token-injection pattern](docs/shortcuts-format-notes.md#the-token-injection-pattern)
behind it.

## Sending a page, not a chain

`tools/pack.py` sends **actions to paste**. [`tools/show.py`](tools/show.py) is
its sibling and sends **a page to run**: one link that hands an HTML file to a
shortcut which base64-encodes it, builds `data:text/html;charset=utf-8;base64,`
and opens it, so the page lands in Safari as a real document.

```bash
python3 tools/show.py pages/gh-recent-branches.html      # prints a tappable link
python3 tools/show.py - < draft.html                     # a page not committed yet
python3 tools/show.py '<link>' --verify                  # read one back before sending
```

The page is gzipped and wrapped in [`tools/gz-shell.html`](tools/gz-shell.html),
which inflates it in the browser with `DecompressionStream` and writes it out.
Nothing on the device does the unpacking, so the shortcut stays three actions
long. Percent-encoding is what this buys off. Sent raw, a page costs about 1.7x
its own size, since markup is mostly characters the encoder escapes; compressed,
it costs a fixed ~700 characters of shell plus base64url, which the encoder
leaves almost entirely alone. A small page therefore gains little and a large
one collapses.

| Page | Raw link | Compressed link |
| --- | ---: | ---: |
| `pages/xhr-probe.html`, 1,256 chars | 2,126 | 1,799 |
| `pages/gh-recent-branches.html`, 5,768 chars | 9,621 | 4,560 |
| a 100 KB baked page | ~172,000 | ~5,200 |

Token injection survives the compression, which is the part worth knowing.
`Show-Html` substitutes by text replacement and cannot see inside a gzip stream,
so the shell keeps an uncompressed copy of each placeholder the page needs, takes
the substitution there, and applies it to the page after inflating. Only the
placeholders a page actually uses are carried, so a page with no secret in it is
never handed the token. Sending a token-bearing page to a target that does not
inject is refused rather than quietly loaded unauthenticated.

`--raw` skips the shell and sends the page as itself, which is what a device
without `DecompressionStream` needs (Safari gained it in 16.4).

## Running a shortcut, not sending anything

`pack.py` sends actions and `show.py` sends a page. [`tools/run.py`](tools/run.py)
sends **nothing** and just runs what is already installed, which is the cheapest
route in the table above and the one that had no emitter.

```bash
python3 tools/run.py Get-FromJs                  # one shortcut, no input
python3 tools/run.py Get-FromJs --log            # run it, commit what it returned
python3 tools/run.py Get-FileInfo Show-Table     # pipe one into the next
python3 tools/run.py Show-Loop --text 'hello'    # bake the input in
python3 tools/run.py --verify '<link>'           # read one back before sending
```

Two or more targets, or `--log`, route through `Run-Steps`, which splits its
input on newlines and runs each name with the previous result as its input. Its
first pass has no `Carry` set, so the first shortcut runs with no input, which
is what a bare diagnostic wants.

`--log` appends `Log-Repo`, so a probe returns itself: the payload goes to the
clipboard first and unconditionally, then to `shortcuts/log/` in
web-tools-private. Tap once and the answer is already here. That is the rule
this repository already stated and had no tool for, which is why every
diagnostic ended by asking the reader to open the Shortcuts app and hunt for a
name.

Two refusals rather than a link that under-delivers. `--text` with several
targets is rejected, because `Run-Steps` consumes its input as the step list and
a payload has no slot left. And a single target with no input emits
`?name=X` with no `text=` at all, since an empty string is a value and every
diagnostic here branches on "input has no value".

## Menus with icons

Choose from List shows one plain line per row. Given **contacts** it shows an
image, a title, and a subtitle, so a `.vcf` is how a native menu gets an icon.
[`tools/vcard.py`](tools/vcard.py) builds one from a spec in
[`menus/`](menus/):

```bash
python3 tools/vcard.py menus/demo.json --out Choice.vcf
```

The icons are rasterized **here**, not on the device. A glyph is a constant, so
fetching one per row per run costs a round trip before the menu can appear,
fails offline, and puts the whole menu behind async work. Live row content is
the opposite and has to be fetched there.

The photo is a **1-bit PNG built here, not by the canvas**, which is the whole
size story. A Phosphor glyph is two colors, so an encoder that stores two colors
beats one built for photographs. Per row at 128px, as base64:

| Encoding | Bytes per row |
| --- | ---: |
| Canvas JPEG, q0.8, profile stripped | 2,594 |
| 8-bit grayscale PNG | 1,172 |
| 1-bit PNG | **425** |

At list size the three are indistinguishable, because the display downsamples
128px to about 44 and averages the aliasing away. `--bits 8` keeps the
antialiased edge if a larger presentation ever needs it.

Unlike a page, a `.vcf` cannot use the compression above, since that inflates in
a browser and this payload has to land in Shortcuts. Picking the right encoder
turned out to matter more than compression would have.

## Reading a library back

The tools above send shortcuts to a device. These four read a device's library
back, which is the other half and the one that makes pruning safe.

```bash
python3 tools/index-dump.py dumps/*.zip --json index.json   # what exists, what calls what
python3 tools/survey.py index.json -o library.html          # tiered, browsable, with facets
python3 tools/sketch.py dumps/*.zip --name Show-Loop        # 54 KB of XML as 1.8 KB of pseudocode
python3 tools/restore.py dumps/*.zip Show-Loop              # a paste link that puts it back
python3 tools/harvest.py dumps/*.zip --index index.json -o core/   # editable chain files
```

A dump comes from [`workflows/dump-folder-zip.json`](workflows/dump-folder-zip.json),
four actions that export one folder as a zip of unsigned plists. The folder is
the size control: a library is usually small, but a single shortcut holding
megabytes of pasted text is not.

Three things an export cannot restore, and they are why a delete is a decision
rather than a formality: **the name**, which lives only in the zip entry since
the plist has no field for it; **anything outside the plist**, meaning Home
Screen icons, widgets, share sheet and Siri configuration, and automations; and
**whatever was never dumped**. `restore.py` prints the name for the first and
its docstring names the rest.

`survey.py` tiers a library into core, called, uncalled, sediment and imported.
Read the tiers as a recommended prune order, and take counts from the three
facets it also emits (`provenance`, `lifecycle`, `connectivity`), since the
tiers are a cascade over those and collapse pairs. The core is a floor: it is
the closure of named hubs, so it grows with every entry point the call graph
cannot see.

## The library as an app view

[`pages/library.html`](pages/library.html) is the browsable form of all of the
above, and an **app view**: any repo promotes a page to an estate-level entry in
show-repo by flagging a `pages` catalog entry `appView: true` in its own
`.web-tools.json`, which is the whole integration. The renderer lives here,
public, beside the tools that generate what it reads; the library it reads lives
in a private repository, through the viewer's token.

Three facets. **Library** browses every shortcut on axes the Shortcuts app does
not have: tier, provenance, lifecycle, connectivity, and the call graph both
ways, so "what calls `Show-Html`" is a search rather than an afternoon. A row
expands to its pseudocode sketch, and a call the archive does not hold is struck
through where it is named. **Prune** is below. **Reference** renders this repo's
own `docs/` in place, because the format record is about Apple's runtime rather
than about this estate, and belongs beside the library it explains.

The page **derives nothing**. Tier, facets, and the graded nominations all come
from `survey.py --json`, which writes a `library.json` beside the index:

```bash
python3 tools/survey.py index.json --json library.json   # data for the page
python3 tools/survey.py index.json -o library.html       # the standalone page
```

One owner for the tiering, so changing a rule shows up as a changed file rather
than as two surfaces quietly disagreeing.

### Deletion is the fourth step, never the first

Nothing on the page deletes anything, and the sequence is built so that every
step before the last is reversible:

1. **Nominate**, here, mechanically and **graded**. `high` is a name Shortcuts
   itself minted on an edit whose original is still in the archive, so the
   question nearly answers itself. `medium` is that residue with the original
   gone, meaning the copy may now be the only version. `low` is an import
   nothing calls, which is not the same as never used. The Uncalled tier is
   never nominated at any grade: it is the largest tier, and "called by nothing"
   is exactly what a Home Screen, widget, share sheet, or Siri entry point looks
   like from here.
2. **Stage**, on the device, by moving the picked shortcuts into a holding
   folder. A move, so it undoes.
3. **Wait.** The folder sits there as long as you like. The page shows how many
   days each has been in it.
4. **Delete**, on the device, with the shortcut open in front of you. The page
   opens it for you and stops there.

A nomination is a question to answer on the device, never an instruction to act
on here, which is why it carries a confidence rather than a flag.

The page writes a `prune.json` ledger beside the archive recording each
decision, including **keep**, which exists so a reviewed shortcut stops being
re-nominated forever. The ledger records decisions and cannot see the phone: the
next dump is the ground truth, and a staged name absent from it is what confirms
the deletion happened.

### The two device receivers

Every instruction the page sends is `shortcuts://run-shortcut`, the only scheme
this library has ever proven. Opening an editor and moving to a folder are
**actions**, not schemes, so each runs inside a small receiver the link names:

| Receiver | Input | Cards | Source |
| --- | --- | ---: | --- |
| `Library-Open` | one name | 3 | [`workflows/library-open.json`](workflows/library-open.json) |
| `Library-Stage` | names, newline-separated | 6 | [`workflows/library-stage.json`](workflows/library-stage.json) |

**Neither can delete, and that is the design.** A receiver that could would make
the page one tap from the thing the whole workflow exists to slow down.

Both are **find, then act**: `getmyworkflows`, then `filter.files` on `Name`,
then the entity slot bound to that filter's output, since these actions address
an App Intents entity rather than a name. `Library-Stage` wraps that in
`Run-Steps`' split-and-repeat so a bulk stage is one tap. The shapes and their
two measured-versus-inferred limits are in
[the format notes](docs/shortcuts-format-notes.md#the-library-management-actions-address-an-app-intents-entity-not-a-name).

One tap of setup: `Library-Stage`'s Move card ships with its **folder unset**,
because a folder is picked by opaque identifier and the holding folder does not
exist until you make it. Create it, tap the card, choose it once.

[`workflows/manage-library-probe.json`](workflows/manage-library-probe.json) is
the spent probe that produced the Move and Delete shapes, kept as the record of
how they were learned. Nothing in the 577-shortcut corpus uses either action, so
a copied card really was the only source; `Open` was already in the corpus three
times over and needed no probe at all.

## CLI

Installed as `shortcut-tools`, or run with `npx shortcut-tools`.

| Command | Does |
|---|---|
| `search <query>` | Substring match on action name **and** identifier. Prints each match with its identifier and any parameter template. |
| `get <name>` | Exact lookup. Lowercases the argument and joins multi-word arguments with no separator, so `get take screenshot` finds `takescreenshot`. Exits 1 if absent. |
| `apps` | Lists every app source with its full bundle id and action count. |
| `app <id>` | Lists one source's actions as `name (IntentClassName)`. Takes a full bundle id (`com.apple.mobilenotes`) or the bare segment (`mobilenotes`). |
| `demo [path]` | Builds a 15-action demo shortcut and writes it to `demo.shortcut` or the given path. |
| `help` | Usage. Also the default with no arguments. |

```
$ shortcut-tools get takescreenshot
takescreenshot:

  identifier: is.workflow.actions.takescreenshot
```

```
$ shortcut-tools app com.brogrammers.charty
24 actions in com.brogrammers.charty:

  accumulatevalues  (AccumulateValuesIntent)
  addaverage  (AddAverageIntent)
```

Names printed on the left are the dictionary's, so they feed straight back into `get` and `Shortcut.add()`. The parenthesised name is the identifier's leaf segment, which is usually the app's intent class and is the more legible label. 15 of the 792 grouped entries have no unambiguous action name, mostly generic conditional operators; those print their full identifier instead of guessing.

## Library

```js
const { getAction, searchActions, listApps, getActionsByApp,
        listActions, allActions, Shortcut, buildXMLPlist,
        tokenString, variable, attachment, ANCHOR } = require("shortcut-tools");
```

`allActions` is the underlying `Map` of name to variant array, and `buildXMLPlist(obj)` serializes any plain object to an XML plist. Both are exported for anything the functions above do not cover.

**Lookup.** `getAction(name)` returns an array of variants or `undefined`; it is exact, lowercased, and does no fuzzy matching. `searchActions(query)` returns `{ name, variants }` objects matching on name or identifier. `listActions()` returns all 810 names. `listApps()` returns `{ category, appId, count }` with full bundle ids. `getActionsByApp(appId)` returns action names, accepting a full bundle id or a bare source segment, and takes `{ detailed: true }` for `{ name, leaf, identifier }` objects; `name` is `null` where no single action name applies.

Every lookup returns an **array**, because one name can hold several variants. Only `choosefrommenu` does today, but code that assumes a single object breaks on it.

**Building.** `new Shortcut(name)` then chain:

| Method | Notes |
|---|---|
| `add(name, params)` | Resolves exactly, then falls back to prefix and substring matching, preferring the shortest match. Merges any parameter template, mints a `UUID`. **Throws on control-flow actions**; see below. |
| `addRaw(obj)` | Pushes an action object verbatim. The deliberate bypass. |
| `comment(text)` | A comment action. |
| `setIcon(color, glyph)` | Integer color and glyph number. |
| `ifBegin(params, preset)` / `otherwise()` / `ifEnd()` | `preset` optionally names one of the 30 pre-configured conditionals, whose `WFInput` and `WFCondition` are merged in. |
| `ifElse(params, ifFn, elseFn, preset)` | The three above, with callbacks. |
| `repeatBegin(n)` / `repeatEnd()`, `repeat(n, fn)` | Repeat N times. |
| `repeatEachBegin()` / `repeatEachEnd()` | Repeat with each. |
| `menuBegin(prompt)` / `menuItem(title)` / `menuEnd()`, `menu(prompt, items)` | `items` maps a title to a callback. |
| `build()` | The workflow plist as a plain object. |
| `lastUUID()` | The UUID of the action just added, for wiring the next one to it. |
| `toActionChain(label)` | `{ label, actions: [{ id, p }] }`, the shape `tools/pack.py` packs into a link. **The delivery path.** |
| `toJSON()` / `toXMLPlist()` | Serialize. |
| `export(path)` | Write the XML plist. An unsigned `.shortcut` will not import, but `Library-Import` remote-signs one and installs it, so this **is** an install path now. See [Installing](#installing-a-generated-shortcut). |

**Wiring.** `tokenString(parts)` builds a text value with variables embedded in it, taking an alternating list of strings and refs and **deriving the anchor offsets** rather than making you count characters. `variable(ref)` is the other form, where the value *is* an output. A ref is `{ uuid, name }`, or `{ input: true }` for Shortcut Input, plus optional `key` to take one dictionary key and `as` to coerce.

```js
s.add("text", { WFTextActionText: "hi" });
s.add("showresult", { Text: tokenString(["The text said: ", { uuid: s.lastUUID() }]) });
```

**Control flow must go through the helpers.** A block is several sibling actions sharing a `GroupingIdentifier`, and no entry in `actions.json` carries one, so `add()` cannot build a block and refuses rather than emitting a dangling opener:

```js
s.add("repeat")
// Error: "repeat" resolves to the control-flow action
// "is.workflow.actions.repeat.count" ... Use repeatBegin()/repeatEnd(), or repeat().
```

**`add()`'s fuzzy fallback can surprise you.** `add("gettext")` resolves to `gettextfrompdf`, because `gettext` is not itself a key and the shortest prefix match wins. When a name matters, confirm it with `getAction` first, which does no fallback.

## Tests

`npm test`. Node's built-in runner, no dependencies. Covers the dataset's shape and the builder's control-flow output.

## Action Sources

| Source | Actions | Description |
|---|---|---|
| `is.workflow.actions` | 321 | Built-in Apple Shortcuts actions |
| `com.sindresorhus.Actions` | 138 | Actions app by Sindre Sorhus |
| `co.zottmann.ActionsForObsidian` | 47 | Actions for Obsidian |
| `com.alexhay.nautomate` | 44 | nAutomate |
| `com.apple.AccessibilityUtilities` | 30 | Apple Accessibility |
| `com.brogrammers.charty` | 24 | Charty |
| `io.pushcut.Pushcut` | 22 | Pushcut |
| `com.iBanks.Automation-Control` | 20 | Automation Control |
| `com.apple.mobilesafari` | 15 | Safari |
| `com.apple.mobilenotes` | 13 | Notes |
| Other apps | 136 | Various Apple and third-party apps |
