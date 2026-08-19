---
id: track-shortcutsinfo-table-w4m8kq
title: Bring the ShortcutsInfo table into the repo, with a lastModified column
status: todo
opened: 2026-08-19
size: M
---
# Bring the ShortcutsInfo table into the repo, with a lastModified column

`Show-ShortcutsInfo` runs `Get-ShortcutsInfo` into `Show-Table`, which renders
the library as a Tabulator page. Two problems, and the second is why this is not
a one-line fix.

**It sorts by a column it does not show.** `Get-ShortcutsInfo` harvests
`lastModified` and orders rows by it, but the column config lists only name,
folder, actions, and the two icon columns, so the date reaches the reader only
through the per-row toast. The sync channel added on
`claude/shortcuts-recent-display-5k31ag` makes that field load-bearing, which is
a reason to be able to see and re-sort on it.

**The chain is not tracked here.** It exists only inside
`dumps/2026-08-13-01.zip`, so the fix cannot be made in this repo and published.
Bringing it in means writing `get-shortcuts-info` and `show-shortcuts-info` as
chain files, which drags in two dependencies worth deciding about first:

- the `toRows()` and `sortModified()` transforms live in an on-device
  `Snippets/Managed/transforms.json` that nothing here can see, so a tracked
  chain either vendors them or drops the JS step, and dropping it means the
  device-side JSON hazard the manifests already avoid with marker text
- the third-party Actions app supplies the JS action at all

Import is also not free here: the index goes to the newcomer, so importing over
a live `Get-ShortcutsInfo` leaves every caller resolving to the old copy. The
delete-first rule in CLAUDE.md covers shortcuts this repo generates, and this one
was authored on the device, so it needs a dump of the current version first.

Done when the table's chain is committed here, the plist installs it, and
`lastModified` is a visible sortable column.

## Progress log
- 2026-08-19: filed while building the sync channel, which needed the same four
  properties and got them without the JS dependency. Deferred rather than done
  because the import would shadow a live authored shortcut.
