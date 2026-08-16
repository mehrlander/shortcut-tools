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
every chain's payload to [`packed/`](../packed/), and `--url` emits a link that
carries the address instead of several thousand characters of base64:

```bash
python3 tools/pack.py workflows/<chain>.json --url            # main
python3 tools/pack.py workflows/<chain>.json --url --ref <branch>
```

That is about 150 characters, it is legible, a wrong character 404s instead of
misreporting, and it tracks the ref rather than freezing a snapshot. The
embedded form remains correct and remains necessary for a payload that is not
committed or not public. `--check` fails when `packed/` is behind `workflows/`,
and the suite runs it.

`--url` exists because this section previously showed the URL shape and nothing
emitted it, so it was assembled by hand on every use, which is the exact failure
`packed/` was built to end: the sender types a long string and the reader cannot
tell a wrong one from a right one. **Emit both forms, never type either.**

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
| `dump-folder-zip` | The same folder, as a zip. Four actions: `Get Dictionary from Input` keys the shortcuts by name, `Make Archive` compresses. The shortest route and the one to prefer. |
| `dump-folder` | One folder's shortcuts as JSON lines. `Get My Shortcuts` takes a `Folder` parameter set to Ask Each Time, so the folder is chosen at run time and is the size control. |
| `dump-selected` | Pick shortcuts from a list, copy them as JSON lines. Self-contained: it does the export itself rather than calling `Use-Shortcut`, and the picker is the size control. |
| `copy-action-from-url` | Fetches a packed payload and hands it to `Copy-ActionFromClaude`. Two actions, and the last one that ever has to arrive as an embedded payload. |
| `run-steps` | Runs named shortcuts in order, piping each result into the next. One shortcut instead of one per sequence, which only became possible once a variable could name the target. |
| `show-menu` | Renders whatever menu it is handed. Four actions: name the text `.vcf`, coerce it to contacts inside Choose from List, read the chosen row's Notes, open it. The receiver for `vcard.py --data`. |
| `run-html` | Renders whatever page it is handed. Three actions: base64-encode Shortcut Input, build the data URL, open it. The receiver for [`tools/show.py`](../tools/show.py) when the page needs no credential. |
| `show-html-js` | `Show-Html`'s job in 9 actions instead of 23, with the text work moved into the page it is about to open. Reads [`tools/show-shell.html`](../tools/show-shell.html). |
| `show-toss` | `Show-Html` with its last stage swapped: gzip the page and open it in web-tools' toss renderer instead of a `data:` URL. The double back tap's render path, moved into the estate. |
| `toss-html` | The four-action version, `run-html`'s analogue for the hosted route: base64 the input, open `toss-render.html#html=`. No credential, no repairs. |
| `keep-render` | Commits the page it is handed to `web-tools-private/renders/` and puts its blob link on the clipboard. The record a `data:` URL could never leave. |
| `dupe-probe` | One empty comment, imported twice, to see which copy keeps the name. The probe behind the delete-before-importing rule. |
| `self-name` | Reads the shortcut's own name out of `Managed/config.json` and re-enters itself with it, so a rename cannot break a caller. |
| `trace` | One timestamped log line behind a `Trace` flag. The debug idiom the library does not have. |

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

Both were read from real exports on 2026-08-13, having been inferred from
behavior until then. `Show-Html` runs five stages in an order that matters, the
placeholder turns out to be a key in `Shortcuts/Managed/config.json` rather than
an arbitrary sentinel, and one of the four text repairs is a dangling branch
that never runs. All three in
[`docs/shortcuts-format-notes.md`](../docs/shortcuts-format-notes.md).

## `show-html-js`: the same job, mostly in JavaScript

`Show-Html` is 23 actions and calls a 10-action injector. Most of that is text
work: decide whether the input is a page or a URL, fetch it if it is a URL,
substitute two values, run four regex repairs. All of it is string manipulation,
and the route already ends by handing the result to a JavaScript engine. Doing
it in Shortcuts is doing it in the worse language, one action per operation.

[`tools/show-shell.html`](../tools/show-shell.html) is a fixed page that does
that work in about thirty lines, and `show-html-js` is the nine actions around
it: base64 the input, base64 the clipboard, load the shell, replace two slots,
call the injector for the third, base64 the result, open it. Nine plus the
injector's ten, against twenty-three plus the same ten.

Three things fall out of the shape rather than being designed in.

**The payload is base64, so it is opaque to the substitutions.** The replaces
run against the shell, which means a page that itself mentions
`📋ClipboardBase64` cannot be rewritten out from under itself. Its own
placeholders are resolved in JavaScript afterwards, against the same values.

**The repair runs before the substitutions**, not after as the shortcut does, so
a value carrying a curly quote is delivered as written.

