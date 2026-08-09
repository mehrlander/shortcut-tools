---
id: document-library-api-and-cli-lqkb9f
title: Document the library API and CLI in the README
status: done
opened: 2026-08-09
closed: 2026-08-09
session: claude/shortcut-tools-tracker-cpc8d7
---
# Document the library API and CLI in the README

`package.json` describes this package as "Search, look up, and programmatically
build iOS/macOS Shortcuts" and ships a `shortcut-tools` binary. The README
describes only the dictionary. Two of the three verbs in the package's own
description are undocumented, and so is the entire `Shortcut` class.

Undocumented surface, all of it exported or installed today:

- `index.js`: `getAction`, `searchActions`, `getActionsByApp`, `listApps`,
  `listActions`.
- `cli.js`: the `shortcut-tools` binary, its subcommands and output shapes.
- `shortcut.js`: the `Shortcut` class, `add`/`addRaw`, the control-flow helpers
  and their wrappers, `setIcon`, `comment`, `build`, `toXMLPlist`, `toJSON`,
  `export`.

The format-level material belongs in `docs/shortcuts-format-notes.md`, which
already exists; this is the API reference, and it belongs in the README where a
reader arrives.

**Done when** every exported function and the CLI's subcommands are documented
with at least one worked example each, and the README's opening line describes
the package rather than only the dataset.

## Progress log
- 2026-08-09: Filed. Surface enumerated by reading `index.js`, `cli.js`, and
  `shortcut.js` on this branch.
- 2026-08-09: Done on `claude/shortcut-tools-tracker-cpc8d7`. The README now
  carries a CLI table for all six commands, a library reference for every
  export, and the two surprising behaviors: lookups return an array of variants,
  and `add()`'s fuzzy fallback resolves `gettext` to `gettextfrompdf`. 6 API
  tests added, one holding the README's opening example. Writing it surfaced the
  `actions-grouped.json` namespace split, which reframed
  `land-grouped-action-taxonomy-r79gj3` rather than being filed separately.
