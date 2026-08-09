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

Apple documents neither the file format nor the runtime, so two files under `docs/` carry what is known. They split by question:

- [`docs/shortcuts-format-notes.md`](docs/shortcuts-format-notes.md): how a shortcut is **serialized**. Control-flow blocks pairing through `GroupingIdentifier` and `WFControlFlowMode`, variable references binding by producing UUID, the derived `WFCondition` table, the Run JavaScript performance cliff, and the limits of the builder in `shortcut.js`.
- [`docs/dataflow.md`](docs/dataflow.md): how values **flow at runtime**. Implicit passthrough through a compact `If`, and the switch-like conditional chains it makes possible.

## CLI

Installed as `shortcut-tools`, or run with `npx shortcut-tools`.

| Command | Does |
|---|---|
| `search <query>` | Substring match on action name **and** identifier. Prints each match with its identifier and any parameter template. |
| `get <name>` | Exact lookup. Lowercases the argument and joins multi-word arguments with no separator, so `get take screenshot` finds `takescreenshot`. Exits 1 if absent. |
| `apps` | Lists app sources with counts, from `actions-grouped.json`. See the caveat below. |
| `app <id>` | Lists action names for one source, from `actions-grouped.json`. |
| `demo [path]` | Builds a 15-action demo shortcut and writes it to `demo.shortcut` or the given path. |
| `help` | Usage. Also the default with no arguments. |

```
$ shortcut-tools get takescreenshot
takescreenshot:

  identifier: is.workflow.actions.takescreenshot
```

> **`apps` and `app` read a different namespace.** They are backed by
> `actions-grouped.json`, whose keys are mostly intent class names
> (`NewChartIntent`) and short aliases (`gettext`, `conditional:if`), not the
> keys in `actions.json`. Only 99 of its 745 names also exist in the
> dictionary, so a name from `app` usually **cannot** be passed to `get` or to
> `Shortcut.add()`. Treat those two commands as a catalog of what exists, not
> as a source of usable names. Tracked in [`tracker/`](tracker/board.md).

## Library

```js
const { getAction, searchActions, listApps, getActionsByApp,
        listActions, allActions, Shortcut } = require("shortcut-tools");
```

`allActions` is the underlying `Map` of name to variant array, exported for anything the functions above do not cover.

**Lookup.** `getAction(name)` returns an array of variants or `undefined`; it is exact, lowercased, and does no fuzzy matching. `searchActions(query)` returns `{ name, variants }` objects matching on name or identifier. `listActions()` returns all 810 names. `listApps()` and `getActionsByApp(appId)` read the grouped file and carry the namespace caveat above.

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
| `toJSON()` / `toXMLPlist()` | Serialize. |
| `export(path)` | Write the XML plist to disk. |

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
