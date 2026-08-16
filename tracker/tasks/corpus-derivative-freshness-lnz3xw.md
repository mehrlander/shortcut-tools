---
id: corpus-derivative-freshness-lnz3xw
title: Detect when the corpus derivatives lag the dumps
status: done
closed: 2026-08-16
session: claude/shortcuts-repo-integration-uhvl7u
opened: 2026-08-16
size: S
---
# Detect when the corpus derivatives lag the dumps

The regeneration pipeline (index-dump, survey, sketch, harvest) runs by hand
from this repo into web-tools-private after a new dump, in an order only
shortcuts/README.md there records. Nothing detects when a derivative falls
behind: a new dump with a stale library.json means the library page, the prune
queue, and the idioms doc all describe the previous device state, silently.

This repo already treats that failure as test-worthy for its own mirrors
(packed/, plists/ fail the suite when behind). Extend the idea across the repo
boundary: a --check mode or test that, when a web-tools-private checkout is
present, verifies index.json, library.json, and the sketches are current with
the newest dumps, and skips rather than fails when the checkout is absent
(the pattern web-tools' link survey uses for absent stores).

Done when a fresh dump with stale derivatives is loud in some committed check,
and a public-only checkout stays green.

## Progress log
- 2026-08-16: filed from the shortcuts-integration session, which found the
  hand-run pipeline documented only in the private README.
- 2026-08-16: done on `claude/shortcuts-repo-integration-uhvl7u`: tools/freshness.py
  gates index.json, library.json, and library.html byte-for-byte against a temp
  regeneration, with a node test wrapper that skips on a public-only clone.
  First run caught library.html stale; regenerated on the sibling
  web-tools-private branch. Sketches stay advisory (accepted gaps); harvest's
  core/ stays out until its README-recorded arguments move somewhere
  machine-readable.
