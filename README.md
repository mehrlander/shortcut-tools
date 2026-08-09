# Shortcut Tools

A dictionary of iOS/macOS Shortcuts actions mapped to their internal workflow identifiers.

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
