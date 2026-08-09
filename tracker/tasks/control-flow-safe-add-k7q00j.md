---
id: control-flow-safe-add-k7q00j
title: Make control-flow actions safe to reach through add()
status: backlog
opened: 2026-08-09
---
# Make control-flow actions safe to reach through add()

`Shortcut.add()` emits structurally invalid control flow, silently. Verified by
running the builder on this branch:

- `add('repeat')` produces `is.workflow.actions.repeat.count` with
  `WFControlFlowMode: 0`, no `GroupingIdentifier`, and no closer. The block is
  unpaired, so the file will not import correctly.
- `add('choosefrommenu')` takes `variants[0]` and drops the two other variants
  the dictionary holds under that key.
- `add('if')`, `add('endif')`, and `add('otherwise')` all fuzzy-resolve to the
  same `is.workflow.actions.conditional` identifier with no mode set, because
  `conditional` is not a key in `actions.json` and `resolveAction`'s substring
  fallback collapses the three.

The dedicated helpers (`ifBegin`, `repeatBegin`, `menuBegin`, and the
`ifElse`/`repeat`/`menu` wrappers) are correct. The defect is only on the
generic path, which is the one a caller reaches first.

Two candidate fixes, and the choice is the substance of the task: refuse
control-flow identifiers in `add()` with an error naming the helper to use, or
have `add()` detect a `WFControlFlowMode` in the resolved variant and mint the
grouping itself. The first is smaller and harder to get wrong.

Scope also covers a validation pass over `actions.json`: every value parses
after a `\n` split, every object has a well-formed `WFWorkflowActionIdentifier`,
and the multi-variant entry is asserted rather than discovered.

**Done when** no call through `add()` can emit an unpaired or ungrouped
control-flow action, the fuzzy resolver cannot collapse three distinct
control-flow concepts onto one identifier, and a check on `actions.json` runs
and passes.

## Progress log
- 2026-08-09: Filed. Behavior verified by running `shortcut.js` directly; the
  findings are written up in `docs/shortcuts-format-notes.md`.
