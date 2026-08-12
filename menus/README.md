# menus

Menu specs. `{"label", "weight", "rows": [{"icon", "title", "subtitle"}]}`,
where `icon` is a [Phosphor](https://phosphoricons.com) name and `weight` is a
Phosphor weight (default `regular`).

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
