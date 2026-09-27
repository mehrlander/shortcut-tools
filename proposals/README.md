# proposals

One file per proposed hand edit to a shortcut whose only copy is the phone,
written by `python3 tools/edit.py <Name> <chain> --after <line> --why "<reason>" --save`.

A proposal holds the shortcut's listing before and after, the address of the
cards to paste, the reason, and two action-type sequences: `base`, the shortcut
as exported, and `expect`, with the cards in place. web-tools'
`pages/shortcut-edit.html` (the app's Edits view) lists these files and reads
the newest export of each shortcut to mark it applied, not yet, or different.
A proposal is removed once it is applied.
