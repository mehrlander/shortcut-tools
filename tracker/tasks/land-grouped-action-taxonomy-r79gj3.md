---
id: land-grouped-action-taxonomy-r79gj3
title: Reconcile actions-grouped.json with the dictionary
status: backlog
opened: 2026-08-09
---
# Reconcile actions-grouped.json with the dictionary

**Reframed 2026-08-09.** This was filed as "land the grouped action taxonomy,"
on the belief that `actions-grouped.json` was a coarse but correct grouping of
`actions.json` that wanted a better schema. It is not a grouping of it at all.

The two files use **different key vocabularies**. Measured:

- `actions.json`: 810 keys, lowercase action names (`takescreenshot`).
- `actions-grouped.json`: 745 keys, mostly intent class names
  (`NewChartIntent`, `AXToggleZoomIntent`) and short aliases (`gettext`,
  `notification`, `conditional:if`).
- **99 keys appear in both.** 711 dictionary entries are absent from the
  grouped file; 646 grouped names do not exist in the dictionary.

So the grouped file is a second, differently-keyed dataset, not a view of the
first. That has a user-visible consequence today, since `listApps` and
`getActionsByApp` (and the CLI's `apps` and `app`) read it:

```
$ shortcut-tools app com.brogrammers.charty
  AccumulateValuesIntent ...
$ shortcut-tools get AccumulateValuesIntent
Action "accumulatevalueintent" not found
```

A name the CLI hands you usually cannot be passed back into the CLI. The README
now carries the caveat, which is a patch over the problem, not a fix.

The decision this task exists to make, and it is a fork rather than a
refinement:

1. **Rekey the grouped file onto the dictionary's names**, making it a true
   view, and accept losing the 646 names with no dictionary entry. Cheapest,
   and makes `app` output usable.
2. **Treat it as a second dataset** and say so: rename it, document its
   vocabulary, and split the API so `listApps` no longer looks like a sibling of
   `getAction`. Honest, keeps the data, more work.
3. **Absorb the 646 into `actions.json`** if their identifiers can be recovered,
   then rekey. Largest, and only viable if those names carry enough to
   reconstruct an identifier.

Only after that is settled does the original domain-taxonomy question apply:
grouping by domain (primitives, media, filter, communication, speech) rather
than by bundle prefix, which the identifiers already encode. That design was
worked out in October 2025 and revisited in March 2026, and both sessions ended
without a schema locked. The open sub-question there is third-party bundles:
138 Sindre Sorhus and 47 Actions for Obsidian entries do not decompose into the
same domains as Apple's built-ins.

**Done when** the two files' relationship is stated in one place and enforced by
a check, `apps` and `app` return names usable elsewhere in the tool or are
documented as a separate vocabulary by design, and the README's caveat can be
deleted rather than merely explaining the problem.

Sources: [Apple Shortcuts action dictionary catalogued and reorganized](https://claude.ai/chat/1d7cd64b-78f9-402c-9285-76c4a0214ee5)
(2025-10-04) and [Apple Shortcut actions dictionary formatting](https://claude.ai/chat/633cf7cd-3fd2-48df-970e-fee34951d483)
(2026-03-25).

## Progress log
- 2026-08-09: Filed, from the Apple Shortcuts storyline in the `chat-histories`
  archive.
- 2026-08-09: Reframed. The premise was wrong: the files do not share a key
  vocabulary, so this is a reconciliation decision, not a schema exercise. Found
  while documenting the CLI for `document-library-api-and-cli-lqkb9f`; the
  counts above are measured against the files as committed.
