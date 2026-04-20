---
phase: 08-annotation-sync
plan: 02
subsystem: testing
tags: [yjs, undo-manager, crdt, collab, annotations]

# Dependency graph
requires:
  - phase: 08-annotation-sync
    provides: YjsAnnotation type and CollabSession with ymap (Plan 01)
provides:
  - Unified UndoManager tracking both Y.Text and Y.Map (D-83)
  - Backward-compatible createYjsUndoExtension with optional ymap parameter
  - Test coverage for annotation undo/redo operations
affects: [08-annotation-sync, collab, undo]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Y.UndoManager accepts array of tracked types for unified undo across multiple shared types"
    - "stopCapturing() used in tests to force separate undo boundaries without timer delays"

key-files:
  created: []
  modified:
    - src/lib/collab/yjsUndo.ts
    - src/lib/collab/yjsUndo.test.ts

key-decisions:
  - "Optional ymap parameter uses Y.Map<unknown> to avoid TypeScript invariant generic variance issues"
  - "Use stopCapturing() in tests instead of setTimeout delays for deterministic undo boundary control"

patterns-established:
  - "Pattern: Pass array [ytext, ymap] to Y.UndoManager for unified undo stack (D-83)"

requirements-completed: [SYNC-05]

# Metrics
duration: 3min
completed: 2026-04-18
---

# Phase 08 Plan 02: Annotation Sync - Unified Undo Summary

**createYjsUndoExtension extended to accept optional Y.Map for unified per-user undo of text and annotations (D-83)**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-18T14:46:07Z
- **Completed:** 2026-04-18T14:48:20Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended `createYjsUndoExtension` to accept optional `ymap?: Y.Map<unknown>` parameter
- UndoManager now tracks `[ytext, ymap]` when ymap provided, or `[ytext]` alone for backward compatibility
- Added 7 new tests covering annotation add/remove undo, unified text+annotation undo, remote change exclusion, redo, and interleaved operations
- All 25 tests pass (20 existing + 5 new in new describe block)

## Task Commits

Each task was committed atomically following TDD RED/GREEN cycle:

1. **Task 1 (RED): Add failing tests for ymap parameter** - `d0d55f7` (test)
2. **Task 2 (GREEN): Implement ymap support in createYjsUndoExtension** - `165c669` (feat)

_Note: Tasks 1 and 2 form a single TDD cycle for the same feature. RED commit captured the failing test state; GREEN commit made them pass._

## Files Created/Modified

- `src/lib/collab/yjsUndo.ts` - Updated function signature to accept `ymap?: Y.Map<unknown>`, constructs `trackedTypes` array conditionally, updated JSDoc with D-83 reference
- `src/lib/collab/yjsUndo.test.ts` - Added new `describe("createYjsUndoExtension with ymap (D-83 unified stack)")` block with 7 tests

## Decisions Made

- **Y.Map<unknown> for parameter type**: Using `Y.Map<unknown>` rather than a more specific generic avoids TypeScript's invariant generic variance issue where `Y.Map<{id: string; value: string}>` is not assignable to `Y.Map<T>` for any concrete `T`. Callers cast as needed.
- **stopCapturing() for test isolation**: The interleaved operations test uses `undoManager.stopCapturing()` between transactions rather than `setTimeout` delays. This gives deterministic undo boundary control in synchronous tests without waiting for the 500ms captureTimeout.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test using rapid transactions without undo boundary separation**
- **Found during:** Task 2 (GREEN phase - making tests pass)
- **Issue:** The plan's provided test code for "handles interleaved text and annotation operations" made 3 rapid transactions without any delay or `stopCapturing()` calls. With captureTimeout=500ms, all 3 transactions merged into a single undo step, causing the test to fail (first undo undid everything at once instead of just "world")
- **Fix:** Added `undoManager.stopCapturing()` calls after each of the first two transactions to force separate undo boundaries
- **Files modified:** `src/lib/collab/yjsUndo.test.ts`
- **Verification:** All 25 tests pass

**2. [Rule 1 - Bug] Fixed TypeScript type error: Y.Map<{...}> not assignable to Y.Map<unknown>**
- **Found during:** Task 2 (bun run check)
- **Issue:** Test declared `ymap: Y.Map<{ id: string; value: string }>` but `createYjsUndoExtension` expects `Y.Map<unknown>`. TypeScript's invariant generics make these incompatible.
- **Fix:** Changed test's ymap declaration to `Y.Map<unknown>` (the concrete type is not needed for test assertions)
- **Files modified:** `src/lib/collab/yjsUndo.test.ts`
- **Verification:** `bun run check` shows no errors in yjsUndo files

---

**Total deviations:** 2 auto-fixed (both Rule 1 - bugs in plan-provided test code)
**Impact on plan:** Both fixes necessary for tests to pass correctly. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `createYjsUndoExtension` is ready to accept the ymap from `CollabSession` (Plan 01)
- Unified undo stack behavior verified by tests — D-83 decision fully implemented
- Remaining phase 08 plans can wire the ymap into the collab setup without changes to the undo extension

---
*Phase: 08-annotation-sync*
*Completed: 2026-04-18*
