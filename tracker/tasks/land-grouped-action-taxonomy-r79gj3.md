---
id: land-grouped-action-taxonomy-r79gj3
title: Land the grouped action taxonomy
status: backlog
opened: 2026-08-09
---
# Land the grouped action taxonomy

`actions-grouped.json` has three top-level buckets: `is.workflow.actions`,
`com.apple`, and `other`. That is a split by bundle prefix, which the flat
dictionary already encodes in every identifier, so the file currently adds
nothing a consumer could not derive.

The taxonomy it was meant to carry is a grouping by **domain**: primitives,
media, properties, filter, communication, speech, and the rest. That design was
worked out in October 2025 and revisited in March 2026, and both sessions ended
without a schema being locked. The March session's own summary records it: "No
final schema was locked; session ended open."

The work is to settle the schema and regenerate the file against it. The open
question the earlier sessions did not close is what to do with third-party
bundles: 138 Sindre Sorhus actions and 47 Actions for Obsidian entries do not
decompose into the same domains as Apple's built-ins, so either they get their
own axis or the taxonomy is declared to cover built-ins only.

**Done when** `actions-grouped.json` groups by domain, every one of the 810
actions is placed, the placement is generated from a committed rule rather than
hand-sorted, and the README describes the schema.

Sources: [Apple Shortcuts action dictionary catalogued and reorganized](https://claude.ai/chat/1d7cd64b-78f9-402c-9285-76c4a0214ee5)
(2025-10-04) and [Apple Shortcut actions dictionary formatting](https://claude.ai/chat/633cf7cd-3fd2-48df-970e-fee34951d483)
(2026-03-25).

## Progress log
- 2026-08-09: Filed, from the Apple Shortcuts storyline in the `chat-histories`
  archive.