**The dead branch cannot recur.** Two `text.replace` actions reading the same
source is invisible in the editor; two lines of JavaScript in sequence are not,
and a test runs them.

Two differences worth stating rather than discovering.

**The shell always carries the token**, where the shortcut gave it only to pages
containing the placeholder. The shell has to hold it because a page fetched from
a URL is not visible to Shortcuts at substitution time, and that is the case the
committed pages use. The data URL goes straight to Safari on the device, which
is the same exposure the shortcut already had for a token-bearing page, but it
now applies to every page sent through this route.

**It calls `Inject-🎟️GitHubToken` rather than inlining the file read.** Inlining
would need a `WFFile` location carrying a `crossDeviceItemID` and a
`fileProviderDomainID`, both minted per install, which is the same portability
problem as a pinned `workflowIdentifier`. The name resolves anywhere; the file
reference does not.

The payload is 14,190 characters, well past where a pasted link stops being
trustworthy, so take it from [`packed/`](../packed/) by address.

## `show-toss`: the same render, ending at web-tools instead of a `data:` URL

The double back tap is `Back-DoubleTap`, whose file declares
`WFWorkflowNoInputBehaviorGetClipboard`, so a tap with nothing shared hands the
shortcut the clipboard. Its last branch tests that input for `<` **and**
`` ``` ``, and a match goes to `Show-Html`; everything else goes to `Show-Loop`.
So the flow the user actually runs is: copy a chunk of HTML out of a chat, tap
the back of the phone twice, and `Show-Html` opens it.

`Show-Html`'s first four stages are the interesting ones and none of them
change. What changes is stage five, seven characters of intent: instead of

```
data:text/html;charset=utf-8;base64,<page>
```

it opens

```
https://mehrlander.github.io/web-tools/pages/toss-render.html#gz=<page>
```

**No web-tools change was needed for this.** `toss-render.html` already
documents three payload routes, `#gz=` (base64 of gzipped HTML), `#html=`
(base64 of plain HTML), and `#url=`, and its `b64Bytes` accepts the standard or
the URL-safe alphabet, padded or not. Shortcuts' `base64encode` emits the
standard alphabet with padding, so the two meet with no conversion step.

Gzip is one action, `makezip` with `WFArchiveFormat: "gz"`, already proven in
the corpus by `Show-HtmlViaZip`, which used it to squeeze a page into a `data:`
URL and then decompressed it in the page with `pako`. The hosted renderer does
that half already, so `show-toss` keeps the compression and drops the shim.
Four actions carry it: name the text, coerce it, archive it, base64 it.

What the swap buys, in steady state:

- **The render has an address.** A `data:` URL cannot be sent to anyone or
  reopened later. A toss link is a link.
- **The page arrives inside the toolbox.** toss-render mounts the FAB, so Copy
  toss link, the take menu (rendering copy, review brief, stage, offline zip),
  and the console tabs are on every render without the page knowing anything
  about them. `?w=390` on the renderer lays the same page out at phone width.
- **Compression.** The URL is roughly a quarter the length of the old `data:`
  URL for typical model-written HTML, which is headroom the previous route was
  spending for nothing.

Two things are deliberately unchanged. The token injection stays, so the 30-odd
library shortcuts that hand `Show-Html` a page carrying `🎟️GitHubToken` behave
the same. And the token still rides in the URL, exactly as it did in the `data:`
URL, so the exposure is the same one the route always had, now in
`mehrlander.github.io` history rather than a `data:` entry.

One thing is dropped: `Show-Html`'s action 15, the anchored fence rule that
reads action 14 and feeds nothing. `docs/shortcuts-format-notes.md` found it
dead in the 2026-08-13 export, and a copy is the moment to stop carrying it.

### Rendering a payload is not the same as addressing a file

toss-render has a second way in, `#gh=owner/repo@ref:path`, which fetches the
file through the stored token and renders it **same-origin**. That mode is
gated to an owners allowlist, and `mehrlander` is on it.

So there is a route that looks tidy and is not: commit the pasted HTML to a repo
you own, then address it. It would give a short permanent link and a log in one
step. It would also run model-written markup on the origin that holds the
GitHub token in `localStorage`, which is the exact thing the payload sandbox
exists to prevent. Committing untrusted HTML into a repo on the allowlist
launders it past the allowlist.

That is why the two jobs are two chains. `show-toss` renders, as a sandboxed
payload, with no network round trip. `keep-render` commits, and hands back a
**blob link** rather than a toss address, so keeping a copy never silently
upgrades what that copy is allowed to do. Tossing a kept render stays available
and stays a deliberate act.

