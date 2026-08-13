# Idioms of the library

*Read 2026-08-13, across all 577 shortcuts, from the pseudocode
[`tools/sketch.py`](../tools/sketch.py) renders. Frequencies are counted over
that whole corpus; the readings are of the 42 in the working core.*

**Reach, checked 2026-08-13 after a first draft overstated four of these.** A
raw frequency over 577 shortcuts is not evidence about the author's design,
because 237 of them are imported. Each idiom below carries the number of
shortcuts that use it and where they sit, and the table is the honest summary:

| Idiom | Shortcuts | Where they sit |
| --- | ---: | --- |
| Self-demo prologue | 72 | 17 core, 16 called, 27 uncalled, 6 residue, 6 imported |
| Menus | 79 | **54 imported**, 8 core, 12 uncalled |
| Calls `Choose-Sample` | 24 | 1 core, 3 called, 9 uncalled, 8 residue, 3 imported |
| Calls `Run-List` | 20 | 6 core, 2 called, 10 uncalled |
| Calls `Get-FileInfo` | 14 | 4 core, 2 called, 8 uncalled |

Only the first is broadly distributed. The rest are narrow, and the menu row
inverts the reading a raw count gives: menus are mostly an imported trait.

A library this size is not a pile of scripts. It has a design, arrived at over
years and never written down, and most of it is better than what a fresh start
would produce. This is what the corpus says the design is, what each pattern
buys, and what it costs. Where a pattern comes from an imported shortcut rather
than from this library, it is labelled, because those are worth stealing but are
not evidence about the author's own practice.

The point of writing it down is that the patterns are the specification for any
rebuild. A core library assembled without them would be a different, worse
library that happened to have the same verbs.

## 1. Every verb runs alone, and that is a test harness

**72 shortcuts open with the same guard**, and 55 call themselves somewhere
in the body.

```
if $input value?
  <build or fetch a sample>
  run <self>
  output
end if
<the real body>
```

Run it from the Shortcuts app with nothing selected and it demonstrates itself
on a sample. Call it from another shortcut and the branch is skipped. It costs
five actions and one branch.

What makes it more than a convenience is where the sample comes from.
`Choose-Sample` has **24 callers** and `Supply-Sample` 6. Only one of those 24
is in the core, and 8 are residue, so the injector is used more widely outside
the working set than inside it: the pattern is real and the core is not where
it is concentrated. Each offers a menu:
clipboard, a list, a JSON API, a fixed text, a URL, a shortcut, a snippet, a
question to Claude or ChatGPT, dictation. So the prologue is not a hardcoded
fixture, it is **dependency injection with a picker**: any verb can be exercised
against any input in the library without editing it.

It is the one property here a rebuild is most likely to drop, because from the
outside it reads as boilerplate. Calling it "the single most valuable" was the
first draft's phrase and is more than the evidence carries: 72 of 577 shortcuts
have the prologue, and it is the only idiom here spread across every tier
rather than concentrated in one.

**The cost, and it is real:** a self-call looks like recursion to anything
reading the graph, and it inflates every caller count. Read
[`docs/shortcuts-format-notes.md`](shortcuts-format-notes.md) on `isSelf`, and
discount self-calls before drawing conclusions.

## 2. The naming convention is executable

`Run-List` is 21 actions and it is the library's interpreter. Given a list, it
tests each item against:

```
^(?=.{1,30}$)[^\s-]+-[^\s-]+$   |   (?<=shortcut:).+
```

An item that looks like `Verb-Noun` and is under 30 characters **is run as a
shortcut**. Anything else becomes a parameter. An explicit `shortcut:` prefix
forces the first reading.

So `Verb-Noun` is not only a filing convention. Where `Run-List` is involved it
is a **type**, tested at run time.

**But its reach is 20 shortcuts, not 340,** and the first draft of this
paragraph claimed the convention held because breaking it broke `Run-List`.
That is unsupported. 340 names follow the convention and 20 shortcuts route
through the interpreter, so discipline explains the convention and `Run-List`
explains almost none of it. The mechanism is real and worth keeping; it is not
why the library is consistent.

Two consequences worth stating. A shortcut named with a space cannot be
dispatched, which is why every imported shortcut sits outside this machinery.
And a rename silently changes a value's type, from shortcut-to-run to
plain-parameter, with no error.

## 3. One type system, consulted by everything that dispatches on type

