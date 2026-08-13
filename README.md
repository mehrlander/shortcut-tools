# shortcut-tools

Apple Shortcuts as source. A chain of actions is a JSON file, `pack.py` turns it
into a link that pastes real action cards onto the clipboard, and the format is
documented from measurement rather than guesswork.

```bash
python3 tools/pack.py workflows/<chain>.json --url    # a link that pastes it
```

## The tools

| Tool | What it does |
| --- | --- |
| [`pack.py`](tools/pack.py) | A chain to a tappable link. `--publish` writes [`packed/`](packed/), `--url` emits the short address form. |
| [`unpack.py`](tools/unpack.py) | An action copied out of the app back to repo source. The way to learn an unfamiliar parameter shape. |
| [`show.py`](tools/show.py) | A page to a link that renders it on device, compressed, with placeholders intact. |
| [`vcard.py`](tools/vcard.py) | A menu spec to a `.vcf` with baked icons, for the contacts-as-menu route. |
| [`index-dump.py`](tools/index-dump.py) | A dump zip to an index: what each shortcut is and what it calls. |
| [`survey.py`](tools/survey.py) | An index to a browsable tiering, plus `--dangling` for calls into names that no longer exist. |
| [`sketch.py`](tools/sketch.py) | A shortcut to indented pseudocode. 54 KB of XML becomes 1.8 KB you can read. |
| [`restore.py`](tools/restore.py) | An archived shortcut back to a paste link. The reason deleting from the device is safe. |
| [`harvest.py`](tools/harvest.py) | An archive to editable chain files, with bulk rename and the device-local pin dropped. |

## The documents

- [`docs/shortcuts-format-notes.md`](docs/shortcuts-format-notes.md) is the plist
  format as measured: control flow, variable binding, aggrandizements, the two
  attachment forms, what `Show-Html` and its injector actually do, and the
  condition codes the corpus pins. Every claim is dated and says how it was
  established.
- [`docs/idioms.md`](docs/idioms.md) is the design a 577-shortcut library turns
  out to have, read from the pseudocode: the self-demo prologue, the naming
  convention as a runtime type, one type system, JavaScript as the escape hatch.
  It also records the four claims that did not survive being checked.
- [`workflows/README.md`](workflows/README.md) is the chain catalog and the
  parameter-confidence tiers, which are now empty of inferences.

## The rules that keep biting

**Emit a link, never type one.** A payload link is thousands of characters and
a transcription error produces a link that works and misreports. `--url` and
`--publish` exist so a link carries a 150-character address instead.

**A page's own shell is served from the default branch.** `?use=` swaps only the
code a page loads. For a change to the page itself, toss it.

**Nothing device-local goes in a chain.** A `workflowIdentifier` or a `WFFile`
location is minted per install and wrong everywhere else. `WFWorkflowName` alone
resolves, so use it.
