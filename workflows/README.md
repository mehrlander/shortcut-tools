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
| `sync-manifest` | The shape of the whole library (name, action count, last modified) committed to the repo in one tap. What the corpus should be compared against before anything is exported. |
| `dump-recent` | Every shortcut modified in the last N days, contents and all, committed in one tap. The device does the choosing, so nothing has to come back here first. |
| `dump-named` | Exports only the shortcuts named in its input and commits them back. The precise form, for when a manifest has already said which. |
| `get-shortcut-json` | One named shortcut as JSON, name included, **returned rather than sent**. Seven actions: a sample default through an else-less If, Filter Files to resolve the name, and `public.json` for the body. Nothing leaves the device. Not named `Get-Shortcut`: the device already has one, and three shortcuts run its result. |
| `dump-shortcut` | The same result, delivered. Five actions: call `get-shortcut-json`, stamp `op` and `build` onto the dictionary it returns, hand it to `Log-Repo`. The whole delivery half, and it owns no retrieval of its own. |
| `run-app-determined` | The current app picks the shortcut and the map is the data: seven actions, a literal dictionary of app name to shortcut name, a lookup, and one Run Shortcut on a computed target. Replaces a ladder of app tests where each arm needed its own Stop and Output. |
| `copy-action-from-url` | Fetches a packed payload and hands it to `Copy-ActionFromClaude`. Two actions, and the last one that ever has to arrive as an embedded payload. |
| `run-steps` | Runs named shortcuts in order, piping each result into the next. One shortcut instead of one per sequence, which only became possible once a variable could name the target. |
| `run-pick` | Pick a verb from the input list, one name per line, and run it on the clipboard, then show what came back. Run it bare and the self-demo prologue supplies a default menu and re-enters, the idiom 72 shortcuts in the corpus carry. Eleven cards, no `Get-Shortcut`: Run Shortcut's target is a plain string key, which `run-steps` already relies on. The two-shortcut version that passed `[payload, verbs]` through Run Shortcut is gone; the list arrived text-coerced and the menu offered the payload as a choice. |
| `show-log` | The device log as a sheet over Shortcuts, one action. A hosted `https` URL rather than HTML text: Show Web View takes either, but HTML text lands at a `file://` origin where the stored GitHub token is not, and the page needs it to read a private repo. Replaces Show Result, which clipped a long payload and would not scroll. |
| `probe-list-handoff` | Whether a list survives `Run Shortcut`, settled by crossing the boundary into **itself**: bare it builds a two-item list and re-enters, and on the second pass it counts what arrived and logs it. `count=2 first=AAA` means lists survive and two arguments can be passed between shortcuts; `count=1` means they cannot, which is what `Run-Pick`'s five-row menu implied. |
| `show-menu` | Renders whatever menu it is handed. Four actions: name the text `.vcf`, coerce it to contacts inside Choose from List, read the chosen row's Notes, open it. The receiver for `vcard.py --data`. |
| `run-html` | Renders whatever page it is handed. Three actions: base64-encode Shortcut Input, build the data URL, open it. The receiver for [`tools/show.py`](../tools/show.py) when the page needs no credential. |
| `show-html-js` | `Show-Html`'s job in 9 actions instead of 23, with the text work moved into the page it is about to open. Reads [`tools/show-shell.html`](../tools/show-shell.html). |
| `self-name` | Reads the shortcut's own name out of `Managed/config.json` and re-enters itself with it, so a rename cannot break a caller. |
| `trace` | One timestamped log line behind a `Trace` flag. The debug idiom the library does not have. |
| `log-repo` | The return channel. Writes the input to the clipboard first and unconditionally, then commits it to `shortcuts/log/` in web-tools-private, so a diagnostic ends in a commit rather than in a question. |
| `capture-link` | The share sheet's end of that channel: whatever was shared, straight into the repo log. Two actions. |
| `library-open` | Opens a named shortcut in the editor. Three actions, and the cheapest thing the library view does. |
| `library-install` | Creates the named shortcut and pastes its actions in. Superseded by `library-import` wherever a plist is committed, because no paste reaches file-level settings. |
| `library-import` | Fetches a generated plist, gzips it, remote-signs it, and hands it to Shortcuts. The only route that delivers `WFWorkflowTypes` and the input classes, at one tap plus Apple's import sheet. Its worker is third-party and intermittently returns a non-archive, which surfaces as "Unrecognized archive format"; retry once before suspecting the plist, and fall back to `library-install`, which skips the worker. |
| `library-replace` | Delete by name, then import. The way around import never merging: importing over an existing name lands as `Name 1`, and every `run-shortcut?name=` link keeps resolving to the old copy. |
| `library-stage` | Moves each named shortcut to a folder and logs it. The second step of the prune, and deliberately not the fourth. |
| `manage-library-probe` | The three library actions whose parameter shapes were unknown, in one tap: open, move, delete. |
| `ask-report` | Walks a list of questions, asks each in turn, and commits the whole transcript through `Log-Repo`. A battery of probes comes back as one commit instead of one message each. |
| `probe-step` | The same job interleaved: each tap asks about the probe the last tap fired, commits that answer, then fires the next probe. |
| `back-doubletap` | The double back tap dispatcher itself, 59 actions, recovered from the 2026-08-22 device dump so it can be revised here and re-installed in one tap. Dispatches on the current app, then on the clipboard's type; an empty clipboard opens the dictation page in the sheet and everything else falls to `Show-Loop`. Pasted HTML goes to `Show-WebView` rather than `Show-Html`, so a quick look costs no Safari tab. |
| `describe-input` | The same job as `get-file-info` in 17 actions, one shortcut, one text card and no Run Shortcut anywhere. The floor is what only Shortcuts can do: walk the items, read each one's name, type and bytes, and hand one page to the renderer. Everything above that is text assembly, so it went into the function. |
| `get-file-info` | Describes the input for a menu title: type, filename, preview, and a rendered caption. The one chain here whose original lives on the device rather than in this repo, carried in as source so the list-shape fix could ship; `web-tools-private`'s `shortcuts/core/` copy is a corpus snapshot, refreshed by dumps, not the authored version. |
| `probe-list-detail` | Builds a two-item list and sends it through `Get-FileInfo` and then `Get-FileCaption`, logging each. The regression probe for the list-shape bug: no link can put two items on a clipboard, so the probe makes its own. Two log entries means fixed, one means the caption path is still broken. |
| `probe-webview-caps` | The remaining sheet questions in one run: origin, secure context, `DecompressionStream`, SpeechRecognition, localStorage, a jsDelivr script tag, the microphone, and both copy paths. It returns itself through a Send results link firing `Log-Repo`, because the first version routed its answer through the clipboard and the clipboard was one of the things it was measuring. |
| `probe-webview-net` | The follow-on: the same sheet, a page that fetches `api.github.com/zen` and reports OK, BLOCKED, or nothing. Scripts run in the sheet, so whether it also reaches the network is what decides if the estate's pages can move off the Safari navigation. |
| `probe-webview` | Hands a one-line page whose script rewrites that line to `Show-WebView`, the library's existing Show Web View receiver. Two actions, because the receiver already exists and the only open question is whether its HTML-to-rich-text step survives a script. |
| `probe-quicklook` | Quick Looks a one-line page whose script rewrites that line. Settles whether `previewdocument` renders HTML as a live document or as inert markup, which decides whether the sheet is an alternative to `Show-Html`'s Safari navigation or only a viewer for static pages. |
| `probe-watch` | Brief, fire, ask, log, in one tap. Three lines in: what to watch for, what to run, what to answer. The alert blocks before the target runs and the question lands immediately after it, so nothing has to be remembered between taps. |
| `dictate` | Opens web-tools' full-page voice capture surface in the Show Web View sheet. One action, and the shortest thing in this table on purpose: Back Tap can run a shortcut and cannot open a URL, so this exists to be the target of a back tap (or an Action Button, or a Control Center control) rather than to be run from the app. The sheet keeps the page on its own `https` origin, which the HTML-text route does not. |
| `probe-tab-js` | Whether `Run JavaScript on Web Page` accepts a Safari **tab entity** rather than only a shared page. Find Tabs, count them, log; then run one line in the first tab and log that. Two commits in that order, so a failure at the second card still proves the first worked, and no commit at all means the entity was what failed. If it passes, the bench needs no share sheet and the whole loop is one tap. |
| `probe-coercion` | Which of five inputs the rich-text coercion actually renders, logging each before the next runs. Its withdrawn predecessor came back as one empty line and could not say whether the coercion refused a `data:` URL, ran no script, or timed out on the network; these five separate those. Static HTML, a script that rewrites its own line, a real `https` URL, the sync/async network pair, then the CDN library page. Read the first empty line: everything above it worked. |

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