`Get-FileInfo` has **14 callers**, 4 of them in the core, and answers "what am I
holding." A core mechanism, not a library-wide one: the first draft of this
heading said "consulted by everything" and 14 of 577 does not support it. It
gathers context, folds it to JSON, and runs a 4,449-character JavaScript function to
produce a descriptor: `Type`, `detail.type`, `detail.fileName`,
`detail.caption`.

Everything downstream branches on that descriptor rather than inspecting the
value itself. `Show-Versions` is the clearest case, and it is a vtable written
in `if`s:

```
if Type is Text        run Get-SafariVersions
if Type is Rich Text   run Get-RtfVersions
if Type is URL         run Get-UrlVersions
if Type is Dictionary  run Get-JsonVersions
if detail.type Action  run Get-ActionVersions
```

The handler names are the type names. Adding a type means adding a
`Get-<Type>Versions` and one branch, which is a real use of the naming
convention even though, per idiom 2, the convention's consistency is not caused
by any mechanism.

## 4. JavaScript is the escape hatch, and there is one door to it

Shortcuts cannot do string work, JSON work, or anything algorithmic without
dozens of actions. The library's answer is to write the operation in JavaScript
and round-trip it through a `data:` URL. `Get-FromJs` is the primitive, and it
is four actions of real work:

```
text <script>document.write(encodeURIComponent(JSON…
base64
url data:text/html;charset=utf-8;base64,«…»
urlencode Decode
```

Everything else layers on it. `Get-JsonFromJs` coerces the result to
`public.json`. `Prettify-Json` is six actions, of which one is
`JSON.stringify(x,null,2)`. `Get-FileInfo`'s whole descriptor is one JS
function. `Show-Html` is the same trick with credential injection on top.

**The rule the corpus follows:** when an operation would take more than about
five actions, write it in JavaScript and call `Get-FromJs`. The 4,449-character
function inside `Get-FileInfo` would be several hundred actions expressed
natively, and unmaintainable.

There is a second door, `com.sindresorhus.Actions`'s
`TransformTextWithJavaScriptIntent`, used 47 times across 39 shortcuts. It
needs a third-party app where the `data:` route needs nothing.

## 5. A menu is the API surface

**Wrong 2026-08-13:** the first draft read the raw count, 1,961 uses across 79
files, as evidence that the menu is this library's API surface. It is not.
**54 of those 79 files are imported shortcuts**, and only 8 are in the core. A
menu is overwhelmingly how third-party authors present a shortcut, and the raw
frequency measures their habit, not this one.

What survives is narrower and still worth keeping. Two core shortcuts,
`Show-Convert` and `Get-Text`, are built as menus, and they are the two with the
widest surface.

`Show-Convert` is the pattern at full size, fifteen cases, each a conversion:
base64 either way, unzip, to dictionary, to markdown, to rtf, to html, link
summary, condense lines, fetch. No case is longer than four actions.

Where a verb has many operations, the menu is why it needs no documented
argument syntax: run it and read the cases. It is also why action counts
mislead, since a 56-action shortcut can be fifteen two-action operations. What
cannot be claimed from the corpus is that this is the library's general
interface, because most verbs take an input and return a value with no menu at
all.

## 6. Rich menus smuggle data through contacts

41 shortcuts build `BEGIN:VCARD`. `Get-DictChoiceThroughVCard` is the general
form and it solves a real limitation: `Choose from List` returns the row you
picked and nothing attached to it.

The trick is to base64 the payload into a vCard field, coerce the text to
contacts, let the user choose, then read the chosen row's field and decode:

```
for each options
  run Get-vCardFromDictItem      build one card
  base64                          the payload
  set key <base64 of the tag>     index it by its own tag
end for each
join New Lines
name it MainMenu.vcf
choose from
text «chosen» as Contact.Name    the tag comes back
value for «base64 of tag»        and indexes the payload
```

So a menu row carries an icon, a caption, and an arbitrary object. `Show-Menu`
is the small modern version reading `Notes` instead. Same idea, one field.

## 7. Persistent state is a base64 shelf

`Get-ShelfBase64` is three actions: read a config file, coerce to text, decode.
`Set-ShelfBase64` writes the other way, keyed by name. Together they are a
key-value store with no database and no third-party app, at the cost of base64
inflation.

