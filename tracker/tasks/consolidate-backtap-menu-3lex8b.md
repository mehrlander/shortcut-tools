---
id: consolidate-backtap-menu-3lex8b
title: Consolidate the Back-DoubleTap Shortcuts-app menu into a chooser
status: backlog
opened: 2026-08-26
size: S
---
# Consolidate the Back-DoubleTap Shortcuts-app menu into a chooser

`Back-DoubleTap`'s Shortcuts-app branch spends 20 actions on a seven-row
`Choose from Menu`, one `Run Shortcut` card per row. The same job is six
actions as a text list, a split, a `Choose from List`, and `Run-List`, which
resolves a name through Get My Shortcuts and runs the match. `Show-Loop`
already does this twice, in its View and Use branches.

Now cheap to attempt: the shortcut lives in the repo as
`workflows/back-doubletap.json` and installs in one tap through
`Library-Replace`, so this is an edit here rather than surgery on a phone.

Deliberately not done in the pass that recovered the shortcut (PR #22), because
it is not free and the cost is felt on every use:

- **"Working shortcuts" is not a shortcut.** It is
  `com.apple.shortcuts.OpenNavigationDestinationAction` against folder
  `492BC21E`, so joining a name list needs a one-action wrapper shortcut, and
  that is a second install.
- **The labels change.** `Run-List` needs the real name, so "Use recent"
  becomes `Use-RecentShortcut`. Aliasing means a two-column mapping, which
  brings the actions back.
- **The caption prompt.** `Run-Choice` has no prompt parameter, so routing
  through it drops the `Get-FileCaption` title. Spelling the picker inline
  keeps it, at six actions rather than four.

"Out" survives for free: `Run-List`'s regex wants a hyphenated, space-free
name under 30 characters, so a sentinel that fails the match is treated as a
plain parameter and nothing runs.

One thing it buys beyond brevity: input wiring becomes uniform. Today only
`Manage-Shelf` receives the clipboard, `Choose-Manage` receives the caption
and ignores it, and the other three receive nothing. A `Run-List` pipeline
hands the clipboard to all of them, which is inert for the four that ignore it.

**Done when** the menu branch is a chooser in `workflows/back-doubletap.json`,
the wrapper shortcut for the Working folder exists as its own chain, and the
result has been installed and used on the device.

## Progress log
- 2026-08-26: Filed. Analysis first done 2026-08-22 and carried since only in
  merged PR bodies, which is why it is a task now. Deferred out of PR #22 on
  the grounds above.