## Two walkers, and why one asks before it runs

`ask-report` and `probe-step` do the same job and differ only in ordering, which
is the whole lesson. Both exist because diagnosing across chat was costing one
message per probe while the probes themselves ran in seconds.

`ask-report` collects: hand it a list of questions, it asks each in turn and
commits the transcript through `Log-Repo`. It deliberately does not run the
probes. Shortcuts has no error handling, and a crashing probe is exactly what
these batteries test, so a walker that ran them would die at the first failure
and lose the answers already collected. Splitting run from report sidesteps
that, since the probe links stay separate taps and cannot take the transcript
down with them.

`probe-step` interleaves instead, and is the better shape for the same reason.
Each tap asks about the probe the **previous** tap fired, commits that answer
through `Log-Repo`, and only then runs the next probe. Asking before running is
what makes it crash-safe: a probe that dies takes down whatever follows it in
the same run, so putting the ask at the top of the next run means a crashed
probe still gets reported. A single looping walker cannot have that property.
Each step commits its own question and answer, so nothing has to survive
between runs. Three lines in, with `-` standing for an absent question, target,
or payload.

The value of an in-flow question is that it arrives while the screen is still in
front of you, so the answer needs no explanation of what it answers. That is
what `ask-report` misses by collecting after the fact, and it is the reason
`probe-step` is one step per tap rather than one loop over everything.

