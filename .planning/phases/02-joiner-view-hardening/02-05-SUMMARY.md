# Plan 02-05 Summary

Completed 2026-04-22.

- Added `src/lib/collab/joiner-view.test.ts` with seven end-to-end joiner hardening assertions.
- Covered no CM history on joiner, post-connect undo no-op, no duplicate initial annotations, own-edits-only undo, owner history excluding remote text, selection restore, and Y.UndoManager wiring.
- Re-enabled `yjsAnnotations.test.ts` write-path cases and `thread-append.test.ts` thread cases that were previously skipped.
- Verification: `bun run test:run` passes with 805 passing tests and 3 skipped tests.
