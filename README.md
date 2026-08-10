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
| `export(path)` | Write the XML plist. A serialization format, not an install path: an unsigned `.shortcut` will not import. |

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
