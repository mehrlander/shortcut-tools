# workflows

Action chains as source. `{"label", "actions": [{"id", "p"}]}`, where `p` is
`WFWorkflowActionParameters` verbatim.

```bash
python3 tools/pack.py workflows/wiring-test.json   # prints a tappable link
```

Tapping runs `Copy-ActionFromClaude` on the device, which puts the actions on
the clipboard, ready to paste into any shortcut. Format in
[`docs/shortcuts-format-notes.md`](../docs/shortcuts-format-notes.md).

**Prefer the address to the payload.** `python3 tools/pack.py --publish` writes
every chain's payload to [`packed/`](../packed/), so a link can carry a URL
instead of several thousand characters of base64:

```
shortcuts://run-shortcut?name=Copy-ActionFromUrl&input=text&text=https://raw.githubusercontent.com/mehrlander/shortcut-tools/main/packed/<chain>.json
```

That is about 150 characters, it is legible, a wrong character 404s instead of
misreporting, and it tracks the branch rather than freezing a snapshot. The
embedded form remains correct and remains necessary for a payload that is not
committed or not public. `--check` fails when `packed/` is behind `workflows/`,
and the suite runs it.

| Chain | What it is for |
| --- | --- |
| `wiring-test` | Anchors at offset 0 and 15, one producer feeding two consumers. The regression test for variable binding. |
| `copy-action-from-claude` | The receiver itself, in the format it delivers. Self-hosting. |
| `js-data-url` | Runs JavaScript on device by coercing a `data:text/html` URL to rich text. |
| `menu` | Three cases under one `GroupingIdentifier`, modes 0/1/1/1/2. |
| `sync-xhr-probe` | Whether that coercion waits for the network, and for which kind of request. Two lines, one tap. |
| `gh-recent-branches` | The branches you last committed on, shown as a tappable list in the browser. Two actions: build the page, hand it to `Show-Html`. |
| `gh-recent-branches-picker` | The same page read back as text and fed to Choose from List. The fallback that needs no `Show-Html`, and the only chain still carrying inferred parameter shapes. |
| `run-by-name` | Whether Run Shortcut resolves a target from `WFWorkflowName` alone, with no device-local `WFWorkflow` dict. One tap: a page opens if it does. |
| `run-by-variable` | Whether that name can come from a variable rather than a literal. The gate on a generic `Run-Steps`, since a computed target is the whole point of one. |
| `dump-shortcuts` | Every shortcut on the device as one combined JSON, onto the clipboard. Two actions plus a copy, because `Use-Shortcut` already does the work. |
| `copy-action-from-url` | Fetches a packed payload and hands it to `Copy-ActionFromClaude`. Two actions, and the last one that ever has to arrive as an embedded payload. |
| `run-steps` | Runs named shortcuts in order, piping each result into the next. One shortcut instead of one per sequence, which only became possible once a variable could name the target. |
| `show-menu` | Renders whatever menu it is handed. Four actions: name the text `.vcf`, coerce it to contacts inside Choose from List, read the chosen row's Notes, open it. The receiver for `vcard.py --data`. |
| `run-html` | Renders whatever page it is handed. Three actions: base64-encode Shortcut Input, build the data URL, open it. The receiver for [`tools/show.py`](../tools/show.py) when the page needs no credential. |

`run-html` is the one chain here that is not a payload of its own. Paste it into
a new shortcut named `Run-Html` and it becomes the target of a `show.py` link,
which is the difference between the two delivery routes: the others are pasted
once and then run from the Shortcuts app, while `Run-Html` exists to be handed a
different page on every tap. `Show-Html` does the same job with credential
injection and text repair on top, so `Run-Html` is for pages that need neither.

Both branch chains carry the same page, and the page is written to serve both:
its visible text is only ever the list itself, and its rows are separated by
real newline characters rather than by block layout, so a text extraction
yields the same lines whichever way it reads the DOM.

They differ in who resolves the token. `Show-Html` injects on the way through,
so the chain that uses it hands over the page with the placeholder intact and
never mentions the injector. The picker has no such helper, so it calls
`Inject-🎟️GitHubToken` for itself. Injecting in both places is harmless and
still wrong: the second pass finds nothing to replace, and the action reads as
load-bearing to anyone who did not know that.

## Payloads live in `pages/`, not pasted into the chain

Anywhere a parameter takes a string, `{"$file": "pages/thing.html"}` reads that
file instead, resolved from the repository root. A chain that carries an HTML
payload therefore references the page rather than holding a copy of it, so the
page stays editable, testable in a browser, and reviewable as a diff. `pack.py`
resolves the directive before packing, so the plist only ever sees text.

```json
{ "id": "is.workflow.actions.gettext",
  "p": { "WFTextActionText": { "$file": "pages/xhr-probe.html" } } }
```

A missing path is a hard error rather than an empty payload, and a payload
containing a raw U+FFFC is refused, since it would arrive as an unbound anchor.

## Parameter shapes are load-bearing and only partly confirmed

`actions.json` holds a bare identifier for 772 of 810 actions, so a chain's `p`
is reconstructed rather than looked up. Three tiers apply here. The five actions
inherited from `js-data-url` are confirmed by a chain that runs. `runworkflow`
is confirmed against a real export, including the `WFWorkflow` dict and its
device-local `workflowIdentifier`, which a chain cannot invent and has to read
off the device it will run on. `run-html` is confirmed by a device run on
2026-08-11, which promotes `openurl` and the `ExtensionInput` attachment it
reads its page from out of the inferred tier, and a generated menu ran on
2026-08-12, which does the same for `choosefromlist` and its contact coercion.
`text.split` and `text.replace`, both in the picker chain only, are still
inferred from the documented naming, as are two keys nothing has yet exercised:
`WFChooseFromListActionPrompt`, and the `Notes` property `show-menu` reads the
chosen row's action from. A wrong key does not fail loudly. It
pastes an action with an empty field, which is a two-tap fix in the editor and
worth watching for on first run.

## Both probes ran, 2026-08-12

`WFWorkflowName` alone resolves, and it accepts a variable. Two things follow
and both are in this directory now.

**No chain here pins a target any more.** `gh-recent-branches` and its picker
carried a `WFWorkflow` dict holding a `workflowIdentifier` minted on one install,
which made them wrong on any other device. The dict is gone from both, and a
test refuses a new one.

**`run-steps` exists.** A list of shortcut names in, each one run with the
previous one's result as its input, the last result out. It is the thing that
ends the rule that a sequence needs a shortcut of its own: the verbs are named
shortcuts, and the program is a newline-separated list that can ride in a link.
`text.split` is the one inferred shape in it; everything else comes off exports.

## The two probes, and why they were worth a tap

`runworkflow` carries its target twice, and the second half is a
`workflowIdentifier` minted per install, which a chain written elsewhere cannot
invent. Every `runworkflow` in this repo therefore hardcodes an identifier read
off one device, and is wrong on any other. If the **name alone** resolves, that
constraint disappears and a chain becomes portable.

`run-by-variable` asks the harder half. `Open URLs` on a constructed
`shortcuts://run-shortcut?name=<computed>` already runs a shortcut chosen at run
time, but control leaves and nothing comes back, so it cannot be a loop body. A
`runworkflow` that accepts a variable name would return, which is what a generic
`Run-Steps` needs: one shortcut that takes a list of names and runs them in
order, with no new shortcut per sequence.

Both open a page through `Run-Html` when they succeed, so the result is legible
without reading anything. Failure is legible too and arrives earlier: a target
Shortcuts cannot resolve pastes as an action with an empty picker, visible in
the editor before the shortcut is ever run.
