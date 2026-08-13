# menus

Menu specs. `{"label", "prompt", "file", "weight", "rows": [{"icon", "title", "subtitle", "actions"}]}`,
where `icon` is a [Phosphor](https://phosphoricons.com) name and `weight` is a
Phosphor weight (default `regular`). `prompt` titles the sheet; without it the
system supplies one, which reads "Which one?".

```bash
python3 tools/vcard.py menus/demo.json --out Choice.vcf
```

The output is one vCard per row, which Choose from List renders as an image,
a title, and a subtitle once the file has been through Get Contacts from Input.
Why the icons are baked here, and where the size went, is in the
[root README](../README.md#menus-with-icons).

`weight` is per-spec rather than per-row because a menu whose glyphs disagree
about stroke weight looks like a mistake. Phosphor names the regular weight
bare and suffixes every other one, which `vcard.py` handles; an unknown name
falls back to `question` rather than failing the build, so one bad name costs
one wrong glyph instead of the whole menu.

## Two ways to send one

`--data` hands the file to `Show-Menu`, a four-action runner already on the
device, so the link carries the menu and nothing else:

```bash
python3 tools/vcard.py menus/demo.json --data
```

That runner cannot hold per-row behavior, so each row carries its own as a URL
in its `action` field, written to the card's `NOTE` and read back as the chosen
contact's Notes. A row can therefore run a named shortcut, open a page, or open
an app, but it cannot inline an arbitrary action the way a chain can. In
exchange there is nothing to paste per menu: the link opens the menu directly.

The demo's four rows measure 2,868 characters as a `--data` link against 15,757
as a chain, and the difference is the whole chain shipping every time.

## The whole menu as a chain

`--chain` emits the file *and* the dispatch as a [`pack.py`](../tools/pack.py)
chain, so a spec becomes a tappable link:

```bash
python3 tools/vcard.py menus/demo.json --chain --out /tmp/menu.json
python3 tools/pack.py /tmp/menu.json
```

A row's `actions` are `{id, p}` pairs in the same vocabulary as
[`workflows/`](../workflows/), placed inside that row's branch. A row without
them is a legal empty branch, which is what a menu entry looks like before it
does anything. This is the route to use when a row must do something no URL can
name; otherwise prefer `--data`.

Nothing generated is committed. The spec is the source; the `.vcf`, the chain,
and the link are all built on demand, which is also why the icons can be
refetched at a different size, weight, or depth without a migration.

Sizes for the four-row demo: the `.vcf` is 2,234 bytes, and packed as a chain
the link is 15,757 characters. The gap is the packed route's own overhead, a
full plist document per action, base64'd and then percent-encoded.
