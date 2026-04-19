---
plan: 09-02
status: complete
started: 2026-04-19T08:32:00Z
completed: 2026-04-19T08:35:00Z
---

# Plan 09-02 Summary: D-100 Room-as-View Architecture

## What Was Built

Implemented the D-100 Room-as-View architecture and D-103 restore-to-prior-view pattern. Joiner's collab session is now a separate ephemeral view backed entirely by the room's Y.Doc — no local document I/O occurs. This architectural change dissolves bugs #3 (cmd-z pre-connect) and #6 (duplicate annotations) at the design level.

## Key Files

### Modified
- `src/lib/collab/store.ts` — Added `JoinerPriorView` interface and `joinerPriorView` store
- `src/lib/collab/index.ts` — Added `restoreJoinerPriorView()` function, wired into `disableCollab`
- `src/lib/collab/GoLiveButton.svelte` — Captures prior view BEFORE joining, sets `currentDraftId` to null
- `src/lib/editor/listeners.ts` — Updated persistence guard comment with D-100 reference

## Architecture Changes

### D-100: Room-as-View
- Joiner's `currentDraftId` is set to `null` during collab session
- Persistence listeners skip writes when `isCollabJoiner` is true
- All document content comes from relay's Y.Doc, not local SQLite

### D-103: Restore to Prior View
- `joinerPriorView` store captures `{ draftId, viewType }` before joining
- `restoreJoinerPriorView()` navigates joiner back after disconnect/kick
- Called automatically by `disableCollab()` when `wasJoiner` is true

## Self-Check

- [x] joinerPriorView store exists in store.ts
- [x] restoreJoinerPriorView function exported from index.ts
- [x] disableCollab calls restoreJoinerPriorView when wasJoiner is true
- [x] GoLiveButton captures prior view BEFORE setting isCollabJoiner
- [x] GoLiveButton sets currentDraftId to null per D-100
- [x] Persistence guard checks isCollabJoiner at function start
- [x] All collab tests pass (193 passed)

## Notes

The error handling in `joinById` now properly restores `currentDraftId` on failure, preventing the joiner from being stranded with a null draft ID if the connection fails.
