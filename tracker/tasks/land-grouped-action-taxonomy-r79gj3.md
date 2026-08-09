---
id: land-grouped-action-taxonomy-r79gj3
title: Make apps and app return usable action names
status: backlog
opened: 2026-08-09
---
# Make apps and app return usable action names

`listApps` and `getActionsByApp`, and the CLI's `apps` and `app` behind them,
return the **leaf segment** of an action identifier rather than the action name
the rest of the tool is keyed by. So the tool hands you a name it cannot itself
resolve:

```
$ shortcut-tools app com.brogrammers.charty
  AccumulateValuesIntent ...
$ shortcut-tools get AccumulateValuesIntent
Action "accumulatevalueintent" not found
```

The fix is a projection. `actions-grouped.json` decomposes each identifier into
bundle root, source, and leaf, so reassembling `root.source.leaf` yields the
identifier, and the identifier yields the dictionary name. Prototyped on
2026-08-09: `AccumulateValuesIntent` resolves to `accumulatevalues` for all 792
entries with no misses.

The decision is what those commands should return, since all three are now
cheap:

1. **The action name** (`accumulatevalues`). Feeds straight back into `get` and
   `add()`. Loses the intent class name, which is the more legible label.
2. **Both**, as `accumulatevalues (AccumulateValuesIntent)`. Most informative,
   and the CLI is already a human-facing surface. Changes the library return
   shape from `string[]` to objects, which is a breaking change for
   `getActionsByApp`.
3. **The full identifier**. Unambiguous and useful for building, but longer, and
   still not what `get` takes.

Recommendation: 2 for the CLI, 1 for the library, so the human surface stays
legible and the programmatic one stays composable.

Once that lands, the older question is worth revisiting on its own: whether the
grouped file should also carry a **domain** taxonomy (primitives, media, filter,
communication, speech) rather than only the bundle decomposition, which the
identifiers already encode. That design was worked out in October 2025 and
revisited in March 2026 and never locked. It is a separate outcome from this
one and should be a separate task if it is wanted.

**Done when** a name returned by `apps` or `app` can be passed to `get` and to
`Shortcut.add()`, and the README caveat is deleted rather than explained.

Sources: [Apple Shortcuts action dictionary catalogued and reorganized](https://claude.ai/chat/1d7cd64b-78f9-402c-9285-76c4a0214ee5)
(2025-10-04) and [Apple Shortcut actions dictionary formatting](https://claude.ai/chat/633cf7cd-3fd2-48df-970e-fee34951d483)
(2026-03-25).

## Progress log
- 2026-08-09: Filed, from the Apple Shortcuts storyline in the `chat-histories`
  archive.
- 2026-08-09: Reframed as a reconciliation fork, on the finding that the two
  files shared only 99 keys.
- 2026-08-09: **That reframing was wrong and is retracted.** It compared the
  dictionary's action names against the grouped file's leaf segments, which
  differ by construction. Reconstructing `root.source.leaf` gives 792
  identifiers covering all 774 in the dictionary, 792 of 792 resolving to a
  name, zero missing. The files correspond exactly, and the grouped file is the
  more precise on control flow, carrying suffixed forms (`conditional:if`) the
  flat dictionary collapses. Held by `test/grouped.test.js` from PR #6. What
  remains is the projection above, and the task is narrowed to it.
