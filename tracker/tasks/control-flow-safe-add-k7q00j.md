---
id: control-flow-safe-add-k7q00j
title: Make control-flow actions safe to reach through add()
status: done
opened: 2026-08-09
closed: 2026-08-09
session: claude/shortcut-tools-tracker-cpc8d7
---
# Make control-flow actions safe to reach through add()

`Shortcut.add()` emitted structurally invalid control flow, silently. 38 entries
in `actions.json` carry a `WFControlFlowMode` and not one carries a
`GroupingIdentifier`, so nothing `add()` could read would let it pair a block:

- `add('repeat')` produced `is.workflow.actions.repeat.count` with
  `WFControlFlowMode: 0`, no `GroupingIdentifier`, and no closer. The block was
  unpaired, so the file would not import correctly.
- `add('choosefrommenu')` took `variants[0]` and dropped the two other variants
  the dictionary holds under that key.

The dedicated helpers (`ifBegin`, `repeatBegin`, `menuBegin`, and the
`ifElse`/`repeat`/`menu` wrappers) were correct. The defect was only on the
generic path, which is the one a caller reaches first.

Scope also covered a validation pass over `actions.json`: every value parses
after a `\n` split, every object has a well-formed `WFWorkflowActionIdentifier`,
and the multi-variant entry is asserted rather than discovered.

**Done when** no call through `add()` can emit an unpaired or ungrouped
control-flow action, and a check on `actions.json` runs and passes.

## Progress log
- 2026-08-09: Filed. Behavior verified by running `shortcut.js` directly; the
  findings are written up in `docs/shortcuts-format-notes.md`.
- 2026-08-09: Correction. The filing claimed `add('if')`, `add('endif')`, and
  `add('otherwise')` fuzzy-resolved onto one identifier with no mode. They do
  not. All three are distinct keys carrying modes 0, 2, and 1 respectively; the
  original probe printed only the shared `is.workflow.actions.conditional`
  identifier and the collapse was inferred from that. The missing
  `GroupingIdentifier` was the whole defect. The task's third done-condition,
  about the resolver, is struck as resting on a false premise.
- 2026-08-09: Done on `claude/shortcut-tools-tracker-cpc8d7`; lands via PR #4.
  `add()` now refuses any resolved control-flow variant and names the helper to
  use, with `addRaw()` as the deliberate bypass. Because that refusal also
  closed off the 30 pre-configured conditionals, `ifBegin` gained a preset
  argument that merges one of them by name. 17 tests added under `test/`, run by
  `npm test` on Node's built-in runner with no dependencies.
