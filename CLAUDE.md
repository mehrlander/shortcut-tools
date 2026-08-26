# CLAUDE.md

Working rules for this repository, on top of the portable conventions in
[`mehrlander/web-tools`](https://github.com/mehrlander/web-tools/blob/main/docs/CONVENTIONS.md).
Load those with `/web-tools`. What follows is specific to this repo, and the
first section governs every design decision made here.

## The device is the expensive resource

**The point of this repository is to keep work out of the Shortcuts app.** The
app has no multi-select paste, no search across shortcuts, no way to see what
calls what, and every operation is a sequence of taps on a phone. That is the
problem being solved. So a design that solves it by asking the user to do
several things in the app has not solved it, it has moved it.

Rank every delivery route by what it costs the person on the other end:

| Cost | Route |
| --- | --- |
| Free | Read the corpus. 577 shortcuts and 29,713 actions are on disk, parseable, and answer most questions about how a real library is built. |
| Free | Read the public record. The format notes cite what exists and, more usefully, where it stops. |
| One tap | A `shortcuts://run-shortcut` link to a receiver that already exists. |
| One tap, then a paste | A packed link that drops cards on the clipboard. |
| **Expensive** | Anything asking the user to configure a card, name a shortcut, enable Shortcut Input, type an input, or run something more than once. |

**Rules that follow, and they are not advisory:**

1. **Exhaust the free routes first, then say what the search covered.** Parse
   the dumps and search the public record before asking the device anything. A
   probe sent for something the corpus already holds is wasted work:
   `OpenWorkflowAction` was in eight shortcuts when it was probed anyway.
   **Search the ToolKit catalog too, and it is the one that answers.**
   `shortcuts-playground-plugin` ships Apple's own metadata as JSON: 2,731
   identifiers and 2,585 parameter tables against this repo's 774.
   `python3 tools/coverage.py --exists <name> --catalog <toolkit-vNN-tool-ids.json>`.
   It would have supplied every shape that was instead obtained by asking the
   user to configure cards. **Search for a catalog, not just for an answer.**
   None of the three is a census: `actions.json` is curated and misses 18% of
   what the corpus alone uses, the corpus is one library's habits, and the
   catalog is one OS version. So a silent search licenses "I did not find one",
   never "there is none".
2. **A device ask must name what it buys in steady state.** Not what it
   confirms, what it *changes*. "Three cards become one, in a shortcut that
   already works" buys nothing and is not worth a tap. Curiosity is not a
   budget line.
3. **Batch the asks.** One probe carrying four cards costs what one card costs.
   Two probes a day apart cost double.
4. **Bake the input in.** A probe that needs a value should carry a value, not
   ask for one to be typed. Anything the sender can decide, the sender decides.
5. **Never ask for a repeat.** "Run it with a few different inputs" is a script
   the sender should have written into the chain.
6. **Count the one-time setup, and say what it is.** Every receiver installed
   is a permanent cost paid once. It is worth it only when it removes recurring
   in-app work.

**Installing is an import, not a paste** (confirmed 2026-08-15). `Library-Import`
fetches a generated plist, gzips it, remote-signs it, and hands it to Shortcuts:
one tap plus Apple's own import sheet. That beats `Library-Install` on every
axis, and it is the only route that can deliver **file-level** settings, since
`WFWorkflowTypes` and `WFWorkflowInputContentItemClasses` live in the workflow
file and no paste reaches them. Generate a full plist for anything new.

Two costs it carries. The worker is third-party and plain `http://`, acceptable
only because nothing here holds a secret. And importing over a name that already
exists puts a choice on screen: **Apple's own sheet offers to save over the
existing shortcut**, and taking that offer is all a re-install needs (reported
2026-08-26). Nothing has to be deleted first.

**Take the offer, because keeping both is a correctness problem rather than an
untidiness one.** A second copy takes the index: the original keeps the clean
name and the newcomer becomes `Name 1`, so every
`shortcuts://run-shortcut?name=Name` link, and every `runworkflow` card naming
it, still resolves to the **old** copy. An import that looks like an upgrade has
then done the opposite.

**Wrong 2026-08-15 → the paragraph above:** this read "import never merges by
name" and called clearing the name first "mandatory, not stylistic." The
duplicate and its index consequence are real, but they follow from declining the
sheet's offer, not from importing at all. `Library-Replace` deletes by name
before importing and is worth having where no one is present to answer the
sheet; it is not a prerequisite, and a session should not route a normal
re-install through it. The cost of that error is not a wasted tap: the link
names a receiver the device may not have, so it fails at the point of use with
nothing installed.

**Replacing a generated receiver is free**, so spend no care on it. The
four-step prune exists for shortcuts whose only copy is the device; a receiver
whose plist is committed here is reproducible from `git`. Reserve staging for
authored work, where it is earned.

**The one-time cost so far, in full**, so nothing re-spends it by accident:

- `Library-Open`, `Library-Stage`, and `Log-Repo` pasted, named, Shortcut Input enabled.
- `Library-Stage`'s Move card: **one tap** to pick the holding folder (`Stage`).
  Reported here as unavoidable, which was wrong: `CreateFolderAction` exists and
  takes a plain text name, so create-then-move may remove it. Left as it is
  because the tap is already paid and rebuilding buys nothing in steady state
  (rule 2), and noted so a fresh install can do better.

Everything else the library view does is one tap from a web page, and it stays
that way.

## Deletion is never one step

The prune workflow is nominate, stage, wait, delete, and the page and its
receivers can only do the first two. This is the one place where friction is
the feature, and it does not contradict the section above: the cost being
avoided there is tedium, and the cost being kept here is an irreversible act on
work that took years to accumulate. Reasoning in
[README.md](README.md#deletion-is-the-fourth-step-never-the-first).

## Generated artifacts

Two mirrors of `workflows/`, refreshed by `python3 tools/pack.py --publish` and
`python3 tools/plist.py --publish`. The suite fails when either is behind, which
is deliberate: a stale artifact serves a link that works and delivers the wrong
thing.

| Mirror | Holds | For |
| --- | --- | --- |
| `packed/` | every chain, as a clipboard payload | pasting actions |
| `plists/` | the chains declaring `"name"`, as whole workflows | installing a shortcut |

A chain opts into `plists/` by declaring a name, because most of them are probes
and demos rather than receivers. Deriving the name from the label instead put 27
chains into 24 files, three overwriting each other in silence.

## A name is not a reference until something checks it

Resolving a Run Shortcut target by name rather than by `workflowIdentifier` is
what makes a chain portable, and the suite enforces it. It also trades a
device-local pointer for a string nothing validates, so a target renamed on the
phone leaves a card that looks correct and resolves to nothing.

That is not hypothetical. Stripping the identifiers out of `Back-DoubleTap`
exposed two names that had been stale for at least a fortnight, still working
only because the identifier beside them was carrying the call:
`Use-RecentShortcut`, since renamed to `Open-RecentShortcut`, and `Repo-Viewer`,
now pointed at `Show-Repo`.

**The corpus settled the second one without a tap, and the way it did is the
method.** The identifier was no help: `962A04D2-78A9-4AD8-91B9-A51E3F3F6CB1`
appears in the corpus only inside `Back-DoubleTap` itself, since a `.wflow` does
not carry its own identifier and only a *caller* records a target's. What
settled it was elimination. `Repo-Viewer` exists nowhere in 605 names or 15
dumps, and exactly one repo browser does exist, `Show-Repo`, whose two actions
build a `gh-fetch` page and hand it to `Show-Html`. The branch calling it fires
when the current app is GitHub, which is what that page is for. Retargeting is
not merely the best guess available, it is strictly better than any alternative:
the old name resolves to nothing, so the branch was dead either way.

The general shape, since this will recur: a stale by-name target is resolved by
asking what the library *has* that does the job, not by recovering what the name
used to mean. The device cannot answer the second question either, since a
rename leaves no record on it.

**So audit the names against the library index whenever a chain gains one, and
always after stripping identifiers.** `web-tools-private`'s
`shortcuts/index.json` is one row per shortcut in the last full dump:

```bash
python3 - <<'EOF'
import json
idx = {r["name"] for r in json.load(open("index.json"))}
for a in json.load(open("<chain>.json"))["actions"]:
    n = a["p"].get("WFWorkflowName")
    if isinstance(n, str) and n not in idx: print("missing:", n)
EOF
```

Two false positives to expect, both from the index being a snapshot: anything
installed since the last dump, and any name computed at run time, which is a
token rather than a string and cannot be checked this way at all.

## A diagnostic returns itself

**Never end a probe by asking what happened.** That makes the user read a
screen, decide what matters, and describe it, which is three jobs handed over
with the answer already on the device.

End it with `run Log-Repo` instead. That card puts the payload on the clipboard
and commits it to `shortcuts/log/` in web-tools-private, so the whole
interaction is: tap the link, and the result is either already in the repo or
one paste away. The clipboard write runs **first and unconditionally**, so a
failed commit degrades to the cheap path rather than losing the result.

This is why the repo carries a logger at all. It is not telemetry, it is the
return channel that makes a probe cost one tap.

**And a question is worth a tap only when the repo cannot answer it.** The rule
above stops a probe ending in "what did you see?"; this one stops the question
that survives it. Before asking anything, answer it here: read
`shortcuts/log/`, the corpus dumps, the plists, the ToolKit catalog. Whatever is
left is the question, and it is always the same kind of thing: what the screen
did, what the dialog rendered, what Apple's own UI decided. Those exist nowhere
but the device. Anything derivable from a file in this estate is a `git pull`
dressed up as a favor, and it costs a tap, a context switch, and the reader's
willingness to answer the next one.

Measured 2026-08-23, validating `Probe-Step`. The second of two taps asked
whether the first tap's commit had landed. It had, in `shortcuts/log/`, two
commits away from the session that asked. The reply was "Come on, this is not
what you should be asking me. You can see these things yourself," which is the
correct answer and the reason this paragraph exists. The tap was not wasted
because the walker failed, it worked; it was wasted because the question was
already answered before it was sent. This is judgment and stays prose: no check
can read a question and tell whether the repo holds its answer.

## A probe carries its own instructions

**The reader arrives knowing nothing, and should not have to.** Running a link
is cheap and the user has said so. What costs is having to remember what the
tap was for, watch for the right thing without being told what it is, and work
out afterwards which part mattered. That is the expensive kind of ask, and it
is the one that hides inside a link that looks like one tap.

So a probe that needs an observation says all three parts on the device, in
order:

1. **Brief, before anything happens.** What is about to run and what to watch
   for. `Probe-Watch` puts it in an alert titled "Watch what happens next", so
   it blocks until it is read.
2. **The thing itself.**
3. **The question, immediately after**, naming the specific outcome rather than
   asking what happened. "Did the dictation page open?" not "what did you see?"

[`workflows/probe-watch.json`](workflows/probe-watch.json) is the receiver, and
the payload is three lines: brief, target, question. It logs `Ran:`, `Q:` and
`A:` through `Log-Repo`, so the answer arrives here without a paste.

**This is why `Probe-Step` was not enough.** It asks before it fires, so its
question is about the *previous* tap: on 2026-08-23 that meant asking about a
commit from twenty minutes earlier, and the honest reply was that the repo
already held the answer. Announce, fire, then ask, all in one tap, is what
removes the remembering.

The rule above still governs what the question may be: ask only what the repo
cannot answer, which is what the screen did, what the dialog rendered, what
Apple's own UI decided.

## Handing over a link

**Emit both forms, never type either**, which
[`workflows/README.md`](workflows/README.md) already says. Prefer `--url`, the
address form, over the embedded payload: it is about 200 characters, a wrong
character 404s instead of silently delivering less than it claims, and it
cannot be mangled in transit. A retyped embedded payload has already cost one
round trip here.

Use 📋 when the payoff is content on the clipboard, which every packed link is.
📲 is for a link whose payoff is anything else.
