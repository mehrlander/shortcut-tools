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

**The conflict this table carried is resolved, 2026-08-13.** It read: a chat had
`4` as *is greater than* on a numeric comparison while the dictionary has `4` as
*is*, and the note wondered whether the integer is interpreted against the
input's type, meaning no single table. It is a single table, and the chat was
wrong about `4`.

The corpus settles it, because the same integers appear on numeric comparisons
with branch bodies that name the operator. `2` is *is greater than*, which is
exactly the dictionary's *is after* read on a date rather than a number; `0` is
*is less than*, the dictionary's *is before*. One operator, rendered by type,
which is what the editor does with the same picker. `1` and `3` are the
non-strict pair, `<=` and `>=`, and appear only on numbers so the dictionary has
no name for them. Nothing here reads `4` as an ordering.

The full corpus-side table, with the branch evidence behind each row, is under
[Condition codes, settled by branch semantics](#condition-codes-settled-by-branch-semantics).

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

## Parameter shapes, by census

*Measured 2026-09-03, over every action in the fifteen dumps, after a chain
handed `Inject-🎟️GitHubToken` an empty input and the injector ran its demo.*

A text field and a variable slot serialise differently, and the difference is
invisible in the editor: a value in the wrong form renders as an empty field
and the action yields nothing. Where the corpus is unanimous, its form is the
rule, held by [`test/parameter-shapes.test.js`](../test/parameter-shapes.test.js):

| action | field | token string | literal | absent | attachment |
| --- | --- | ---: | ---: | ---: | ---: |
| Replace Text | `WFInput` | 600 | 8 | 0 | **0** |
| Replace Text | `WFReplaceTextReplace` | 88 | 374 | 146 | **0** |
| Get Dictionary Value | `WFDictionaryKey` | 276 | 581 | 54 | **0** |
| Run Shortcut | `WFInput` | **0** | 0 | 175 | 955 |

And one that is a type rather than a serialisation: an **If** whose text
condition reads a Get Dictionary Value output carries a `WFStringContentItem`
coercion on the variable in all 158 corpus instances. Without it the editor
shows the condition in red, since a dictionary value offers only has-value
conditions, and the run stops on the same "choose a value for each parameter"
message. Reported from the editor on 2026-09-03, build f53dcbc.

The Run Shortcut row was learned the same day, one arm later: `Claude-Session`
build 88b5f49 handed `Log-Repo` a token string in its error arm, the one path no
headless run exercised, and the phone stopped on "Please choose a value for each
parameter in this action" the first time that arm ran. Build the text with Get
Text, then hand it over by attachment, which is what `Library-Fetch` does.

**A synchronous request honours the HTTP cache.** jsDelivr serves a branch ref
with `max-age=604800`, so an op fetched once by `Run-Op` was the op for seven
days whatever main said; two runs on 2026-09-03 executed a copy that had already
been replaced and purged at the CDN. The address carries `?_=` and the time now.
The CDN's own cache still wants the purge, on the `@main` path rather than the
bare one, which is the form that refreshed the alias.

**`Get-JsonFromJs` injects only in its demo.** Its call to `Inject-🎟️GitHubToken`
sits inside the no-input branch (actions 0 to 5); given real input it evaluates
the text as handed. A caller wanting the token substitutes first, as
`gh-recent-branches-picker` and now `Run-Op` do. The tell on device is a bare
`TypeError` at `setRequestHeader`: WebIDL converts a header value to a
ByteString and throws TypeError for any code unit above 255, which the literal
emoji placeholder is. Measured 2026-09-03 by the op's own stage marker.

The failure this explains: `Claude-Session` (2026-09-03, build 94ef81b) gave
Replace Text an attachment for both fields, the action produced nothing, and
the injector's first branch (`WFCondition` 101, no input) built its demo page
and opened it through `Show-Html`. What appeared on the phone, a `data:` page
of GitHub API JSON with Repo, Commit and Branch tabs and a jsDelivr connection
prompt, was that demo, and the chain then coerced the demo's text and offered
its button labels as a menu. The shape had been copied from
`gh-recent-branches-picker`, which the workflows README described as "the only
chain still carrying inferred parameter shapes"; it is corrected in the same
commit.

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

## Two ways to put HTML on screen, and only one of them keeps you in the shortcut

`Open URL` on a `data:text/html` URL leaves the app: it is a real Safari
navigation, measured below. `Show Web View`
(`is.workflow.actions.showwebpage`, a Safari app action) raises a sheet over
Shortcuts instead, and the run continues behind it. That difference is the
whole reason to care, since a shortcut that dumps its output into Safari has
ended its own flow and left a tab behind.

It is not a fringe action: **32 shortcuts in the library use it**, and one of
them, `Show-WebView`, is already the generic receiver. Three of its seven
actions are the entire recipe, the other four being a self-demo prologue:

```
getrichtextfromhtml   (Shortcut Input)
as file com.apple.webarchive
showwebpage
```

`WFURL` is the only parameter and it accepts four different things across the
library, which is worth knowing before assuming one shape is required: rich
text from HTML (`Show-WebView`, `Show-Table`, `JSON Viewer`, `Popup Helper`,
and four more), the downloaded contents of a `data:text/html;base64` URL
(`Open-DataUrlHelper`, `Pack-ToUrlPage`), a named or typed file
(`Get-ShortcutSource`, `ShortcutML`), or a plain `https` URL (`Open-LiveCodes`,
`Emmet`).

**The sheet runs the page's JavaScript. Confirmed on device 2026-08-26** by
`Probe-WebView`, which hands `Show-WebView` a page whose only line reads
`STATIC` until its own script rewrites it to `SCRIPT RAN`. It read `SCRIPT
RAN`. That was the doubtful part: rich text is an attributed string, so the
`getrichtextfromhtml` step looked like it should strip a `<script>`, and it
does not.

**And it reaches the network. Confirmed the same day** by `Probe-WebViewNet`,
whose page fetches `api.github.com/zen` and reports what came back. It returned
`NETWORK OK: Non-blocking is better than blocking.`, which is that endpoint's
real body, so the request completed rather than merely being attempted.

So the sheet is a full browsing context: script runs, `fetch` resolves. The
pages here that inflate a gzip payload, substitute a token and call an API are
candidates for it rather than being ruled out, and the four closing actions of
`Show-Html` (base64, build the data URL, make it a URL, Open URL) could become
one `Run Shortcut` on `Show-WebView`.

**What else the sheet offers, measured 2026-08-26** by `Probe-WebViewCaps`:

| | | |
| --- | --- | --- |
| `origin` | `file://` | see below, this is the one with consequences |
| `secure` | Y | a secure context despite the origin, which is why the rest is offered at all |
| `mic` | Y | `getUserMedia` opens a stream, so `Dictate` can move here |
| `speech` | Y | `SpeechRecognition` is present |
| `gz` | Y | `DecompressionStream`, so a `#gz=` payload inflates |
| `cdn` | Y | a jsDelivr `<script src>` loads, which `fetch` working does not imply |
| `ls` | Y | localStorage reads and writes, but see below |

**The `file://` origin splits the toss routes.** localStorage works, but at a
`file://` origin, which is a different storage partition from Safari's. The
GitHub token that `#gh=` and `#stage=` addresses read is browser-local *and*
origin-local, so it is not there. A `#gz=` address carries its payload in the
fragment and needs no token, so it works; a `#gh=` or `#stage=` address will
fail. This is the same caveat the conventions already state for an in-app
browser, now measured for the sheet.

Worth noting against expectation: the network check above succeeded from that
`file://` origin, which is not how a browser usually treats a cross-origin
`fetch` from one.

**Clipboard writes are untested here, not broken.** Both paths failed in the
probe, `navigator.clipboard.writeText` with `NotAllowedError` and
`execCommand("copy")` returning false, because both ran automatically on load
and iOS gates clipboard writes behind a user gesture. The estate's working
pages copy from a button tap; see the `ios-clipboard` skill, which also records
that `navigator.clipboard` is undefined in data-URL contexts and that the
textarea plus `execCommand` is the path that covers both.

Two things still unmeasured. Whether a `shortcuts://` link fires from inside
the sheet, which would let a page return its own results. And what the sheet
costs in exchange: a Safari tab can be bookmarked, shared and returned to,
while a sheet is gone when it is dismissed.

**A hosted page skips the whole `file://` problem, and costs one action.**
`showwebpage` takes a plain `https` string in `WFURL` with no wrapper at all,
which the corpus already showed in `Auto Message` and `Routine search`. The
sheet then loads that address directly, so the page keeps its own origin and
with it the localStorage partition the stored GitHub token lives in.

**Wrong 2026-08-29 → the sentence above:** keeping the origin is right; keeping
the *token* is not, and the two were conflated. A storage partition is keyed by
origin **within a data store**, and the data store is per-app: the sheet is a
`WKWebView` inside Shortcuts, with its own store, so a token saved in Safari is
not there however correct the origin is. Reported from the device on 2026-08-29,
when a hosted page opened in the sheet and asked for a token.

So the hosted route fixes what `file://` broke, which is the origin, and does
not deliver Safari's token. What it should buy instead is a token entered **once
per app**, and whether the sheet's store survives dismissal is the open
measurement: enter a token, dismiss, run the receiver again. If it persists, the
cost is one entry per app rather than one per run. So the
split is not sheet-versus-Safari, it is which of the two sheet inputs a page
arrives on: HTML text lands at `file://` and loses the token, while a hosted URL
does not. `Dictate` is one action on that route, and the back tap's
empty-clipboard branch inlines the same action rather than calling out to it.

**The sheet sibling was already installed, so nothing was built for it.**
`Show-Html` (data URL, Open URL, a Safari tab) and `Show-WebView` (rich text,
webarchive, `showwebpage`) are the two receivers, and both have been on the
device throughout. A caller moves to the sheet by naming the other one. The
back tap's pasted-HTML branch was switched that way on 2026-08-26; `Show-Html`
stays as it is, for pages that need Safari's storage partition.

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

## The device can gzip, and it is one action

*Read 2026-08-13 from `Show-HtmlViaZip`, eight variants of one experiment.*

`is.workflow.actions.makezip` takes **`WFArchiveFormat`**, and `"gz"` is a valid
value beside the default zip. So compression is available on device, in one
action, with no tool and no library:

```
Make Archive   WFArchiveFormat: "gz",  WFZIPName: ""
Base64 Encode  WFBase64LineBreakMode: "None"
```

That is worth knowing because this repo compresses in Python
([`tools/show.py`](../tools/show.py)) and had no record that the device could do
it at all. The two solve different problems and both are right: `show.py`
compresses so the **link** is short, since a link is transcribed and a long one
is the failure this repo keeps hitting. `makezip` compresses so the **data URL**
is short, for a page assembled on device where no link exists to shorten.

The distilled variant is five actions: `makezip` → `base64encode` →
`dictionary` → `gettext` (a shell holding the base64) → hand to `Show-Html`.
Structurally identical to `show.py` plus [`tools/gz-shell.html`](../tools/gz-shell.html),
arrived at independently, which is some evidence the shape is forced rather than
chosen.

One difference is not cosmetic. That shell inflates with **pako from jsDelivr**,
so the page fetches a CDN script before it can render itself. `gz-shell.html`
uses `DecompressionStream('gzip')`, which is native, needs no network, and
cannot fail because a CDN is slow or a captive portal is in the way. A
self-extracting page that depends on the network to extract itself gives up the
property that made it worth making. Prefer the native stream.

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

### Condition codes, settled by branch semantics

*Settled 2026-08-13. An earlier version of this table guessed 2 and 3 from
their neighbours, had them inverted, and left 100 and 101 open. That mistake
propagated: it made `sketch.py` read a correct shortcut as buggy, and this
document reported the phantom bug.*

The ordering codes cannot be read off a single action, because nothing beside
them names the operator. They can be read off **what the true branch does**,
across the corpus:

| Code | Meaning | The evidence |
| ---: | --- | --- |
| 0 | is less than | `count [0] 1` then alert and exit: nothing was picked |
| 1 | is less than or equal | `count [1] 0` then output: empty, return early |
| 2 | is greater than | `count [2] 1` then combine, or repeat each, or choose from a list. Seven shortcuts, and choosing needs more than one |
| 3 | is greater than or equal | `File Size [3] 1 MB` then skip the descriptor |
| 4 | is | 326 uses, string beside it |
| 5 | is not | |
| 8 | begins with | `[8] "http"` in `Show-Html`'s URL test |
| 9 | ends with | |
| 99 | contains | `[99] "🎟️GitHubToken"` in the injector |
| 999 | does not contain | |
| 100 | has any value | `[100]` then process the input |
| 101 | does not have any value | `[101]` then build a sample and self-demo, in 72 shortcuts |

100 and 101 fall out of the self-demo prologue, which is the most repeated
shape in the library and fires precisely when there is **no** input.

The operand rides one of four keys and reading only the first drops the rest
silently: `WFConditionalActionString`, `WFNumberValue`, `WFAnotherNumber`, and
`WFMeasurement`, the last a `{Magnitude, Unit}` pair.

## The device can gzip, and it is one action

*Read 2026-08-13 from `Show-HtmlViaZip`, eight variants of one experiment.*

`is.workflow.actions.makezip` takes **`WFArchiveFormat`**, and `"gz"` is a valid
value beside the default zip. So compression is available on device, in one
action, with no tool and no library:

```
Make Archive   WFArchiveFormat: "gz",  WFZIPName: ""
Base64 Encode  WFBase64LineBreakMode: "None"
```

That is worth knowing because this repo compresses in Python
([`tools/show.py`](../tools/show.py)) and had no record that the device could do
it at all. The two solve different problems and both are right: `show.py`
compresses so the **link** is short, since a link is transcribed and a long one
is the failure this repo keeps hitting. `makezip` compresses so the **data URL**
is short, for a page assembled on device where no link exists to shorten.

The distilled variant is five actions: `makezip` → `base64encode` →
`dictionary` → `gettext` (a shell holding the base64) → hand to `Show-Html`.
Structurally identical to `show.py` plus [`tools/gz-shell.html`](../tools/gz-shell.html),
arrived at independently, which is some evidence the shape is forced rather than
chosen.

One difference is not cosmetic. That shell inflates with **pako from jsDelivr**,
so the page fetches a CDN script before it can render itself. `gz-shell.html`
uses `DecompressionStream('gzip')`, which is native, needs no network, and
cannot fail because a CDN is slow or a captive portal is in the way. A
self-extracting page that depends on the network to extract itself gives up the
property that made it worth making. Prefer the native stream.

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

**The mechanism argues for a route this file has been reading as a prohibition.**
The cost is in the SOURCE, not in the work: a script that parses in one line
stays cheap however much that line goes on to do. So the discipline above is the
second-best answer to the cliff, and the best one is to stop sending source at
all, keeping the heavy code somewhere that has already parsed it and sending a
call. A page that has pulled its libraries off a CDN is that somewhere, and this
action is how a shortcut talks to one. See
[The browser is a coprocessor](#the-browser-is-a-coprocessor-not-only-a-destination),
which is the same action read the other way round.

Sources: [Apple Shortcuts JavaScript performance fast-path discovery](https://claude.ai/chat/1742ec65-706f-4515-babc-d12c37cd9468)
(2025-09-14) and the same-day Gemini session `gemini-session/134`.

## The browser is a coprocessor, not only a destination

*Read out of the corpus 2026-08-29. Every card quoted below is on this device.*

Every render route this estate has built sends a page **out**. `Show-Html`
navigates Safari to a `data:` URL, `Show-WebView` raises a sheet, `show.py` gzips
a page into a link. In all three the shortcut's flow ends where the page begins,
which is why the return channel needed `Log-Repo` and why a diagnostic used to
end in a question.

`Run JavaScript on Web Page` runs the other way. It executes inside a running
shortcut and hands its value back through `completion()`, so a page is something
a shortcut **calls**. The last full dump has 26 such cards across 4 shortcuts, 20
of them in `Get-Nice` alone, which is authored, live, and called by nothing;
across all 15 dumps, 9 shortcuts have used it.

Three properties, each from a real card rather than inferred:

**`completion()` returns structure, not only text.** `Get-Nice` ends a card with
`completion(window.siriData)`, where `siriData` is an array of objects, and the
value arrives as a list the next action can index.

**The page is a heap between calls.** Three separate cards in one run:

| Card | Script |
| --- | --- |
| A | `const tally = {}; …; window.siriData = [tally]; completion("Data stored")` |
| B | `window.siriData[1] = {...window.siriData[0]}; …; completion("Data stored")` |
| C | `completion( window.siriData )` |

B reads what A left behind, and nothing carries the value between them except the
page. `Get-Nice` also puts nine of these calls inside one `Repeat` block, walking
the DOM and offering each level's children as a menu, so repeated calls against
one page are the working pattern rather than a curiosity.

**The script itself can be computed.** `WFJavaScript` accepts a
`WFTextTokenString`, so a variable interpolates into the source. `Utilities Menu`
embeds one at offset 164 of a longer script; `AI Run JavaScript On Page` goes
further and makes the **whole** parameter one attachment, `{"{0, 1}": {"Type":
"Variable", "VariableName": "FinalCode"}}` over a bare `￼`. What runs is
therefore decided at run time.

**What the input slot accepts** is the part still narrow. Every card in the
corpus passes a Safari page: of 32 cards across 9 shortcuts, 28 take
`ExtensionInput` from the share sheet, one a `Variable` named `Safari Web Page`,
one an `ActionOutput` in `WebTools`, and two carry no input at all.
**It does not take a tab entity, measured on device 2026-08-28** by
[`probe-tab-js`](../workflows/probe-tab-js.json). Shortcuts refuses with a type
error rather than a silence: *"Run JavaScript on Web Page failed because
Shortcuts couldn't convert from Tab to Safari Web Page."* So the slot wants a
`WFSafariWebPageContentItem` and there is no converter from the App Intents
entity, which closes the cheap entry and leaves the share sheet as the only way
to hand this action a live page.

**`Find Tabs` itself works, and that half is worth keeping.**
`com.apple.mobilesafari.TabEntity` is used by nothing in 577 shortcuts, and the
same run counted 190 open tabs and logged them, so the entity query and its
`Count` are both good. Its card shape is the one Safari's own `BookmarkEntity`
carries, `AppIntentIdentifier` naming the entity and an empty
`WFContentItemFilter` meaning no filter. What is missing is a consumer: nothing
measured here turns a Tab into anything another action will take.

The probe returned itself exactly as built. Its two `Log-Repo` calls are ordered
so the first lands before the risky card, and three runs each left `tabs=190` in
`shortcuts/log/` while the JavaScript card failed behind them. A probe that
fails halfway should still be readable from the repo, and this one was.

The entity-slot question from [the library-management
section](#the-library-management-actions-address-an-app-intents-entity-not-a-name)
was left to "fold into the next probe that has a real reason to exist." This is
that probe, and it still does not carry it, for a reason rather than an
oversight: answering that one means opening a shortcut in the editor, which ends
the run and leaves the reader to report what happened. It would turn a probe that
returns itself into one that asks.

### What it is for

Load the libraries into a page once, from the CDN, and every call after that is
one line, so the parse cliff never applies:

```js
completion(bench.call("md", "<base64>"))
```

web-tools' `pages/bench.html` is that page and
no chain drives it any more; `bench-call` was withdrawn with the rest of the
bench chains on 2026-08-29, for the reason under **Withdrawn** below. It would
have to be reached at its own hosted address, and the 🥏 toss is not a substitute
for one: `toss-render.html` mounts a page in an **iframe** on a `blob:` URL, so
the script this action sends runs in the top document, where `bench` does not
exist and the frame is cross-origin anyway. Input
crosses as base64 because the payload is interpolated into a string literal,
where a quote or a newline in the text would end it early; the estate already
base64s on this boundary, in `Log-Repo`.

The gain is not markdown rendering. It is that a shortcut acquires every library
on the CDN, with the network, with state that survives between calls, and with
nothing to install. `TransformTextWithJavaScriptIntent` serves 23 cards in this
corpus today, and it is a paid third-party app doing strictly less.

**The share sheet is the cost, and there may be a route with none.** With the tab
entity refused, that route needs the user already on the bench page. The
`data:` URL route above needs no page at all: `js-data-url` runs a script that
way and hands the value back in five actions, so a page that fetches its library
before writing its answer would be the same coprocessor at one tap from
anywhere. Everything in it has to be **synchronous**, since the coercion captures
rendered text at a moment nobody has written down and an async resolution is lost
with no error, which is what a blocking `XMLHttpRequest` and an indirect `eval`
buy. `probe-inline-bench` was that page under one tap, reporting the fetch, the eval,
the library's output and the elapsed cost on four lines. It is withdrawn; its
question is `probe-coercion`'s `e` leg now.

**It came back empty on device 2026-08-28, and that said nothing about the
coercion.** The shortcut had no page in it. `plist.py` did not resolve
`{"$file": path}`, so the Text action carried the literal dictionary and the
`data:` URL was built from a base64 of that. `pack.py` had resolved the directive
since it was introduced; the plist mirror never did, and nothing errored at any
point. The shortcut generated, imported, ran, and returned an empty string.

**Two mirrors of one chain set have to resolve a directive the same way, or the
cheaper one lies.** This repo already learned that on 2026-08-27, when the suite
and `--check` disagreed about orphans, and wrote down that where two things state
one invariant the weaker one is a wrong answer rather than a gap. The same shape
returned in a different place two days later. `plist.py` now imports `resolve`
from `pack` rather than carrying a second copy, and `test/plist.test.js` fails on
any plist shipping a `$file` key.

**The probe was also built wrong, independently of that.** It was shaped to
separate four failures and separated none, because every one of them collapses
into a page that renders nothing, which is why a missing page could pass for a
runtime answer at all. A probe against a stage that can kill the run needs a
**control that runs first and logs first**.
[`probe-coercion`](../workflows/probe-coercion.json) is the replacement: four
legs, each committing before the next begins, over static HTML, a script that
rewrites its own line, a real `https` URL, and the sync/async pair. Read the first
empty line and everything above it worked.

### The coercion route, settled on device 2026-08-28

`probe-coercion` ran all five legs. Every one passed, which closes a question
[`sync-xhr-probe`](../workflows/sync-xhr-probe.json) was built for on 2026-08-10
and never ran, and makes the coercion the cheapest route in this file.

| Leg | Input | Result |
| --- | --- | --- |
| `a` | static HTML | `STATIC OK` |
| `b` | a script that rewrites its own line | `SCRIPT OK` |
| `c` | `https://api.github.com/zen` | the page source, wrapper and all |
| `d` | sync and async requests | `sync: 200, 26 bytes` / `async: 26 bytes` |
| `e` | a page that fetches a library and uses it | 40,214 bytes, `eval: ok`, markdown rendered, 738 ms |

**The coercion waits for asynchronous work, so the standing caution is retired.**
This file has said since 2026-08-10 to write the request synchronously, because
an `await` that resolved late would yield an empty result with no error. Leg `d`
returned both lines. Prefer synchronous anyway where it costs nothing, since it
keeps the page one straight line, but it is a preference now and not a
correctness rule.

**Leg `e` is the whole coprocessor, without a live page.** A `data:` URL document
pulled 40 KB of `marked` off jsDelivr with a blocking `XMLHttpRequest`, evaluated
it with an indirect `eval`, rendered markdown and handed the result back into the
shortcut, in 738 ms. No hosted page, no Safari tab, no share sheet, no
third-party app. That is strictly better than the `Run JavaScript on Web Page`
route this section opened with, which needs a live Safari page and has no way to
get one but the share sheet.

[`pages/bench-run.html`](../pages/bench-run.html) is the page, fetching one
library only when the op needs it, and `test/bench-page.test.js` runs its real
script in a `vm` against a stubbed document and XHR, the way `show.test.js` runs
the shell's.

**Withdrawn 2026-08-29: the `Bench` receiver, `Bench-Call` and `Probe-Bench`.**
The route is measured and the page is tested; the chains around them were not
worth keeping. `Bench` returned an empty string on device and never worked, and
all three rebuilt, worse, machinery this library already had: `Get-FileContext`
types and coerces an input before encoding it, `Get-FileInfo` produces the
descriptor everything dispatches on, and `Run-Choice` picks a verb and applies
it. A page that works with no chain is a better record than three chains that
duplicate the library and one of which is broken.

**Leg `c` carries a trap worth keeping.** Coercing a plain-text `https` URL
returns Safari's generated document, `<html><head><meta name="color-scheme">…`
around a `<pre style="word-wrap: break-word; white-space: pre-wrap">`. So the
coercion yields page **source**, not rendered text, and the wrapper Safari
supplies is `pre-wrap`: exactly the soft-wrap hazard this file warns about, on a
document nobody here authored. A page you write should set `white-space: pre`
itself, which `bench-run.html` does.

Worth noting against this whole section: `Run JavaScript on Web Page B1`, in the
corpus, already falls back exactly this way. Handed something that is not a
Safari page, it assembles the script into a `data:text/html` URL, coerces it to
rich text, and URL-decodes the result out of the body. The pattern being reached
for here is one an imported shortcut settled on first.

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

  **Stale 2026-08-29 (Chromium half only) → the device result below:** this no
  longer reproduces in the sandbox's Chromium, where a `data:` URL document gets
  no network at all. Against a local server sending
  `Access-Control-Allow-Origin: *`, synchronous XHR, asynchronous XHR and `fetch`
  all failed from a `data:` origin, while the same page on an `http` origin got
  all three. So it is the opaque origin rather than CORS or the endpoint, and it
  is not specific to the synchronous form. Whether Chromium changed or the
  original measurement differed in setup is not established. **The device half is
  untouched:** WebKit ran both requests on 2026-08-11 and returned real bytes, so
  the split is browser-to-browser and the device is the authority for this route.
- **A synchronous `XMLHttpRequest` blocks the load**, so the response is in the
  DOM before anything downstream can read the page. This is the reason to prefer
  the deprecated synchronous form here: the behavior it is deprecated for is
  exactly the guarantee this route needs.

*Settled 2026-08-28, and the answer is yes.* `probe-coercion`'s `d` leg reported
`sync: 200, 26 bytes` and `async: 26 bytes`, so the coercion waits for an
asynchronous resolution as well as a blocking one. Prefer the synchronous form
where it costs nothing, since it keeps a page one straight line with no capture
moment to reason about, but it is no longer a correctness requirement. See
[The coercion route](#the-coercion-route-settled-on-device-2026-08-28).

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

## A third-party app intent is not a receiver you can build blind

`ai.x.GrokApp.AskGrok` was written up here as a four-action receiver on
2026-08-27: Shortcut Input to text, the intent, the reply to the clipboard, the
reply shown. It installed and it did not work on device. The cause was not
diagnosed and the chain was withdrawn the same day rather than debugged, so this
records only where it stopped.

**What is worth carrying forward is the shape of the gap, since it will recur
with any third-party intent.** The corpus answers Apple's own actions well and
answers this class hardly at all: `AskGrok` appears in no shortcut of the 605,
so its parameter names, whether `ShowWhenRun: false` suppresses the app or the
result, and whether it returns output at all were all guesses dressed as a
build. Nothing in this repo could have checked them, and the ToolKit catalog
carries Apple's metadata rather than a third party's. The cheap route, unspent
here, is one card configured in the app and read back out of a dump: one tap of
the expensive kind, against a receiver assembled from inference.

## A list handed to Run Shortcut can arrive text-coerced

*Measured on device 2026-08-29.*

`Run-Pick` was split in two so its payload and verb list could both be
parameters: a caller built a two-item list, `[payload, verbs]`, and passed it
through `Run Shortcut`. On the other side, `Get Item 1 from Input` and `Get Item
2 from Input` were supposed to take them apart.

**They did not.** The menu came up with five rows instead of four, the first
being `Clipboard Aug 29, 2026 at 8.55 AM`. The list had arrived as one
newline-joined string, so the item grabs returned the whole blob and splitting it
produced the payload's own line plus the four names. The payload became a menu
choice.

This is the coercion trap this file already records for base64, at a different
boundary: a value crossing into another shortcut can be flattened to text, joined
by newlines, with nothing raising an error. `Run-Choice` does not hit it because
`Show-Loop` builds the list and consumes it inside one shortcut.

**So a shortcut boundary is not a safe place to carry structure.** Where two
arguments are needed, either keep the construction and the consumption in one
shortcut, or make the second argument bounded enough to ride a delimiter, or pass
one argument and let the other come from somewhere the callee reads itself.
`Run-Pick` now takes the last route: the verb list is the input and the payload is
the clipboard, which is one shortcut and no boundary at all.

*Unmeasured, and the reason this is stated as a hazard rather than a rule:* which
hand-offs preserve a list and which flatten it. Only that this one flattened.

## An inline payload outlives the path it loads from

*Measured 2026-08-30.* `Show-Repo` is two actions: 14,451 characters of HTML
titled "GH Browse" pasted into a Text action, handed to `Show-Html`. That page
loads three things from jsDelivr, and one of them is
`gh/mehrlander/web-tools/gh-fetch.js`, which **404s**. The file moved into
`lib/` on 2026-08-25 and the pasted copy could not follow it.

A fresh device dump matched the 2026-08-18 corpus copy byte for byte, so this
was not a stale reading: the shortcut had been opening a page whose script never
loaded, and nothing said so, because a page that renders empty looks like a page.

**This is the failure [`idioms.md`](idioms.md) predicts** in "Payloads live in
`pages/`, not pasted into the chain". A hosted page follows its repository when a
file moves; 14 KB pasted into a Text action on a phone does not, and no check
here can see inside it. Retired rather than repaired, on the owner's call.

## A vCard menu hides its URLs from a search for them

*Measured 2026-08-30, after guessing wrong at something the corpus held.*

`Fav-Settings` carries 14 settings pages as a vCard, the idiom
[`idioms.md`](idioms.md) calls "rich menus smuggle data through contacts": a
`TEL;TYPE=<url>:<label>` line per entry, coerced to a contact, offered as Choose
from List, and the chosen row's Label opened as a URL.

**The vCard escapes the colon**, so those entries read `TEL;TYPE=prefs\:root=…`.
A scan for `prefs:` across the corpus finds the 130 URLs in `Settings Menu` and
its siblings and **none** of these, which is how a search over 636 shortcuts
returned a confident "Back Tap is not in the library" while the exact key sat in
a shortcut named for it.

The keys, since they are worth having written down:

| Setting | Key |
| --- | --- |
| Back Tap | `prefs:root=ACCESSIBILITY&path=TOUCH_REACHABILITY_TITLE/BackTap` |
| AssistiveTouch | `prefs:root=ACCESSIBILITY&path=TOUCH_REACHABILITY_TITLE/AIR_TOUCH_TITLE` |

Back Tap is not `TOUCH/Back%20Tap`, which is what the sibling
`DISPLAY_AND_TEXT` suggests and what was guessed. The Touch page is
`TOUCH_REACHABILITY_TITLE` and the leaf has no space. The AssistiveTouch key
reaches that page; the long-press action customisation below it is a further
level with no key recorded yet.

**Why these two matter operationally rather than as trivia:** re-installing a
shortcut breaks whatever Back Tap or the AssistiveTouch button had bound to it,
so a handover that replaces a bound shortcut has to carry the settings link
beside the install link. That rule lives in `CLAUDE.md`, next to the save-over
offer it qualifies.

**The rule this earns:** a corpus search for a URL, an identifier or a name must
allow for escaping, because a payload built as text can carry any of them in a
form the plain string never matches. Search for the surrounding structure too,
here `TEL;TYPE=`, not only the value hoped for.

## A run-shortcut link makes Shortcuts the current app

*Observed on device 2026-08-30.*

Tapping a `shortcuts://run-shortcut` URL brings the Shortcuts app to the
foreground before the shortcut runs, so `Get Current App` reports **Shortcuts**
no matter where the tap came from. Anything routing on the current app is
therefore untestable by link: it will take the Shortcuts branch every time, and
a run that lands there proves the lookup works and proves nothing about which
app it read.

Two consequences worth stating.

**A back tap is not a link.** The gesture invokes the shortcut from the
foreground app directly, which is why `Back-DoubleTap`'s GitHub, Audible and
Music branches have been firing correctly all along. The mechanism is sound; the
link is the contaminated instrument.

**So test the lookup and the reading separately.** `Get-AppRoute` takes an app
name as input for exactly this reason, and `probe-route` asks it about a named
app and logs the answer, which is a question a link *can* ask. Whether
`Get Current App` reports the foreground app is not a question any link can put,
and does not need one: the shortcut that depends on it is the one already in
daily use.

Same shape reaches `Choose-Utility`, whose prompt reads `Current app: ￼`. Run
from a link it will always say Shortcuts.

## "Unrecognized archive format" is the signing service, not the file

*Measured on device 2026-08-28, cause isolated from the sandbox 2026-08-30.*

**The worker signs by calling Apple's iCloud service, and when that call fails
it answers HTTP 200 with a plain-text body.** Not a 5xx, not an empty reply: a
46-byte string.

```
🛑 ERROR 🛑
iCloud server failure. Please try again later.
```

`Extract` is handed that instead of a gzip and reports the only thing it can,
which is that the archive is unrecognizable. The message names the file and the
fault is two services away.

Isolated by POSTing four plists in one pass: three signed, `Get-ShortcutJson`
came back with the string above, and **the identical bytes then signed on all
three immediate retries**. So the file is not the variable and neither is the
request.

**There is a second, unrelated 27-byte error from the same worker**, `🛑 Error:
Invalid Request`, which is what a wrong request content type gets. It signs on
`application/gzip` and `application/x-gzip` and refuses `application/octet-stream`
or a multipart form. Two different failures behind one on-device message, which
is why the device symptom cannot tell them apart.

**The retry belongs in the sandbox, not on a thumb.** `plist.py --sign` POSTs the
built plist and reports whether a shortcut comes back, retrying an outage up to
four times. Run it before handing over an install link; a tap spent on an Apple
outage is a tap wasted, and this cost two of them in one session.

---

*Original note, 2026-08-28, which had the rule right and the cause unknown:*

`Library-Import` fetches a plist, gzips it, POSTs it to a third-party signing
worker over plain `http`, and unzips the reply. That last card is where the alert
comes from: it is `unzip` refusing a response that is not an archive, which means
the worker returned something else.

**It fires intermittently on files that are perfectly good.** `Pick-Clip` failed
with it, then installed from the *same SHA-pinned URL* on an immediate retry, with
the served bytes verified identical to local and every card shape matched against
a real card in the corpus. `Run-Pick` had installed from the same commit seconds
before the failure, so the URL, the CDN and the rest of the pipeline were all fine.

So the working rule: **retry once before suspecting the file.** Two failures in a
row is evidence about the plist; one is not.

Two consequences worth stating. `Library-Install` is the fallback and also the
discriminator, since it fetches the packed actions and pastes them without
touching the worker, at the cost of one paste; it reaches everything except
file-level settings, so it suits any chain not declaring `WFWorkflowTypes` or
input classes. And the 2026-08-29 commit that fixed `plist.py`'s unresolved
`$file` attributed `Probe-Coercion`'s import failure to that bug. The bug was
real and worth fixing, but the fix and a retry happened in the same step, so
whether it caused *that* failure was never isolated and should not be read as
settled.

## The library-management actions address an App Intents entity, not a name

`openshortcut`, `moveshortcut`, and `deleteshortcuts` are the three actions a
page needs to operate a library from outside the app, and all three take **App
Intents entity references** rather than a name string. Measured 2026-08-15: the
first from real cards in this corpus, the other two from a probe, since **no
shortcut in 577 uses Move or Delete at all**.

Each card carries an `AppIntentDescriptor` naming the providing app, and each
entity slot is keyed differently per action, which is the part nothing in
`actions.json` can tell you:

| Action | Entity key | Second key |
| --- | --- | --- |
| `com.apple.shortcuts.OpenWorkflowAction` | `target` | |
| `com.apple.shortcuts.MoveShortcutToFolderAction` | `shortcuts` | `folder` |
| `com.apple.shortcuts.DeleteWorkflowAction` | `entities` | |

```xml
<key>AppIntentDescriptor</key>
<dict>
  <key>AppIntentIdentifier</key><string>OpenWorkflowAction</string>
  <key>BundleIdentifier</key><string>com.apple.shortcuts</string>
  <key>Name</key><string>Shortcuts</string>
  <key>TeamIdentifier</key><string>0000000000</string>
</dict>
```

**Picked in the editor, an entity is an opaque UUID and the name is only a
label.** A card configured by hand holds `identifier` (a UUID), an `image` whose
`uri` is an `intents-remote-image-proxy:` address, and `title`/`subtitle` as
`{"key": "Animal Game"}` display dicts.

**This is the one place the `WFWorkflowName` finding above does not reach, and
the difference is the action family rather than the key.** Run Shortcut is a
legacy `is.workflow.actions.*` action whose target is a plain string key, which
is why a name alone resolves it and why the page's Run button needs no lookup.
These three are App Intents actions whose target is an entity slot, and no
evidence says a name resolves one. Two things support that, neither being proof
that the slot rejects a string:

- **The corpus works around it.** `Use-Shortcut`, holding a *Name* as text, does
  `getmyworkflows` then `filter.files` then recurses with the shortcut it found,
  rather than handing the name to its own Open card. Its Open card is fed
  `ExtensionInput`, and by then the input is a shortcut, not a name.
- **Others hit the same wall.** A 2026 write-up on driving Shortcuts
  programmatically reports that intents needing entity parameters "require
  opaque IDs from the Shortcuts GUI," with no programmatic way to resolve them,
  and that `LNConnection.performQuery()` crashes when used to try
  ([navan.dev](https://web.navan.dev/posts/2026-04-06-programatically-creating-and-running-siri-shortcuts.html),
  2026-04-06).

*Unconfirmed, and deliberately left that way:* whether an entity slot given a
text variable holding a name resolves it anyway. A probe was built to settle it
and then withdrawn, because the answer changes nothing that matters. It would
take `Library-Open` from three cards to one, in a receiver that is installed and
working, and the cost is a manual run in the app with a typed input. That trade
fails rule 2 in [CLAUDE.md](../CLAUDE.md): a device ask must buy something in
steady state, and tidying a working chain is not that. **Do not re-propose it**
on its own. Fold it into the next probe that has a real reason to exist.

### The best public catalog: shortcuts-playground-plugin's ToolKit dumps

[`viticci/shortcuts-playground-plugin`](https://github.com/viticci/shortcuts-playground-plugin)
(MIT) ships Apple's own ToolKit metadata as static JSON, extracted from macOS 27
and the iOS 27 Simulator, so it needs neither a Mac nor the private frameworks:

| File | Holds |
| --- | ---: |
| `data/toolkit-v78-tool-ids.json` | **2,731 identifiers** (this repo's dictionary: 774) |
| `data/toolkit-v78-first-party-parameter-keys.json` | **2,585 tools with their parameter keys and types** |
| `data/toolkit-v78-first-party-enum-cases.json` | allowed enum values |

**It gives the parameter KEYS and TYPES, and not the serialization.** `Move
Shortcut` is `shortcuts` / `folder` / `OpenWhenRun`, `Delete Shortcuts` is
`entities`, `Open Shortcut` is `target`, each typed
`com_apple_shortcuts_wfworkflow_reference`, and `Create Folder` is `name` typed
plain `str`. All of that was instead obtained by asking the user to configure
cards, and the search never run was for a *catalog* rather than for an *answer*.

**But the probe was not wholly redundant, and the line matters.** A key and a
type do not say how the value is written into the plist. Nothing in this catalog
carries the `AppIntentDescriptor` block, the picked-entity dict of
`identifier` / `image` / `title`, or the `WFTextTokenAttachment` variable form,
and **none of its 19 golden XML examples contains an `AppIntentDescriptor`
either**. Those came only from cards copied off the device. So the catalog
answers *which parameters exist*, this file answers *how they serialize*, and
neither substitutes for the other.

**Scope, measured rather than assumed:**

| Cut | Count |
| --- | ---: |
| Identifiers total | 2,731 |
| Apple App Intents | 1,692 |
| Apple legacy `is.workflow.actions` | 365 |
| **Third-party** (56 bundles: Actions 241, Supercharge 70, Drafts 55, nAutomate 47, BetterTouchTool 45) | **674** |
| Tools with parameter tables | 2,585, **first-party only** |
| Of those, available on iOS | **1,072**; 1,338 are macOS-only |

Two consequences. A third-party action is listed by identifier and carries **no
parameter information at all**, so an app's actions still need a copied card.
And the bulk is not third-party but Apple's macOS surface, `com.apple.systempreferences`
alone being 542 entries that no iPhone will ever offer.

It also names the folder limit precisely: `folder` is typed
`com_apple_shortcuts_root_navigation_destination`, an entity, which is why it
needs a picker where `name` on Create Folder does not.

`tools/coverage.py --exists <name> --catalog <toolkit-vNN-tool-ids.json>` is the
lookup, and it reports which of the two sources knows a name.

**Still not a census**, so the honest-search rule stands: it is one OS version's
first-party surface plus the third-party apps ToolKit saw, and a newer OS or an
uninstalled app is outside it.

### The device lists apps, and never lists actions

*Established 2026-08-30 by searching all three ToolKit catalogs and the 636-file
corpus, before anything was sent to the device.*

> [!WARNING]
> **Wrong 2026-08-30 (same day) → the iOS claim below:** the device says
> `Find Apps` is **Mac-only**. Imported and opened on the phone, the card
> renders and its body reads *"This action can only run on Mac."* Everything
> here about the catalog is accurate; the inference drawn from it was not, and
> what the catalog cannot answer is stated under *The `platforms` field is not a
> runtime claim* below. **There is no route to the installed-app list on iOS.**

**Apps: `is.workflow.actions.filter.apps`, "Find Apps".** An ordinary content-item
filter, so the whole `Find X` grammar applies: omit `WFContentItemInputParameter`
and its source is the system library rather than a piped list, which is the 57-use
form the corpus already carries on other `filter.*` actions. Sortable by four
properties, and that enum is the only published statement of what an App item
exposes:

| `WFContentItemSortProperty` | |
| --- | --- |
| `Name`, `Bundle Identifier` | the two worth reading |
| `Launch Date`, `Process Identifier` | running-app fields, macOS in origin |

It is in **all three** catalogs, and the one that matters is
`toolkit-v78-ios27-tool-ids.json`, the 1,206-id cut taken from an iOS 27 runtime
rather than the 2,731-id union. That cut is discriminating: `hide.app` and
`quit.app` are absent from it, so `filter.apps` appearing there is a claim about
iOS and not an artifact of a macOS-hosted Simulator. **Nothing in the corpus has
ever used it**, across nine other `filter.*` actions and 33,433 cards, so the
estate had no evidence either way until [`workflows/probe-apps.json`](../workflows/probe-apps.json).

**Actions: nothing.** `com.apple.shortcuts.SearchActionDrawerAction` is the only
tool in the catalog that has actions as its subject, and its whole parameter table
is `query: str`. It opens the picker; it returns nothing. There is no
`properties.apps` either, so the sort enum above is the entire readable surface of
an app. This is the same wall as *No action can put actions into a shortcut*
below, from the other side: Shortcuts will neither read its own action inventory
nor write one.

**So both lists are reached by inference, not by asking.** Every app-provided
action carries its vendor's bundle id as the identifier prefix, which makes a
corpus dump a census of the apps whose actions are *in use*: 26 bundles over the
636 files, against 52 apps named in `WFSelectedApp` pickers, 63 together. That is
now the ceiling rather than a stopgap.

### The `platforms` field is not a runtime claim

*Established 2026-08-30 on the device, correcting the inference above the same
day it was written.*

**A catalog hit licenses "this action exists", never "it runs here".** The
mirror of the honest-search rule, and it cost a tap to learn:

| The catalog said | The device said |
| --- | --- |
| `platforms: ["iOS 27 Simulator", "macOS 27"]` | "This action can only run on Mac." |
| present in the 1,206-id iOS cut | same |

Both fields record **where an action's metadata ships**, and iOS carries metadata
for Mac-only actions precisely so Shortcuts can draw the card and refuse it. So
the iOS cut is not a runtime-availability filter, and no cut of this catalog is.

**The reasoning that failed is worth naming, because it looked like evidence.**
`hide.app` and `quit.app` are absent from the iOS cut, so the cut appeared to
discriminate, so `filter.apps` being present in it appeared to mean something.
It does not: absence from the cut and presence in it are not two readings of one
scale. An action can be absent because iOS ships no metadata for it and present
while still gated at run time, and nothing in the catalog distinguishes the
gated from the available.

**And it fails in both directions, which is why the corpus outranks it.** Two
disagreements, found within an hour of each other on 2026-08-30:

| Action | Catalog | Truth |
| --- | --- | --- |
| `is.workflow.actions.filter.apps` | iOS and macOS | Mac-only, per the device |
| `is.workflow.actions.extracttextfromimage` | macOS-only, key `imageFile` | runs on the phone, key `WFImage`, per 7 uses in the corpus |

So a catalog "no" is as weak as a catalog "yes". The second case cost nothing
because the corpus settled it for free, and that is the general order: **the
device is the authority, the corpus is the cheapest witness to it, and the
catalog is neither.** The catalog's own strength is unchanged and is elsewhere:
which parameters exist, and what their enums allow.


**What this does not touch.** The parameter tables, the enum cases, and the
identifiers are all exactly as accurate as before; `Probe-Apps` imported clean
and every card wired correctly, including the `Name` and `Bundle Identifier`
aggrandizements. Only availability was ever in question, and only the device
answers it. `probe-apps.json` therefore keeps its place in `workflows/` and gives
up its `name`, so it leaves `plists/` and no install link can serve a receiver
the phone will not run.

### No action can put actions into a shortcut

*Established 2026-08-15 by searching all 2,585 first-party parameter tables in
the ToolKit v78 catalog, not by inference.*

`Create Shortcut` takes exactly two parameters, and neither is content:

| Key | Type |
| --- | --- |
| `name` | `str` |
| `OpenWhenRun` | `bool` |

**And nothing else in the catalog takes actions or workflow content either.** A
sweep for parameters keyed or named for actions, or typed for a workflow rather
than a workflow *reference*, returns 115 candidates across 71 tools and every
one is unrelated: Photos favouriting, Messages tapbacks, alert titles, dwell
settings. The `wfworkflow_reference` type points *at* a shortcut and never
carries one.

So on device the ceiling is **create empty, then paste**, which is what
`Library-Install` does: `CreateWorkflowAction` for the name, `Copy-ActionFromUrl`
for the clipboard, and a human tap for the paste. The paste is not a
shortcoming of the design, it is the boundary of what Shortcuts exposes.

**The one route past it is a signed import**, and signing cannot happen on
device (patched in iOS 15 beta 1). It needs a Mac or a remote signing service.
`Shortcut Source Helper` in this estate's corpus already does the second: gzip
the plist, POST to `shortcuts.gluebyte.workers.dev`, unzip, write a `.shortcut`,
open it. Untested here, and the only thing that would turn a generated shortcut
into a real one-tap install.

### The four sources checked before it, none of them enough

Surveyed 2026-08-15, after a session claimed an action did not exist on the
strength of a dictionary that had never heard of it. This list is kept because
the conclusion drawn from it, that no useful public catalog exists, was wrong:

| Source | What it actually has |
| --- | --- |
| [sebj/iOS-Shortcuts-Reference](https://github.com/sebj/iOS-Shortcuts-Reference) | The file format only. **No action list at all**, and archived 2022-06-10 |
| [shortcuts-toolkit](https://github.com/drewburchfield/shortcuts-toolkit) | Legacy examples; says outright it "cannot access all Shortcuts actions (some are private)" |
| [Cherri](https://github.com/electrikmilk/cherri) | A working compiler, ~46 actions in its standard file, and it **does** model App Intents |
| [ShortcutsBench](https://github.com/EachSheep/ShortcutsBench) | **1,414 APIs across 88 apps**, far the largest, but shipped via Google Drive and Baidu behind a password with nothing in the repo tree |

None holds `CreateFolderAction`. The source everyone points at,
`WFActions.plist` inside
[WorkflowKit.framework](https://theapplewiki.com/wiki/Dev:WorkflowKit.framework),
needs the framework off a device and covers the **legacy family only**, since an
App Intents action is declared in its own app's metadata rather than there.

**So the dictionary can be widened and never completed**, which makes the
honest-search rule permanent rather than a stopgap.

*Correcting an earlier claim in this file:* Cherri was reported as covering the
legacy family only. That was read off its file-format **page**; its **source**
carries an `appIntent` struct of exactly `{name, bundleIdentifier,
appIntentIdentifier}`, independently matching the `AppIntentDescriptor` measured
above, and defines a couple of dozen App Intents actions including
`CreateShortcutiCloudLinkAction`. Reading a project's docs is not reading a
project.

**Bound to a variable, it is an ordinary attachment**, which is what makes these
reachable from a generated chain at all:

```xml
<key>target</key>
<dict>
  <key>Value</key>
  <dict>
    <key>OutputName</key><string>Shortcuts</string>
    <key>OutputUUID</key><string>…</string>
    <key>Type</key><string>ActionOutput</string>
  </dict>
  <key>WFSerializationType</key><string>WFTextTokenAttachment</string>
</dict>
```

So the working idiom is **find, then act**: `getmyworkflows` for every shortcut,
`filter.files` with an `Operator: 4` predicate on `Property: Name` carrying the
wanted name as a token-string attachment, then the entity slot bound to that
filter's output. `Use-Shortcut`, `Run-List`, and `Open-RecentShortcut` all do
exactly this, and `workflows/library-open.json` is the three-card minimum.

The variable binding is **measured for `target` and `shortcuts`**, the latter
confirmed 2026-08-15 by a generated `Library-Stage` moving a named shortcut on
device and reporting it back through the repo log. `entities` on Delete stays
inferred by analogy and is deliberately unexercised, since nothing here deletes.

`folder` was reported here as the exception with no way around it, on the
grounds that no action in the dictionary returns the folder list. **That was
wrong, and the way it was wrong is the point.** The claim was true about the
dictionary and false about Shortcuts:

```xml
<key>WFWorkflowActionIdentifier</key>
<string>com.apple.shortcuts.CreateFolderAction</string>
...
<key>name</key>   <!-- a WFTextTokenString, not an entity slot -->
<dict><key>Value</key><dict>
  <key>attachmentsByRange</key><dict><key>{0, 1}</key>
    <dict><key>Type</key><string>ExtensionInput</string></dict></dict>
  <key>string</key><string>￼</string>
</dict><key>WFSerializationType</key><string>WFTextTokenString</string></dict>
```

`CreateFolderAction` exists, and unlike every other action in this family **its
`name` takes plain text**, so a folder can be made from a string. Whether its
output is a folder entity the Move card will accept is untested; if it is,
create-then-move removes the last configuration step from a fresh install.

**Why no search found it.** It is absent from `actions.json`, which knows only
nine `com.apple.shortcuts.*` entries, and absent from the corpus, which never
used it. Both sources were checked and both were silent, and silence was
reported as absence. `tools/coverage.py` measures the first gap (312 identifiers
in use, 56 unknown to the dictionary, 18%) and cannot close the second. **The
dictionary is a curated list and the corpus is one library's habits; neither is
a census of what Shortcuts can do.** A search that finds nothing supports "I did
not find one", never "there is none".

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
