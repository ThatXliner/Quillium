# Plan 02-04 Summary

Completed 2026-04-22.

- Marked remote Y.Text dispatches with `Transaction.addToHistory.of(false)`.
- Added `_initialSyncDone` to guard owner initial annotation seeding.
- Deferred `observeDeep` attachment until after initial pull and added a catch-up pull after attachment.
- Fixed thread shrink sync by replacing the Y.Array contents when CM thread length decreases.
- Verification: `bun run test:run src/lib/collab/` passes.