`keep-render` is `log-repo` with a different path and one reordering:
`log-repo` writes the clipboard first so a failed commit still leaves the result
in reach, while `keep-render` reads the input first and writes the link last, so
a failed commit leaves the page itself on the clipboard. Either way the cheap
path survives the expensive one failing.

## The two mechanisms the device library lacks

[`docs/idioms.md`](../docs/idioms.md) reads all 577 shortcuts and finds the
design mostly better than a fresh start would produce. Two things it does not
have come from imported shortcuts, and both are here as chains.

**`self-name`.** A shortcut cannot ask its own name, so every self-call in the
library hardcodes one, and a rename leaves the caller pointing at nothing:
twelve live instances of exactly that. `vCard Menu Creator` solves it by
keeping its name in a config dictionary and re-entering with
`run $Settings[Name]`. Five actions:

```
get file config.json
set Settings
text $Settings[SelfName]
set SelfName
run $SelfName
```

The last action is the confirmed variable-target `runworkflow`, so this only
became writable once that probe ran on 2026-08-12.

**`trace`.** One timestamped line, guarded by a `Trace` variable, so a shortcut
can say what it saw without a dialog. `Multi-stop navigation` guards 52 traces
this way. The chain stops at building the line rather than appending to a file,
because the destination is a per-library choice and a file action pins a
device-local location.

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
is reconstructed rather than looked up. Three tiers applied here, and as of
2026-08-13 the inferred tier is empty. The five actions inherited from
`js-data-url` are confirmed by a chain that runs. `runworkflow` is confirmed
against a real export, including the `WFWorkflow` dict and its device-local
`workflowIdentifier`, which a chain cannot invent and has to read off the device
it will run on. `run-html` is confirmed by a device run on 2026-08-11, which
promotes `openurl` and the `ExtensionInput` attachment it reads its page from,
and a generated menu ran on 2026-08-12, which does the same for `choosefromlist`
and its contact coercion.

The last four came from the library itself. Ten folder dumps hold 211 shortcuts,
and reading them against these chains confirms `text.split` and `text.replace`
(76 uses of the latter, every key optional), `WFChooseFromListActionPrompt`, and
the `Notes` property `show-menu` reads the chosen row's action from. The device
carries its own `Show-Menu`, and it matches the chain here action for action
apart from a trailing `showresult`. Details in
[`docs/shortcuts-format-notes.md`](../docs/shortcuts-format-notes.md).

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

## Three dumps, and which to use

`dump-folder-zip` is the one to reach for: four actions, names preserved, and
compressed. `Get Dictionary from Input` over a list of shortcuts keys them by
name, which removes the whole reason the other two pair `Get Name` with `Get File
of Type` by hand, and `Make Archive` answers the size question that folder
scoping only bounds.

The other two remain because they emit **text**, which a diff can read and a
reviewer can skim. A zip in a repository is one opaque blob per commit. So the
zip is the transport, and unpacking it into per-shortcut files is a job for the
repo rather than the device.

## Why `dump-selected` exists beside `dump-shortcuts`

`dump-shortcuts` is three actions because it delegates to `Use-Shortcut`, which
already knows how to export and combine. That is the smaller chain and the one to
read first, but it inherits a dependency and it dumps everything.

`dump-selected` does the export itself: `Get File of Type` with `public.json` per
shortcut, paired with `Get Name` because **a shortcut's plist does not contain its
own name**. The output is one JSON object per line rather than one array, which
means a single run cannot be broken by one unencodable name, and a splitter reads
it a line at a time rather than holding the whole library in memory.

The picker is the size guard. `Choose from List` with multiple selection and a
select-all button lets a first run take five shortcuts, which answers whether the
route works before anything large is attempted.

One known sharp edge: the name is interpolated into JSON as text, so a shortcut
named with a `"` or a `\` produces a line that does not parse. The push page
counts unparseable lines rather than hiding them.

## Reading a dump back

[`tools/index-dump.py`](../tools/index-dump.py) takes the zip and prints what
each shortcut is and what it calls, which is the part a pile of `.wflow` files
does not give you:

```bash
python3 tools/index-dump.py dump.zip --json index.json
```

The call graph reads `runworkflow` targets by name, ignoring the device-local
identifier, and separates three cases worth separating: a **computed** target,
which is a name resolved at run time and therefore invisible to static reading;
a target **named but absent** from the dump, which is how a folder-scoped dump
tells you what it depends on outside itself; and a shortcut **called by nothing**,
which is either an entry point or dead.

One encoding detail it has to handle: zip filenames are UTF-8 bytes with the
UTF-8 flag usually unset, so a naive reader decodes them as cp437 and every
emoji-named shortcut arrives as mojibake. `Inject-📲Fetch` is the tell.
