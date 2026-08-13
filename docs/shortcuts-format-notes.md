# Shortcuts format notes

Working notes on the `.shortcut` plist format, written for the code in this
repo: the `actions.json` dictionary, the `Shortcut` builder in
[`shortcut.js`](../shortcut.js), and anything that consumes either.

**Provenance.** These findings were established across roughly two years of
working sessions (2024-07 to 2026-07) and are recovered here from that record
rather than from Apple documentation, which does not describe the file format.
Each section cites the chats it came from. Claims marked *observed* were
measured on device; claims marked *inferred* are the best available explanation
and have not been confirmed against Apple's implementation.

**What this file does not cover.** Delivering a composed action to a device as a
tappable `shortcuts://` link, the compact `{id, p}` action format, the U+FFFC
inline-variable anchor and its `&#65532;` entity rule, and the pasteboard UTI
requirement are all owned by the `apple-shortcuts-actions` skill in
`mehrlander/web-tools`. That is the delivery layer; this is the file-format
layer underneath it. Do not restate either one in the other.

---

## Control flow is three actions sharing a UUID

A block is not nested in the file. It is a flat run of sibling actions, opened
and closed by entries that carry the same `GroupingIdentifier` and differ only
in `WFControlFlowMode`:

| Mode | Role |
| --- | --- |
| `0` | Open the block (the `If`, the `Repeat`, the menu) |
| `1` | A middle marker: the `Otherwise` of a conditional, or one menu case |
| `2` | Close the block |

A conditional carries its condition on the mode-0 entry only. The mode-1 and
mode-2 entries hold nothing but the `GroupingIdentifier`; they are pure
markers. A menu differs in one way that matters: it emits one mode-1 entry per
case, each with its own `WFMenuItemTitle`, so a three-item menu is five
actions.

