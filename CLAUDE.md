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

1. **Exhaust the free routes first.** Parse the dumps and search the public
   record before asking the device anything. A probe sent for something the
   corpus already holds is wasted work: `OpenWorkflowAction` was in eight
   shortcuts when it was probed anyway.
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

**The one-time cost so far, in full**, so nothing re-spends it by accident:

- `Library-Open`, `Library-Stage`, and `Log-Repo` pasted, named, Shortcut Input enabled.
- `Library-Stage`'s Move card: **one tap** to pick the holding folder. This is
  the only in-app step that could not be removed. A Shortcuts folder is an App
  Intents entity addressed by an opaque identifier, and no action anywhere in
  the 810-entry dictionary returns the folder list, so nothing can resolve one
  by name the way `getmyworkflows` plus a filter resolves a shortcut.

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

`packed/` mirrors `workflows/`, and `python3 tools/pack.py --publish` refreshes
it. The suite fails when it is behind, which is deliberate: a stale payload
serves a link that works and delivers the wrong thing.

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

## Handing over a link

**Emit both forms, never type either**, which
[`workflows/README.md`](workflows/README.md) already says. Prefer `--url`, the
address form, over the embedded payload: it is about 200 characters, a wrong
character 404s instead of silently delivering less than it claims, and it
cannot be mangled in transit. A retyped embedded payload has already cost one
round trip here.

Use 📋 when the payoff is content on the clipboard, which every packed link is.
📲 is for a link whose payoff is anything else.
