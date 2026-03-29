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