Source: [Apple shortcuts serialization with XML plist format](https://claude.ai/chat/549d7c6a-c507-4ff8-b365-b8b9298509fb)
(2026-03-20), reading three exported plist fragments of one If/Otherwise/End
block that shared `GroupingIdentifier` `A7708770-4D68-41BE-B91B-F9E3CB301AE6`.

### The consequence for this repo

`Shortcut.add()` could not build a block, and used to try anyway. 38 entries in
`actions.json` carry a `WFControlFlowMode`, and **not one carries a
`GroupingIdentifier`**, so nothing `add()` could read would let it pair a block.
Before the guard, `add('repeat')` emitted a mode-0 opener with no grouping and
no closer, and `add('choosefrommenu')` took `variants[0]` and silently dropped
the two other variants stored under that key.

`add()` now refuses any action whose resolved variant is control flow, naming
the helper to use instead. The dedicated helpers (`ifBegin`/`otherwise`/`ifEnd`,
`repeatBegin`/`repeatEnd`, `menuBegin`/`menuItem`/`menuEnd`, and the
`ifElse`/`repeat`/`menu` wrappers) mint a shared `GroupingIdentifier` and are
the correct path. `addRaw()` remains the deliberate bypass.

The 30 pre-configured conditionals in the dictionary (`ifclipboardcontains`,
`ifcurrentdateisbefore`, and the rest) are all
`is.workflow.actions.conditional` with a pre-filled `WFInput` and
`WFCondition`, so `ifBegin` takes one by name as a preset and `ifEnd` closes it
unchanged:

```js
s.ifBegin({}, 'ifclipboardcontains')
```

## Variable references bind by producing UUID

A variable reference is not a name lookup. The consuming action carries an
`OutputUUID` that must equal the `UUID` of the action that produced the value.
When building from scratch, mint the UUID once and write it into both places.

Conditions are integers, not strings. The full mapping below is derived
mechanically from the 30 pre-configured conditionals in `actions.json`, by
reading each one's `WFCondition` against the operator its name states, so it
rests on the dataset rather than on recollection:

| `WFCondition` | Operator | Derived from |
| --- | --- | --- |
| `0` | is before | `ifcurrentdateisbefore`, `ifcurrenttimeisbefore` |
| `2` | is after | `ifcurrentdateisafter`, `ifcurrenttimeisafter` |
| `4` | is | `ifclipboardis`, `ifcurrentappis`, `ifcurrentdateisexactly` |
| `5` | is not | `ifclipboardisnot`, `ifcurrentappisnot` |
| `8` | begins with | `ifclipboardbeginswith` |
| `9` | ends with | `ifclipboardendswith` |
| `99` | contains | `ifclipboardcontains` |
| `100` | has any value | `ifclipboardhasanyvalue`, `ifcurrentdatehasanyvalue` |
| `101` | does not have any value | `ifclipboarddoesnothaveanyvalue` |
| `999` | does not contain | `ifclipboarddoesnotcontain` |
| `1000` | is in the next | `ifcurrentdateisinthenext`, `ifcurrenttimeisinthenext` |
| `1001` | is in the last | `ifcurrentdateisinthelast`, `ifcurrenttimeisinthelast` |
| `1002` | is today | `ifcurrentdateistoday` |
| `1003` | is between | `ifcurrentdateisbetween`, `ifcurrenttimeisbetween` |

**One conflict, left standing rather than resolved.** The chat cited above read
`4` as *is greater than* on a numeric comparison; the dictionary has `4` as *is*
on date, app, and clipboard comparisons. Both readings could hold if the integer
is interpreted against the input's type, which would mean there is no single
table. The derived column is the one to trust for the operators it covers, and
numeric comparison is not among them.

Sources: the chat above for the mechanism, `actions.json` for the table.

## Two attachment forms, and the aggrandizements

*Observed 2026-08-10, from actions copied off the device and read back with
`plistlib`.*

A token **inside a string** uses `WFTextTokenString` with `attachmentsByRange`,
keyed by offset. A token that **is** the whole value uses
`WFTextTokenAttachment`, with no offset:

```json
"WFInput": { "Value": { "OutputUUID": "…", "Type": "ActionOutput", "OutputName": "…" },
             "WFSerializationType": "WFTextTokenAttachment" }
```

`Type` is `ActionOutput` for another action's output, `ExtensionInput` for
Shortcut Input. Either `Value` may carry `Aggrandizements`, which reach into it
without spending an action:

| Aggrandizement | Field | Does |
| --- | --- | --- |
| `WFDictionaryValueVariableAggrandizement` | `DictionaryKey` | Take one key from a dictionary |
| `WFCoercionVariableAggrandizement` | `CoercionItemClass` | Coerce. `WFStringContentItem` gives text; `WFRichTextContentItem` on a `data:text/html` URL renders the page, which runs its JavaScript |

Offsets count the rendered string, so `"The text said: ￼"` anchors at `{15, 1}`.
Several consumers may share one producer.

**Aggrandizements chain, in array order.** One attachment may carry a coercion
and then a key lookup, which is how a file becomes a dictionary and then one of
its values without spending an action on either step:

```json
"Aggrandizements": [
  { "Type": "WFCoercionVariableAggrandizement", "CoercionItemClass": "WFDictionaryContentItem" },
  { "Type": "WFDictionaryValueVariableAggrandizement", "DictionaryKey": "🎟️GitHubToken" }
]
```

## Run Shortcut names its target twice, and the second half is optional

*Observed 2026-08-10 from an exported shortcut; the constraint retired
2026-08-12 by two probes that ran.*

`is.workflow.actions.runworkflow` names its target in two places:

```json
"WFWorkflowName": "Show-Html",
"WFWorkflow": { "isSelf": false,
                "workflowIdentifier": "84B4AB5F-02B8-426D-BF6A-E051730CC0E4",
                "workflowName": "Show-Html" }
```

Every export read carries both, and `workflowIdentifier` is minted per install,
which made the dict look load-bearing and a chain written elsewhere look
unportable. **It is not.** Two things are now measured, by
[`run-by-name`](../workflows/run-by-name.json) and
[`run-by-variable`](../workflows/run-by-variable.json), each pasted and run:

1. **`WFWorkflowName` alone resolves.** With no `WFWorkflow` dict at all, Run
   Shortcut finds the target by name. So a chain can call a shortcut on a device
   it has never seen, and nothing here needs an identifier read off an export.
2. **The name may be a variable.** `WFWorkflowName` accepts a `WFTextTokenString`
   with an attachment, so the target can be computed at run time.

The second is the one that changes what is buildable, and it is invisible from
inside the app: the editor offers a shortcut picker with no variable slot, so the
documented workaround is to fetch every shortcut, filter by name, and run the
survivor. The format needs none of that. **The picker is a limit of the UI, not
of the file**, which is worth holding onto generally, since this file exists to
describe the file rather than the editor.

A shortcut that calls **itself** still sets `isSelf` true, which is how one
shortcut can be both a library and its own demo caller.

*Unconfirmed:* what happens when two shortcuts share a name, and whether a name
that does not resolve fails loudly at run time or silently does nothing.

## An `If` with several conditions uses a different shape entirely

*Observed 2026-08-10, from an exported shortcut.*

The single-condition form documented above puts `WFCondition`, `WFInput`, and
`WFConditionalActionString` directly in the action's parameters. A **multi**
-condition `If` replaces all three with one `WFConditions` key holding a
`WFContentPredicateTableTemplate`, whose `WFActionParameterFilterTemplates` is
an array of the single-condition shape, each with its own `WFInput`:

```json
"WFConditions": {
  "WFSerializationType": "WFContentPredicateTableTemplate",
  "Value": { "WFActionParameterFilterPrefix": 0,
             "WFContentPredicateBoundedDate": false,
             "WFActionParameterFilterTemplates": [ { "WFCondition": 4, "…": "…" },
                                                   { "WFCondition": 8, "…": "…" } ] }
}
```

Each template may test a **different** input, which is what makes this more than
a convenience: one `If` can ask whether the item's type is `URL` *and/or*
whether its markdown begins with `http`.

*Unresolved:* whether `WFActionParameterFilterPrefix` `0` means all or any. The
observed instance is true under both readings, so it does not discriminate, and
guessing here would be worse than leaving it open.

## `Show-Html`: what it does to a page on the way through

*Observed 2026-08-10, from an export.* Device-local
`workflowIdentifier` `84B4AB5F-02B8-426D-BF6A-E051730CC0E4`.

It is the general-purpose page runner behind this route, and its contract
matters to anything that calls it:

- **Input** is HTML text, a URL, or nothing. A URL is downloaded first, by the
  multi-condition `If` above; nothing falls back to the clipboard through the
  top-level `WFWorkflowNoInputBehavior` key, `WFWorkflowNoInputBehaviorGetClipboard`.
- **It calls `Inject-🎟️GitHubToken` itself.** A caller that injects first is
  doing nothing, since the second pass finds no placeholder. Hand it the page
  with the placeholder intact.
- It substitutes a second placeholder, `📋ClipboardBase64`, with the clipboard
  base64-encoded, so a page can carry the clipboard into itself.
- It repairs smart quotes and strips markdown code fences, which is what makes
  a page pasted out of a chat window work without hand-cleaning.
- **It opens the result with `Open URLs`, not an in-app view.** The page lands
  in the browser, so it is fully interactive: links navigate, and async work has
  no capture moment to race.
- **It returns the cleaned HTML**, wrapped in a one-item `is.workflow.actions.list`.
  Not a result from the page. Nothing useful chains after it.

Two details worth carrying. The data URL it builds is
`data:text/html;charset=utf-8, ￼` with a **space** after the comma, anchoring at
offset 37 rather than 36, so whitespace there is tolerated;
[`js-data-url`](../workflows/js-data-url.json) omits it and also works. And one
of its five `Replace Text` actions, the one stripping `^```\w*\n|```$`, has its
output referenced by nothing: the next action reads the same producer it does.
The later ` ```\s* ` pass covers the same ground, so the effect is invisible.
Flagged rather than fixed, since it is not this repo's shortcut, and since the
note above about vestigial-looking actions counsels confirming on device first.

## The token-injection pattern

*Observed 2026-08-10, from `Inject-🎟️GitHubToken`.*

Secrets do not belong in a chain, and a page delivered as a `data:` URL is
nothing but a string, so the token is substituted into that string on device
just before the page is encoded. The mechanism, worth copying because it
generalizes past GitHub:

- The placeholder is an **emoji-prefixed key**, `🎟️GitHubToken`. The emoji is
  what makes it collision-proof against the page's own text without needing a
  quoting convention.
- One shortcut owns the substitution. Given text containing the placeholder
  (`WFCondition` 99, *contains*), it opens `Snippets/Managed/config.json` from
  the Shortcuts iCloud folder with `documentpicker.open` and a `WFGetFilePath`,
  coerces the file to a dictionary, takes the key of the same name through the
  chained aggrandizements above, and runs `text.replace`.
- Given **no** input at all (`WFCondition` 101, *does not have any value*) the
  same shortcut runs a demo of itself instead. The two branches are sequential
  top-level `If`s with no `Otherwise`, which is the compact-`If` switch that
  [`dataflow.md`](dataflow.md) describes, in the wild.
- The stored value carries its own scheme, so the page writes
  `Authorization: <placeholder>` rather than `'Bearer ' + placeholder`.

Two rules follow for any page written against this, and
[`test/gh-branches.test.js`](../test/gh-branches.test.js) holds both:

1. **Build the sentinel from halves.** A page that wants to know whether it was
   substituted cannot compare against the literal, because the substitution
   rewrites the comparison too. Write `'🎟️' + 'GitHubToken'`.
2. **The placeholder appears exactly once, comments included.** Naming the
   injector in a comment is enough to paste the live token into that comment.
   Caught by the test rather than by review.

## Injection reaches a compressed page, through the wrapper rather than into it

*Measured 2026-08-11, in headless Chromium.*

A page can be delivered gzipped, wrapped in a small uncompressed shell that
inflates it in the browser ([`tools/show.py`](../tools/show.py),
[`tools/gz-shell.html`](../tools/gz-shell.html)). Injection and compression look
mutually exclusive at first, since the injector substitutes by text replacement
and a gzip stream has no text in it. They are not: the **shell** is text, so it
carries the placeholder, takes the substitution, and applies it to the page after
inflating. The page's own source is unchanged either way, which is what keeps one
page servable by both routes.

Three constraints follow, and the first is the trap:

1. **The shell needs both halves of the pair, and only one may be literal.** The
   value slot is the literal placeholder, which the injector rewrites; the search
   key is the same string written as `\u` escapes, which it cannot see. Written
   whole, the key is rewritten too and the substitution finds nothing. Generating
   the key with `json.dumps(placeholder)` rather than typing the escapes keeps the
   two from drifting.
2. **Carry only the placeholders the page uses.** A shell that carries all of them
   hands the live token to a page with no use for it.
3. **The wrapper's own comments are not free.** They ship inside the link and cost
   about 1,800 characters, more than the compression saves on a small page, so
   `show.py` strips them at build time.

Rendering the result is a real navigation, not a webview: a `data:text/html`
URL carrying the shell inflates, substitutes, and runs the page's own script,
confirmed by dumping the DOM out of headless Chromium. `DecompressionStream` is
Safari 16.4 and later; a device below that needs the page sent raw.

**Confirmed on device 2026-08-11**, by pasting `run-html` into a shortcut named
`Run-Html` and tapping a `show.py` link carrying
[`xhr-probe`](../pages/xhr-probe.html). It reported `sync: 200, 33 bytes` and
`async: 33 bytes`, replacing the static text the page ships with, so Safari
inflated the payload, `document.write` produced a document whose script ran, and
that script reached the network both ways. The chain's three actions are
confirmed by that run, `ExtensionInput` among them.

**The substitution half is confirmed too, 2026-08-12**, by tapping a `show.py`
link for [`gh-recent-branches`](../pages/gh-recent-branches.html) through
`Show-Html`. The branch list rendered with no prompt, which is the tell: the page
compares its token against a sentinel built from halves and shows a paste-a-token
form when they still match, so a list can only appear if something replaced the
placeholder. Nothing on device can reach into the gzip stream, so what it
replaced was the copy in the shell, and the shell carried it into the page after
inflating. The whole route is now measured on device rather than in Chromium.

That run also exposed a defect nothing else would have: **the page's own branch
was missing from the page.** A Claude Code session commits as
`Claude <noreply@anthropic.com>`, which GitHub resolves to the `claude` account,
so a branch an agent pushed failed the viewer-is-the-author test and was dropped
as someone else's. The identity is not uniform across checkouts, which is what
made the omission read as staleness rather than as a filter: in the same
container, `web-tools` commits under the viewer's own noreply address and its
agent branches were listing normally.

## A menu with icons is a list of contacts, coerced in place

*Observed 2026-08-12, from an export.*

`Choose from List` shows one plain line per row. Given **contacts** it shows an
image, a title, and a subtitle, so a `.vcf` is how a native menu gets an icon.
Three steps make that work and two of them are not guessable:

1. **`Set Name` to something ending `.vcf`.** The extension is the only type hint
   the next step has.
2. **`Choose from List` coerces the named text itself**, through a
   `WFContactContentItem` aggrandizement on its own `WFInput`. There is no Get
   Contacts from Input action anywhere in the chain. Same mechanism as the rich
   text and dictionary coercions above; contacts is simply another member.
3. **The choice reads back through `Last Name`**, a
   `WFPropertyVariableAggrandizement` on the Chosen Item. This is why the cards
   are written `N:<title>;;;;`: vCard's `N` is
   `family;given;additional;prefix;suffix`, so the title has to sit in the family
   slot to be readable as Last Name. It looks like a sloppy field choice and is
   load-bearing.

The dispatch is then one flat `If` per row with no `Otherwise`, which is the
compact-`If` switch [`dataflow.md`](dataflow.md) describes, and a row that does
nothing yet is still a legal empty branch.

**Confirmed on device 2026-08-12**, from a menu generated by `tools/vcard.py`
and delivered through the paste route: four rows rendered with icon, title, and
subtitle, and the dispatch fired. Without `WFChooseFromListActionPrompt` the
sheet is titled by the system, which asks "Which one?".

**A packed card cannot carry CRLF.** vCard says lines end `\r\n`, but a plist is
XML and XML normalizes a literal CR in text content away on read, so a card
written with CRLF does not survive a pack and reparse. `tools/pack.py` asserts
its own round trip, so this fails loudly instead of shipping a payload that
quietly changed. The export this was read from stores its cards with plain
newlines, which is both the workaround and the evidence that Apple's parser
accepts them. `tools/vcard.py` keeps CRLF in the standalone `.vcf` it writes and
converts on the way into a chain.

**A menu ships its own images, so the encoder is the size story.** A glyph is two
colors and a browser's canvas encoders are built for photographs, so neither of
its outputs is the right one. Measured per row across four icons at 128px, as
base64: 2,594 bytes for JPEG at q0.8 with the profile stripped, 1,172 for 8-bit
grayscale PNG, 425 for 1-bit PNG, all three indistinguishable at list size
because the display downsamples 128px to about 44 and averages the aliasing
away. `tools/vcard.py` therefore reads raw pixels out of the canvas and writes
the PNG itself. Worth knowing separately: canvas embeds a **472-byte ICC
profile** in every JPEG, 14% of a 128px glyph, describing a color space a black
shape on white does not use.

## `Type: "Ask"` is the fourth attachment value

*Observed 2026-08-12, from a copied action.*

The `Value` inside a `WFTextTokenAttachment` carries a `Type`, and the table
above lists `ActionOutput`, `ExtensionInput`, and `Variable`. There is a fourth:
**`Ask`**, which is the editor's *Ask Each Time*, and it needs nothing but the
type.

```json
"Folder": { "Value": { "Type": "Ask" }, "WFSerializationType": "WFTextTokenAttachment" }
```

That example is the one that matters here: `is.workflow.actions.getmyworkflows`
takes a **`Folder`** parameter, which nothing in `actions.json` reveals, since
the dictionary holds a bare identifier for it. So the library can be dumped a
folder at a time with no filtering logic, and `Ask` is how the chain defers the
choice to run time rather than hardcoding a folder that only exists on one
device.

Worth generalizing: a parameter that is absent from a chain is not necessarily a
parameter the action lacks. Copying the action out of the editor and reading it
with `tools/unpack.py` is the only way to see the full set.

## Do not index the property names, just compress

*Measured 2026-08-12, over 72 real actions in the JSON shape a dump carries.*

A shortcut's JSON is dominated by long repeated keys, so replacing them with
short tokens looks like the obvious saving. It is not:

| | Bytes | Of raw |
| --- | ---: | ---: |
| raw JSON | 42,016 | 100% |
| property names indexed | 33,486 | 80% |
| gzipped | 6,971 | 17% |
| indexed, then gzipped | 7,117 | 17% |

Indexing first makes the result **slightly larger**. Deflate replaces each repeat
of `WFWorkflowActionIdentifier` with a back-reference already, and long repeated
strings are what it handles best; swapping them for `$7` removes the redundancy
it feeds on and adds a table to carry. The saving is real only if the payload is
never compressed, which on any of these routes it is.

## A shortcut exports itself through Get File of Type

*Observed 2026-08-12, from `Use-Shortcut`.*

There is no export action, and nothing in the dictionary is named for one. The
mechanism is a coercion in disguise: `is.workflow.actions.gettypeaction` with
`WFFileType` set to **`com.apple.plist`** turns a shortcut item into that
shortcut's plist, and **`public.json`** turns it into JSON. Fed a shortcut from
`is.workflow.actions.getmyworkflows`, it is a complete unsigned export, with no
iCloud link, no signing step, and no Mac.

Two consequences worth having:

- **A whole library dumps in one pass.** `Get File of Type` vectorizes over a
  list, so `getmyworkflows` into `public.json` yields one file per shortcut, and
  a combiner folds them into a single document.
- **The name is not in the file.** A shortcut's plist has no field naming it, so
  the name lives only in the item's file name. Anything that flattens a list into
  one blob has to carry names itself or lose them.

The iCloud route is the other half of the same shortcut and answers a different
question. `https://www.icloud.com/shortcuts/<id>` rewritten to
`https://www.icloud.com/shortcuts/api/records/<id>` returns a record whose
`fields.name.value` is the shortcut's name, which is how a shared link becomes a
name that `getmyworkflows` can then be filtered against.

## The library settles four inferred shapes

*Measured 2026-08-13, across ten folder dumps: 211 shortcuts, 5,905 actions.*

A dump is not only a backup. It is a corpus of working actions, and reading it
against this repo's chains promotes four shapes out of the inferred tier, where
a wrong key would have pasted an action with an empty field.

**`Show-Menu` exists on the device and matches `workflows/show-menu.json`
action for action**, including the two keys nothing had exercised: the
`WFPropertyVariableAggrandizement` reading `PropertyName: "Notes"` with
`PropertyUserInfo: 1`, and the contact coercion feeding `choosefromlist`. The
device version is five actions to our four, the extra one a trailing
`showresult` that displays the URL it just opened. Nothing else differs.

**`WFChooseFromListActionPrompt` is real**, carried by `vCard 64bit` as
`"Choose one"` beside `WFChooseFromListActionSelectMultiple: false`.

**`text.split` and `text.combine` take their input under a lowercase `text`
key**, not `WFInput`, and `WFTextSeparator` takes a display string. Three
values appear across 22 uses: `New Lines`, `Spaces`, and `Custom`, the last
paired with `WFTextCustomSeparator`. The chains here already wrote
`"New Lines"` and are correct.

**`text.replace` has five keys and every one is optional.** Across 76 uses,
twelve distinct key subsets appear: `WFReplaceTextFind` alone is a valid
action, and `WFInput`, `WFReplaceTextReplace`,
`WFReplaceTextRegularExpression`, `WFReplaceTextCaseSensitive`, and
`CustomOutputName` each come and go independently. An omitted key is the
editor's default, not a malformed action.

One shape the corpus adds that this repo did not have: **aggrandizements
chain.** `Get-vCardChoice` feeds `choosefromlist` a coercion to
`WFContactContentItem` *followed by* `PropertyName: "Phone Numbers"` with
`PropertyUserInfo: 3`, in one `Aggrandizements` array. That is how a menu
displays a field other than the name while still being a contact list, and it
is the general form of the single-element arrays used throughout this repo.

## `Show-Html` and the injector, read rather than described

*Read 2026-08-13 from the exports, after fourteen folder dumps closed the gap.
Everything in this repo about these two was previously inferred from behavior.*

`Show-Html` is 23 actions in five stages, and the order is the part that
matters, since each stage assumes the previous one ran:

1. **Accept a page or a URL.** `getitemtype` and `getmarkdownfromrichtext`
   feed a two-condition `If` (`WFCondition: 4` on type `is` `URL`, OR
   `WFCondition: 8` on the text `begins with` `http`, joined by
   `WFActionParameterFilterPrefix: 0`). A URL is fetched with `downloadurl`;
   anything else is used as given. Both branches land in a `content` variable.
2. **Inject the token** by calling `Inject-🎟️GitHubToken` on `content`.
3. **Inject the clipboard.** `base64encode` of `{"Type": "Clipboard"}` with
   `WFBase64LineBreakMode: "None"`, replacing `📋ClipboardBase64`.
4. **Repair the text.** Four regex `text.replace` actions: `“|”` → `"`,
   `‘|’` → `'`, and two fence strippers.
5. **Open it.** `base64encode`, then a `gettext` holding the literal
   `data:text/html;charset=utf-8;base64, ￼` with the anchor at offset **37**,
   then `url`, then `openurl`.

Three things follow that were not knowable from outside.

**The repair runs after both substitutions**, so an injected value passes
through the smart-quote and fence rules. Base64 is safe by alphabet, but a
token or a page fragment carrying a curly quote would be rewritten.

**There is a literal space after the comma** in the data URL, which is why the
anchor sits at 37 and not 36. Browsers ignore whitespace in a base64 data URL,
so it works. `workflows/run-html.json` writes the prefix without the space and
anchors at 36, which is the tighter form and equally correct.

**One of the four repairs is dead.** Actions 15 and 16 both read action 14's
output, and action 17 encodes action 16's. Action 15, the one stripping
`^```\w*\n|```$`, feeds nothing. The surviving fence rule is `` ```\s* ``,
which is broader, so nothing is visibly broken; the anchored rule simply never
runs. This is what a dangling branch looks like in the plist, and it is
invisible in the editor, where both actions read as consecutive steps.

### The injector is a dictionary lookup against a config file

`Inject-🎟️GitHubToken` is ten actions, and the working half is four:

```
If  Shortcut Input (as string)  contains  "🎟️GitHubToken"      WFCondition: 99
  Get File   Shortcuts/Managed/config.json                     documentpicker.open
  Replace    "🎟️GitHubToken"  with  <config.json>["🎟️GitHubToken"]
End If
```

The file is reached by `is.workflow.actions.documentpicker.open` with
`WFGetFilePath: "config.json"` and a `WFFile` location of
`{"WFFileLocationType": "Shortcuts", "displayName": "Managed"}`, which is the
app's own iCloud folder rather than a picker prompt. The replacement value is a
second aggrandizement chain: coerce to `WFDictionaryContentItem`, then
`DictionaryKey: "🎟️GitHubToken"`.

**So the placeholder is a config key, not an arbitrary sentinel.** The emoji
name is doing real work: it is simultaneously the string a page carries, the
string `WFReplaceTextFind` matches, and the key looked up in `config.json`. The
mechanism generalizes to any credential, but this shortcut does not: the find
string and the key are both literals, so a second credential needs a second
shortcut, or a rewrite taking the key as input.

The other six actions are the self-demo idiom below.

## Every verb demos itself, and it shows up as a self-call

*Measured 2026-08-13 across 579 shortcuts.*

**55 shortcuts call themselves**, and almost all for one reason. The opening
action is `If Shortcut Input <WFCondition: 101>`, and the branch builds a sample
and runs the shortcut on it:

```
If  Shortcut Input  <101>
  Text        <a sample payload>
  Run Shortcut  <self>       WFWorkflow: {"isSelf": true, …}
  Run Shortcut  Show-Html            (or Stop and Output)
  Stop and Output
End If
<the real body>
```

Run it from the Shortcuts app with nothing selected and it demonstrates itself;
run it from another shortcut and the branch is skipped. `Inject-🎟️GitHubToken`,
`Get-FromJs`, `Fetch-Data`, `Combine-JsonList`, `Use-Shortcut`, and `Show-Loop`
all open this way.

That explains two things the index reports. A self-call is a demo, not
recursion, so `calls: Run-List` on `Run-List` is noise. And a shortcut appearing
under **called by nothing** is often an entry point precisely because it is
runnable alone.

`isSelf: true` in the `WFWorkflow` dict is how the export marks the self-call.
Since `WFWorkflowName` alone resolves a target, a chain can write the same thing
without it.

### Condition codes seen in the corpus

Three are pinned by the strings beside them. Two are not.

| Code | Meaning | Uses |
| ---: | --- | ---: |
| 4 | `is` | 326 |
| 101 | a value test, no string, gates absent-input branches | 132 |
| 100 | the same shape as 101 | 130 |
| 99 | `contains` | 83 |
| 8 | `begins with` | 68 |

`100` and `101` both take no `WFConditionalActionString` and both appear on
branches handling missing input, so which is `has any value` and which is its
negation is not settled by reading alone. Do not guess: copy the pair from a
working export, or set it in the editor and read it back.

## The packed route inverts the glyph rule

*Observed 2026-08-10.*

Delivering actions as base64 plist XML ([`tools/pack.py`](../tools/pack.py))
carries the **raw U+FFFC glyph**. The `&#65532;` entity exists only because a
browser render strips the glyph, and this route has no browser in it. Where a
payload does cross a rendered page, the entity rule still holds.

**The party retyping the link may be the agent, not a person.** *Observed
2026-08-12, three times in one session.* The rule against shortening or editing
a link was written for a human with a copy buffer. An agent has none: every
character of a reply is generated, so a few thousand characters of opaque base64
is a place where a plausible substitution can be made and not noticed. In all
three cases the corruption landed in the `report` string at the tail, the actions
at the head pasted correctly, and the only symptom was a banner reading
`RHVtcC1TaG9ydGN1dHM=` where it should have read `Dump-Shortcuts`, which is that
label's own base64.

Two things follow. The payload is **verified before it is sent and unverifiable
after**, since nothing can read back what was emitted; `--verify` checks the
generator, not the transcription. And a legible payload is safer than an opaque
one for this reason alone, which is a point in favor of the `--data` routes:
corruption in a vCard or a page is visible to the reader, corruption in base64 is
not. Making the receiver check a length or digest would close it properly.

Three more from the same day. Shortcuts **remints every UUID on paste**,
rewriting references consistently within one paste but not across pastes, so a
patch cannot address an action already in the shortcut; replace whole units.
`Set Name` does not vectorize over a list, while base64 decode and `Get File of
Type` do. And two real shortcuts both carry `WFWorkflowClientVersion` `4711`,
against the `2302.0.4` that `shortcut.js` hardcodes.

## `actions.json` values are newline-delimited JSON, not JSON

The README's per-value description is accurate for 809 of 810 entries. The
exception is real and will break a naive consumer:

```js
JSON.parse(actions.choosefrommenu)   // throws: Extra data
```

`choosefrommenu` holds three JSON objects separated by `\n`, being the menu
opener and two sample cases. This repo's own loaders already handle it, in
`parseActionValue`, which splits on `\n` before parsing. Anything else reading
the file must do the same. Note that the stored variants are an incomplete
example rather than a template: there is no mode-2 closer among them.

Counted from the file as committed: 810 entries, 321 under
`is.workflow.actions`, 43 distinct bundle prefixes, 1 multi-variant entry, and
38 carrying a `WFWorkflowActionParameters` block.

Those 38 are worth naming precisely, because the set is not what "parameter
templates" suggests. They are **exactly** the 38 entries carrying a
`WFControlFlowMode`: the block openers, closers, and the 30 pre-configured
conditionals. The two sets are identical, verified in
`test/actions.test.js`. So the dictionary carries no parameter examples for
ordinary actions at all; 772 of 810 entries are a bare identifier and nothing
more. Anything needing a real parameter shape has to get it from an exported
action, by the method the `apple-shortcuts-actions` skill describes.

## The Run JavaScript action has a performance cliff

Anyone generating a `Run JavaScript on Web Page` action needs this, because the
failure is a multi-second stall rather than an error.

*Observed:* small, semantically irrelevant edits push a script from instant to
roughly a three-second delay. Declaring a `const` for a value used once was
enough to trigger it. So was `Object.entries()`, `.sort()`, `.reduce()`, and
destructuring inside a `.filter()` callback. Repeating an already-fast pattern
twice in one script was also enough, which is why the cliff is not simply a
function of how much work the script does.

*Inferred:* the Shortcuts JavaScript environment runs JavaScriptCore without
JIT compilation, so the script is interpreted rather than compiled and parsing
overhead scales with source length. This explanation is plausible and matches
the symptoms; it has not been confirmed.

The working discipline that came out of it: keep the whole transformation in one
expression, prefer repeating a cheap accessor over binding it to a variable, and
avoid object-to-array conversions. Code written this way looks worse than normal
JavaScript, on purpose.

Sources: [Apple Shortcuts JavaScript performance fast-path discovery](https://claude.ai/chat/1742ec65-706f-4515-babc-d12c37cd9468)
(2025-09-14) and the same-day Gemini session `gemini-session/134`.

## Some actions are load-bearing without appearing in the data flow

A share-sheet shortcut carried a `Get Type` action coercing the extension input
to RTF whose output UUID appeared in no downstream parameter. Deleting it froze
the shortcut.

*Inferred:* the runtime needs the extension input's type claimed before another
action will consume it, so the coercion is scaffolding rather than a step.

The practical rule: an action that looks vestigial by UUID reference is not
proven dead. Before removing one, confirm on device.

Source: [Share Sheet shortcut for link summaries](https://claude.ai/chat/ae95bca5-a719-4e63-91a4-a5387c138b2f)
(2026-03-28).

## Values crossing the Shortcuts-to-JavaScript boundary get text-coerced

When a list reaches a `Base64 Encode` action without being coerced to a single
string first, Shortcuts can encode per item and produce a list of base64
strings, which the following text interpolation then joins with newlines. The
receiving JavaScript sees one string that `atob` will decode as a concatenated
smear, because `atob` ignores whitespace. Nothing errors; the output is
gibberish.

Coerce explicitly (a `Combine Text` step) rather than relying on the implicit
join, or split on `/\s+/` on the JavaScript side and treat each chunk
separately.

Source: [Decoding siriZipped base64 and bplist parsing](https://claude.ai/chat/1600e47e-7680-49f9-bda2-98d92223f175)
(2026-04-29).

## The data: URL route can reach the network, and the capture moment is the risk

*Measured 2026-08-10, in Chromium rather than on device.* A page delivered as
`data:text/html;charset=utf-8;base64,…` and read back through a
`WFRichTextContentItem` coercion runs its JavaScript, which
[`js-data-url`](../workflows/js-data-url.json) already showed. The open question
was whether a page that also fetches something can work this way, since the
coercion captures rendered text at a moment nobody has written down.

Two things are settled, and both were tested against a real `data:` URL rather
than a local file, because the origin differs:

- **A cross-origin request from a `data:` URL is allowed** where the server sends
  `Access-Control-Allow-Origin: *`, which the GitHub API does. The opaque origin
  does not block it. Sending credentials as an `Authorization` header is fine;
  `credentials: 'include'` would not be.
- **A synchronous `XMLHttpRequest` blocks the load**, so the response is in the
  DOM before anything downstream can read the page. This is the reason to prefer
  the deprecated synchronous form here: the behavior it is deprecated for is
  exactly the guarantee this route needs.

*Unconfirmed:* whether an **async** resolution lands before the coercion reads
the page. If it does not, an `await` yields an empty result with no error, which
is the worst failure shape available. Until someone runs
[`sync-xhr-probe`](../workflows/sync-xhr-probe.json) on a device, which reports
both paths on separate lines from one tap, write the request synchronously.

The same page was run on device 2026-08-11 through `Run-Html`, and reported both
paths resolved. **That is not an answer to the question above**, and the reason
is worth stating so the result is not mistaken for one later: `Run-Html` opens
the URL in Safari, where the page is simply loaded and there is no capture
moment for anything to race. The coercion is the whole subject here, and only the
five-action probe exercises it. What the device run does settle is the browser
half: a cross-origin request from a `data:` URL works on device, not only in
Chromium.

One layout trap, distinct from timing. Where the extracted text is split on
newlines downstream, the page must not let a line wrap: set `white-space: pre`
rather than `pre-wrap`, so a soft wrap cannot become a line the consumer counts
as a separate item. Whether a rich-text coercion preserves soft wraps is itself
unconfirmed, and not wrapping costs nothing.

The performance cliff above does not apply here. That is the `Run JavaScript on
Web Page` action's interpreter; this route is a real WebKit render.

## Generating the plist

Python's `plistlib` produces guaranteed well-formed output from a plain dict via
`plistlib.dumps(obj, fmt=FMT_XML)` or `FMT_BINARY`. The validation boundary is
worth stating plainly: `plistlib` checks structure and knows nothing about
Shortcuts semantics, so a file can be a perfectly valid plist and still carry a
wrong `WFWorkflowActionIdentifier` or an unpaired control-flow block. Structural
validity is not importability.

This repo's `buildXMLPlist` is a zero-dependency equivalent covering strings,
integers, reals, booleans, arrays, and dicts. It does not emit `<data>`, so
actions carrying binary parameters are not yet expressible.

Source: [Apple binary plist parsing](https://claude.ai/chat/932f973c-30a5-40bd-9687-97f0e5e0dd6f)
(2026-03-28).

---

## Related

[`dataflow.md`](dataflow.md) is the complementary half: this file covers how a
shortcut is **serialized**, that one covers how values **flow at runtime**,
including the observation that an `If` whose condition fails still passes its
incoming value through. Merged in PR #3.

## Checks

`npm test` runs every `test/*.test.js` on Node's built-in runner, no
dependencies. The two that hold this file's claims are `test/actions.test.js`
(the dataset holds its shape: every value parses, every identifier is well
formed, the multi-variant entry is the only one, nothing carries a
`GroupingIdentifier`) and `test/builder.test.js` (`add()` refuses control flow,
every block is balanced and shares one grouping, presets merge, the serializer
escapes markup). `test/show.test.js` is the exception to what follows: it runs
the shell's real JavaScript out of a real link, so the compressed route is
exercised rather than asserted about.

What the tests cannot tell you is whether the output imports. That needs a
device, and is a separate open task.

## Where the rest of the record is

The full history of this work is cataloged in the private `chat-histories`
archive as a single cross-provider storyline covering 146 chats from 2024-07 to
2026-07 (Claude 127, Gemini 12, ChatGPT 7). 66 of those chats carry literal
`WFWorkflowActionIdentifier` payloads and are the ones worth reading for format
detail. Five Gemini deep-research reports cover the App Intents framework,
base64 bplist deserialization, Siri Shortcuts configuration, and API data
integration.
