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
| `copy-action-from-url` | Fetches a packed payload and hands it to `Copy-ActionFromClaude`. Two actions, and the last one that ever has to arrive as an embedded payload. |
| `run-steps` | Runs named shortcuts in order, piping each result into the next. One shortcut instead of one per sequence, which only became possible once a variable could name the target. |
| `show-menu` | Renders whatever menu it is handed. Four actions: name the text `.vcf`, coerce it to contacts inside Choose from List, read the chosen row's Notes, open it. The receiver for `vcard.py --data`. |
| `run-html` | Renders whatever page it is handed. Three actions: base64-encode Shortcut Input, build the data URL, open it. The receiver for [`tools/show.py`](../tools/show.py) when the page needs no credential. |
| `show-html-js` | `Show-Html`'s job in 9 actions instead of 23, with the text work moved into the page it is about to open. Reads [`tools/show-shell.html`](../tools/show-shell.html). |
| `self-name` | Reads the shortcut's own name out of `Managed/config.json` and re-enters itself with it, so a rename cannot break a caller. |
| `trace` | One timestamped log line behind a `Trace` flag. The debug idiom the library does not have. |
| `local-open` | Reopens a copied loopback URL against the PC's LAN address. Three actions: read the clipboard, rewrite the host, open it. For a local app that prints `http://127.0.0.1:<port>/?token=...`, which is an address only the PC can resolve. |

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
