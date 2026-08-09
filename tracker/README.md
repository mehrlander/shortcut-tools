# Tracker

Backlog and cross-session work protocol for this repo.

The convention is portable and lives upstream: [`docs/TRACKER.md`](https://github.com/mehrlander/web-tools/blob/main/docs/TRACKER.md)
in `mehrlander/web-tools` carries the schema, the id scheme, and the board's
shape; the `tasks` skill carries every operating rule, including when a task
should exist at all. Nothing about either is restated here.

- **Tasks:** one file per task in [`tasks/`](tasks/), the source of truth.
- **Board:** [`board.md`](board.md), generated. Do not hand-edit it.
- **Regenerate:** through `/tasks`, which resolves the bundled board generator.

Local specifics: none yet. This tracker was stood up on 2026-08-09, seeded from
the Apple Shortcuts storyline in the `chat-histories` archive, which held two
years of work on this format that the repo itself did not record.