The same file-plus-dictionary pattern appears in `Inject-🎟️GitHubToken`, which
reads `Shortcuts/Managed/config.json` and looks up a key whose name is the
placeholder it is replacing. Credentials and state use one mechanism.

## 8. Fenced text is a first-class input format

`Text-Fenced` extracts every ```` ``` ```` block from its input; `Show-Fenced`
takes the first, and if it looks like a URL opens it, otherwise renders it as a
`data:` URL. `Show-Html` strips fences as part of its text repair.

The library assumes its input may be a model's reply and handles that shape
natively. That assumption is now correct much more often than when it was made.

## 9. Long code is assembled from Text actions

`Show-Ace` builds a 27,000-character web application out of eight `gettext`
actions appended into a list, one per JavaScript class, then hands the assembled
whole to `Show-Template`. It is a module system: each component is separately
editable in the Shortcuts editor, and concatenation is the linker.

Worth knowing rather than copying. It is the best available answer inside the
app and the reason this repository exists is that a file in git is a better one.
Where a page can live in `pages/`, put it there.

## What imported shortcuts do better

Two patterns from third-party work in the library, neither used by the author's
own shortcuts, and both worth taking.

**A shortcut can know its own name.** `vCard Menu Creator` opens by building a
`Settings` dictionary holding, among other things, its own name, then re-enters
itself with `run $Settings[Name]`, 144 times across the corpus. Every "Back" in its menus is
that call. The author's shortcuts hardcode their own name instead, which is
exactly the failure this repository found twelve live instances of: a rename
leaves the caller pointing at nothing. **Storing the name in config makes a
shortcut rename-safe.**

**Debug logging behind a flag.** `Multi-stop navigation` sets `PrintDebug` at
the top and guards each trace with it, 52 times, appending
timestamped lines to a file. The library has no equivalent, and diagnosis
happens by opening `Show-Loop` and stepping.

## What the corpus says is wrong

- **A rename is not propagated.** Twelve calls in the working core point at
  names that no longer exist. The cost is a menu branch that fails when tapped,
  and the survey's `--dangling` lists them with a probable successor.
- **`Combine-JsonList` reads `if count < 1` then joins a list**, which cannot be
  right for a single item and looks like an inverted comparison. `Use-Shortcut`
  carries the same `< 1` shape around a "combining json for N files" notice.
  Worth a look before either is reused.
- **Duplicate-on-edit is never cleaned up.** 69 names are numbered copies or
  `Old`/`Test` suffixes, and in 8 cases the numbered copy is the live one
  because the original was deleted. See the survey's Sediment tier.
- **`Show-Html` carries a dead branch**, two `text.replace` actions reading the
  same source where one feeds nothing. Detail in
  [`shortcuts-format-notes.md`](shortcuts-format-notes.md).

## The recommendation, after checking

The grammar holds. Four of its claims did not, and all four failed the same
way: a raw frequency over 577 shortcuts was read as evidence about one author's
design, when 237 of those shortcuts are someone else's. The menu claim inverted
under that check, and it was the confident one.

So the rule this document now follows, and the reason to trust the rest of it:
**a claim about the design cites shortcuts in the core, and a claim about the
corpus says so.** Where an idiom is used mostly outside the working set, as
`Choose-Sample` is, that is stated rather than smoothed over.

Two things follow for the tiers as well, and both are in
[`tools/survey.py`](../tools/survey.py) now. The five tiers are a cascade over
three independent facts, not a taxonomy, so each row carries `provenance`,
`lifecycle`, and `connectivity` and the tier is a recommended action over them.
And the core is a floor: it is the closure of the named hubs, so it grows with
every entry point the graph cannot see, running about 42 with none, 48 with
five, 57 with ten. Quote 42 as "at least this much is live," never as the size
of the working library.

## What a core library has to keep

Assembled from the above, in the order that matters:

1. The self-demo prologue, with `Choose-Sample` as the injector. Without it
   nothing is testable on device.
2. `Get-FromJs`, and the rule that anything over five actions becomes
   JavaScript.
3. `Get-FileInfo`, or something that answers the type question, since every
   dispatch depends on it.
4. `Run-List`, because the naming convention stops being executable without it.
5. One menu convention, cases of one to three actions.
6. One state mechanism. The shelf works; so would anything with a config file.
7. Rename-safety from config, which the library does not currently have and
   should.

Everything else in the 42 is a leaf that can be rebuilt or dropped without
touching the shape.
