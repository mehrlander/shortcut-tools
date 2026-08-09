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

[`docs/dataflow.md`](https://github.com/mehrlander/shortcut-tools/blob/agent/document-shortcuts-dataflow/docs/dataflow.md)
is the complementary half: this file covers how a shortcut is **serialized**,
that one covers how values **flow at runtime**, including the observation that
an `If` whose condition fails still passes its incoming value through. It is
landing via PR #3, so the link above points at that branch; repoint it at `main`
once it merges.

## Checks

`npm test` runs `test/actions.test.js` (the dataset holds its shape: every value
parses, every identifier is well formed, the multi-variant entry is the only one,
nothing carries a `GroupingIdentifier`) and `test/builder.test.js` (`add()`
refuses control flow, every block is balanced and shares one grouping, presets
merge, the serializer escapes markup). Node's built-in runner, no dependencies.

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