Drive either with [`tools/run.py`](../tools/run.py), which emits the tappable
link rather than asking anyone to type one.

### `probe-step` ran, 2026-08-23

Two taps, both branches. The first carried `-` as its question and a target, and
committed its payload without asking anything. The second carried a question and
`-` for both target and payload, asked, committed the question and the answer
together, and fired nothing. So the split, the `-` conditionals, the
run-by-variable target, and the `Log-Repo` return all hold on device.

The second tap also demonstrated the rule it broke. It asked whether the first
tap's commit had landed, which is a fact `shortcuts/log/` already held, so the
tap bought nothing and the answer said so. A probe asks what only the device
knows: what the Ask dialog rendered, whether a banner or a permissions sheet
appeared, what Apple's UI decided. Anything a file in this estate can answer is
answered here before the link is sent. Written up in
[`CLAUDE.md`](../CLAUDE.md#a-diagnostic-returns-itself).

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

## Installing one, rather than pasting it

A chain that declares a `name` gets a plist in [`plists/`](../plists/), and
`Library-Import` installs one from a URL. That link is emitted, not typed:

```bash
python3 tools/plist.py workflows/<chain>.json --link            # main
python3 tools/plist.py workflows/<chain>.json --link --ref <branch>
```

It carries two lines, the name to install under and the plist to fetch, which is
the shape `Library-Import` splits on. The form was recorded here and in the
device log and nowhere emitted, so it was reassembled by hand on every install:
the same failure `--url` already fixed for the paste route, and the same fix.

**Importing never merges by name**, so the new copy becomes `Name 1` and every
`run-shortcut?name=Name` link keeps resolving to the old one. Delete the existing
copy first for anything generated from this repo, where the plist is the source
and a re-import costs nothing.

## Keeping the corpus current without re-dumping it

**One tap, if you just want the recent work off the phone.** `dump-recent`
filters Get My Shortcuts to those modified in the last N days and commits each
one with its contents to `shortcuts/incoming/<stamp>.txt`. N rides in the link
(`…?name=Dump-Recent&input=text&text=7`) and falls back to 7 when the shortcut is
run bare from the Shortcuts app, so nothing is ever typed at run time. Fractions
work, since the window is arithmetic rather than a calendar unit: `0.5` is twelve
hours.

**Days are multiplied to minutes rather than declared as days, deliberately.**
The date filter takes a `Unit` enum, and minutes (`64`) is the only value that
appears anywhere in the corpus, in `Open-RecentShortcut`, whose own label
annotates its value with an `m`. `64` is also `NSCalendarUnitMinute` in
Foundation's bit-flag enum, which would make days `16` by the same reading. That
is a sound inference and still an inference, so the chain multiplies by 1440 with
a Math action and passes minutes. One extra action buys a parameter that does not
depend on being right about an enum nobody here has run.

**A window is not self-limiting the way a count is**, so the filter carries a
hard cap of 150. Widen the window far enough and an uncapped PUT is the whole
library. The chain has no channel to report what it dropped, so
`read-incoming.py` flags a dump that arrives at exactly the cap as probably
truncated. The cap was 60 until the first real 7-day window returned exactly 60:
the whole window by luck rather than a truncation, and one more edit that week
would have lost data silently. The size fear behind the original number was also
wrong, since that run committed 7.2 MB through the API without complaint.
[`tools/read-incoming.py`](../tools/read-incoming.py) reads the result and
`--zip` writes it as a dump the existing pipeline already accepts:

```bash
python3 tools/read-incoming.py <incoming.txt> --zip recent.zip
python3 tools/index-dump.py shortcuts/dumps/*.zip recent.zip --json shortcuts/index.json
```

That is the whole loop for the common case. The two-step below is the precise
form, worth it when the question is "exactly which ones does the corpus lack"
rather than "give me the recent work", since `dump-recent` cannot know what the
corpus already holds and will re-send anything that happens to be near the top.

### Get returns, Dump delivers

Two verbs, and the split is the point rather than the tidiness. `get-shortcut-json`
resolves a name and hands back `{"name": …, "shortcut": …}`. It writes nothing,
reaches no network, and can be called from anything that wants a shortcut's
contents. `dump-shortcut` is the delivery half: it calls `get-shortcut-json`, sets
`op` and `build` on the dictionary that comes back, and passes it to `Log-Repo`,
which owns the stamp, the clipboard fallback, the token and the PUT.

So the network appears exactly once in the library, in `Log-Repo`, and the
retrieval appears exactly once, in `get-shortcut-json`. A chain that wants one
shortcut's contents for some other purpose calls the getter and pays nothing for
delivery it does not want.

**The name is `Get-ShortcutJson`, not `Get-Shortcut`, and that is not
fastidiousness.** The device already carries a `Get-Shortcut`, and
`Share-ShortcutResult`, `Get-StructuredInput` and `Run-Choice` all do
`run «Get-Shortcut»` with its result: its contract is a name in and a
**runnable shortcut** out. Returning JSON under that name would break three
callers silently, since a Run Shortcut card handed a JSON string fails at run
time rather than at install. A getter that returns a different type is a
different verb.

**`op` and `build` are set as dictionary keys, not spliced into the text.**
`Set Dictionary Value` takes the dictionary explicitly (`WFDictionary`, present
in 343 of the 374 real cards in the corpus), so nothing re-serializes the
payload and `name` stays at the top level where `tools/log.py` reads it for the
row. The alternative, building a second JSON string around the first, is the
`Say "hi"` quoting hazard again for no gain.

### The app is a key, not a branch

`Back-DoubleTap` tests the current app five times, and each test is three
control cards plus a body plus a Stop and Output. `run-app-determined` is the
same dispatch as a lookup: a literal dictionary, one `Get Dictionary Value`
keyed on the app, the else-less If for the default, and one Run Shortcut on the
result. Seven actions.

**The card shape is not invented.** [`Nav-CurrentApp`](https://github.com/mehrlander/shortcut-tools)
has been keying a dictionary on `Get Current App` on device since the 2026-08-13
dump, and its keys are plain display names (`ChatGPT`, `Claude`). That is how we
know an app coerces to its display name in a key slot, without spending a probe
on it: only four shortcuts in 636 use `Get Current App` at all, and that one
answers it.

**It reads the app rather than taking one.** Handing in an app name *and* a
payload is two arguments across a `Run Shortcut` boundary, which
[`probe-list-handoff`](probe-list-handoff.json) exists to settle and which has
never been run; `Run-Pick`'s five-row menu is the only evidence and it points at
no. Reading the app in place sidesteps the question and leaves the single input
slot for the payload.

**The map is data and it is in the file.** `WFDictionaryFieldValueItems` is
plain key and value strings, as diffable as any other parameter, so a route
changes by editing the chain and reinstalling. The one real cost is that a
target name stops living in `WFWorkflowName`, which is the only field the
by-name audit in `CLAUDE.md` used to read. That audit reads dictionary values
now.

### A default in three actions

[`docs/dataflow.md`](../docs/dataflow.md) owns the mechanism: Shortcuts carries
a current value, a non-matching `If` preserves it, and the End If result can
therefore be the value that survived the block rather than one created inside
it. The idiom that falls out of it is worth naming here, because it replaces a
shape this repo still ships.

```
if $input no value
  text Choose-Sample
end if
… «End If» is the name to use
```

Three actions, no variable, no otherwise branch: the input when there is one and
the literal when there is not. The shape it replaces is six, which is what
`dump-recent` still does for its `Days` parameter.

**The corpus runs it 82 times across 36 shortcuts**, counted as End If outputs
consumed downstream where the group carries no `WFControlFlowMode` 1, led by
`Shortcut Source Tool` at seven and `Get-ShortcutSource` at five. The ordinary
two-branch read appears 473 times, so the pass-through is about a sixth of all
End If reads and not a trick.

**Where the literal is a real name, running the chain bare demonstrates it.**
`get-shortcut-json` defaults to `Choose-Sample`, so a tap with no input returns a real
shortcut rather than failing, the same self-demo prologue [`run-pick`](run-pick.json)
carries and that 72 shortcuts in the corpus use.

### One wire format, because the others are derivable

`Get file of type public.json` returns the **whole workflow**, every top-level
key: the actions, the icon, `WFWorkflowTypes`, the input classes. Not the action
list alone. So the XML plist and the indented sketch are both views the repo can
render from what the device already sends, and asking the device which format it
should produce buys nothing.

Measured over the 636 shortcuts in the dumps: **633 round-trip plist to JSON to
plist unchanged.** The three that do not are the whole argument for ever asking
for XML, and they fail on two plist types JSON has no representation for:

| Shortcut | Type | Where |
| --- | --- | --- |
| `Quick Actions` | `<data>` | `WFSendMessageActionRecipients`, serialized contact cards |
| `Grok AI Chat` | `<data>` | `UserActivityData` |
| `Anmod om kørsel af "past photo review"` | `<date>` | a bounded-date filter template |

JSON is also half the size: `Back-DoubleTap` is 22,834 bytes as the device sends
it and 47,866 rendered back to XML. So the rule is JSON on the wire, and a
format switch is worth its actions only for a shortcut carrying `<data>` or a
`<date>`, which is now a thing that can be predicted rather than discovered.

### The precise form: manifest, then named



A full dump is fourteen zips and a five-command regeneration, which is the right
cost once and the wrong cost weekly. `sync-manifest` and `dump-named` are the two
halves of the cheaper loop, and neither asks the user to decide anything:

1. **`Sync-Manifest`** reads Get My Shortcuts, formats the three properties that
   are available without serializing anything, and PUTs the result to
   `shortcuts/manifests/<stamp>.txt` in web-tools-private. 33 KB for 633
   shortcuts, measured. One tap, no page, no prompt.
2. **[`tools/manifest-delta.py`](../tools/manifest-delta.py)** compares it against
   the committed `index.json` and prints what is added, removed, and changed,
   followed by ready-made `Dump-Named` links with the names already in them.
3. **`Dump-Named`** exports exactly those and PUTs them to
   `shortcuts/incoming/<stamp>.txt`.

The manifest is **marker text, not JSON**, and the sharp edge named above is the
reason. Shortcuts has no escaping primitive, so a JSON row built by interpolating
a name breaks on a shortcut called `Say "hi"`, and it breaks the whole run rather
than one row. The marker template is instead the one `Get-ShortcutsInfo` already
proves works on this device, and the parsing moves to Python, where escaping
exists. `dump-named` carries its records the same way, which is what lets it
succeed on a name `dump-selected` would fail on.

Both chains open with an unconditional clipboard write before touching the
network, copied from `log-repo` rather than reinvented: a failed commit should
degrade to the cheap path, not lose the export.

### What the first device run changed

Run 2026-08-18, and it corrected the design twice. Both corrections are in the
shipped code; this records why, since neither is guessable from the chain file.

**The manifest arrives column-major.** A Text action evaluates its template
once and expands each attachment into a newline-joined column, so the file is
`==name==` followed by all 633 names, then `==actions==` followed by all 633
counts, and so on. It is not one record per shortcut. The parser had been
written to accept two possible join styles, and the real shape was a third, so
the tolerance bought nothing: the only thing that settled it was running it.

**Shortcuts drops an empty value when joining a list into text**, rather than
emitting a blank line. The first run returned 633 names and 578 folders, because
55 shortcuts sit in no folder, and nothing in the file says which 55. A column
holding any empty value therefore cannot be aligned with its siblings by
position. `folder` was removed from the template for that reason; the manifest
now carries only the three fields that cannot be empty, and the parser refuses a
file whose columns disagree rather than producing a plausible wrong answer.

Two smaller findings, both in `manifest-delta.py`:

- **A dump stores `/` as `:` in an entry name**, so `Unzip/Re-zip` on the device
  is `Unzip:Re-zip` in `index.json`. Two of the first run's three apparent
  deletions were this. The repair is narrow rather than a blanket substitution,
  since `REF: Edit iCloud JSON` is a real name with a real colon.
- **A corpus record that failed to parse has no action count**, and comparing
  against it printed `actions None to 29`, which reads as a change of unknown
  size. It is now named as what it is: the corpus never got a usable copy.
- **The export list was asking for receivers this repo authored.** A plist in
  `plists/` is rebuildable from git, which is the same reasoning that makes
  deleting one before an import free, so the device is no longer asked for it.
  Seven of the first delta's sixty-five, including the two chains being
  installed at the time.

### Launching a shortcut updates its modification date; being called does not

**Measured 2026-08-18 across two manifests taken 102 minutes apart, with the
runs in between known from the log.** An earlier note here said flatly that
running a shortcut moves its date. That was too broad, and the second manifest
disproved it.

| Shortcut | 19:49 | 21:31 | What happened between |
| --- | --- | --- | --- |
| `Sync-Manifest` | 19:49:20 | **21:31:17** | launched by URL, 21:31 |
| `Library-Import` | 19:16:54 | **20:56:25** | launched by URL, last at 20:56 |
| `Dump-Recent` | absent | **21:06:27** | launched by URL, 21:06 |
| `Inject-🎟️GitHubToken` | 2026-04-20 | 2026-04-20 | called as a sub-shortcut ~6 times |
| `Log-Repo` | 2026-08-15 | 2026-08-15 | called as a sub-shortcut 3 times |

Every shortcut launched from outside carries a date matching its last launch to
the second. The two that ran repeatedly **as sub-shortcuts**, invoked by Run
Shortcut from within the ones above, did not move at all: `Inject-🎟️GitHubToken`
still reads April.

So the rule is **top-level launch**, not execution. A `shortcuts://run-shortcut`
URL moves the date; a `runworkflow` card does not.

**What that costs the sync is less than the broader claim would have.** Only a
shortcut you launched yourself reports as changed, so the false positives are
confined to things you actually reached for, and a heavily used sub-shortcut
never generates one. The action count remains exact and independent.

**And it is what makes the Recent facet honest.** Ordering by this date is
ordering by what you last *launched*, which is the useful reading for a launcher
list. The limit worth knowing: a core shortcut that only ever runs as somebody
else's sub-step sinks to the bottom however heavily it is used, because nothing
here can see that traffic.

### The dumper could not dump itself

The first real dump was wide enough to include `Dump-Recent` and `Dump-Named`,
whose own text templates carry the record markers. The file therefore held
`==shortcut==` nine times where seven were records, an unanchored split cut two
records in half, and both were reported as malformed JSON. Anchoring every split
to a whole line fixes it, and is sound rather than lucky: JSON escapes a newline
as two characters, so a marker embedded in a serialized shortcut is never alone
on a line.

A manifest cannot be repaired the same way, because there a name genuinely does
sit alone on a line. A shortcut called exactly `==name==` opens a second column,
and the equal-length guard turns that into a refusal rather than a confident
wrong answer. That guard now earns its keep for two reasons rather than one.

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
