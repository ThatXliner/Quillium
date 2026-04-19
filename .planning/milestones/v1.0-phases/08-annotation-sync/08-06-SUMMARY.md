---
phase: 08-annotation-sync
plan: "06"
subsystem: testing
tags: [yjs, codemirror, annotations, convergence, vitest]

requires:
  - phase: 08-05
    provides: createAnnotationSyncPlugin wired into enableCollab with Y.Map

provides:
  - Two-client convergence test suite for annotation sync (10 tests, 318 lines)

affects: [manual-verification, collab-integration]

tech-stack:
  added: []
  patterns:
    - "Y.encodeStateAsUpdate for initial state sync between peers in tests"
    - "connect() helper with bidirectional Y.Doc relay for convergence testing"

key-files:
  created:
    - src/lib/collab/yjsAnnotations.convergence.test.ts
  modified: []

key-decisions:
  - "Perform initial Y.Doc state exchange (Y.encodeStateAsUpdate) in connect() to simulate relay join"
  - "Use clientId-qualified peer instances (client-a, client-b) to prevent ID collisions in ID map"

patterns-established:
  - "Convergence test pattern: makePeer(clientId, initialText) + connect(a, b) + afterEach cleanup"
  - "Initial state sync via Y.encodeStateAsUpdate mirrors real relay behavior on join"

requirements-completed: [SYNC-05]

duration: 2min
completed: 2026-04-18
---

# Phase 8 Plan 06: Annotation Convergence Tests Summary

**Two-client convergence test suite (10 tests) verifying annotation sync across basic sync, concurrent ops, thread sync, position tracking, and revision sync**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-18T08:05:53Z
- **Completed:** 2026-04-18T08:07:19Z
- **Tasks:** 1 of 2 (Task 2 is a human-verify checkpoint)
- **Files modified:** 1

## Accomplishments

- Created `yjsAnnotations.convergence.test.ts` with 318 lines and 10 passing tests
- Covers basic sync (annotation A->B, B->A, removal propagation)
- Covers concurrent ops (concurrent creation, text edit + annotation creation)
- Covers thread sync (message propagation, concurrent thread convergence)
- Covers position tracking (annotation survives text insertion before it, deletion outside range)
- Covers revision sync (version change syncs between clients)

## Task Commits

1. **Task 1: Create yjsAnnotations.convergence.test.ts** - `9a954d2` (test)

## Files Created/Modified

- `src/lib/collab/yjsAnnotations.convergence.test.ts` - Two-client convergence tests for annotation sync

## Decisions Made

- Used `Y.encodeStateAsUpdate` in `connect()` to perform initial state exchange, which mirrors what a real relay server does when a new client joins. Without this, peerB starts empty and cannot resolve positions from peerA's initial document.
- Used distinct `clientId` strings (`"client-a"`, `"client-b"`) to ensure the annotation ID map in `createAnnotationSyncPlugin` does not confuse IDs from different peers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added initial Y.Doc state sync in connect()**
- **Found during:** Task 1 (running tests in RED phase)
- **Issue:** The plan's `connect()` function only wires future update relaying. peerB starts with an empty Y.Doc, so it never receives peerA's "hello world" initial content. All tests failed because peerB had 0 annotations (position calculations invalid against empty doc).
- **Fix:** Added `Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc), "remote")` and vice versa after registering the update listeners, performing an initial full-state sync before returning.
- **Files modified:** src/lib/collab/yjsAnnotations.convergence.test.ts
- **Verification:** All 10 tests pass after fix.
- **Committed in:** 9a954d2

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required for test correctness. No scope creep.

## Issues Encountered

- Initial Y.Doc state not synced by the plan's `connect()` function — fixed automatically (see deviations above).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Task 1 complete. Awaiting human verification (Task 2 checkpoint):
- Start relay: `cd ../quillium-landing/relay && bun run dev`
- Open two Quillium instances and verify annotation sync end-to-end
- Check comment creation, revision creation, version switching, thread replies, and undo all sync between clients

---

## Self-Check: PASSED

- `src/lib/collab/yjsAnnotations.convergence.test.ts` — FOUND
- Commit `9a954d2` — FOUND (confirmed by `git rev-parse --short HEAD`)
- 10/10 tests pass

---
*Phase: 08-annotation-sync*
*Completed: 2026-04-18 (Task 1 only; Task 2 pending human verification)*
