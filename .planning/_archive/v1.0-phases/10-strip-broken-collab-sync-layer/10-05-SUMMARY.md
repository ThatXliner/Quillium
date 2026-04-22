---
phase: 10-strip-broken-collab-sync-layer
plan: 05
subsystem: collab
tags: [testing, cleanup, phase-10]
dependency_graph:
  requires: [10-01, 10-02, 10-03, 10-04]
  provides: [clean-test-suite]
  affects: [src/lib/collab/]
tech_stack:
  added: []
  patterns: [test-skipping-for-disabled-features]
key_files:
  created: []
  modified:
    - src/lib/collab/yjsAnnotations.test.ts
    - src/lib/collab/thread-append.test.ts
  deleted:
    - src/lib/collab/yjsAnnotations.convergence.test.ts
decisions:
  - Use it.skip (not it.todo) for disabled write path tests
  - Delete convergence test file entirely (all tests depend on write path)
  - Fix TypeScript errors in test files for clean CI
metrics:
  duration: 5min
  completed: 2026-04-19
  tasks: 3
  files: 3
---

# Phase 10 Plan 05: Fix Remaining Tests Summary

Updated test suite for stripped annotation sync plugin; all collab tests pass with write path tests skipped.

## Commits

| Task | Hash | Description |
|------|------|-------------|
| 1 | e249bda | Skip write path tests in yjsAnnotations.test.ts |
| 2 | 0060f38 | Delete yjsAnnotations.convergence.test.ts |
| 3 | 3e1ae66 | Fix TypeScript errors and skip write path tests |

## What Was Done

### Task 1: Fix yjsAnnotations.test.ts for stripped plugin

- Added Phase 10 header comment explaining write path is disabled
- Skipped 13 tests that depend on the CM -> Yjs write path:
  - "propagates addAnnotation to Y.Map"
  - "propagates removeAnnotation to Y.Map"
  - "propagates updateThread to Y.Map via Y.Array.push"
  - "removes CM annotation from remote Y.Map delete"
  - "syncs comment annotations"
  - "syncs suggestion annotations"
  - "syncs revision annotations"
  - "syncs activeVersionIndex change to Y.Map via remove+add"
  - "syncs new version addition to Y.Map via remove+add"
  - "receives remote activeVersionIndex change via shallow Y.Map update"
  - "receives remote thread reply via Y.Array.push"
  - "syncs local thread update to Y.Map via Y.Array.push"
  - "syncs suggestion acceptance state (removal)"
- Kept 3 tests that still work:
  - "syncs existing Y.Map annotations on plugin mount" (read path)
  - "does not dispatch for local-origin Y.Map changes" (origin tracking)
  - "does not propagate Yjs-originated changes back to Y.Map" (feedback loop prevention)

### Task 2: Delete yjsAnnotations.convergence.test.ts

- Deleted the entire file (380 lines)
- All 11 tests in this file tested two-peer annotation convergence which requires the write path
- Phase 13 will create new convergence tests after the write path is rebuilt

### Task 3: Run typecheck and biome, fix any errors

- Fixed TypeScript error in yjsAnnotations.test.ts:
  - Line 170: Changed `new Promise((r) => queueMicrotask(r))` to `new Promise<void>((r) => queueMicrotask(r))`
  - Lines 358, 381: Removed explicit `GenericAnnotation` type annotation on spread objects
- Skipped 3 more tests in thread-append.test.ts that depend on write path:
  - "concurrent append from two peers surfaces both messages"
  - "single-peer append is mirrored remotely via observeDeep"
  - "shrink-path fallback replaces the full thread array"
- Note: Pre-existing TypeScript and biome errors exist in other files (not caused by this plan's changes, out of scope per deviation rules)

## Test Results

Final test run:
- 17 test files passed
- 156 tests passed
- 16 tests skipped (write path tests)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed additional write path test file**
- **Found during:** Task 3 verification
- **Issue:** thread-append.test.ts also contains tests that depend on write path
- **Fix:** Added Phase 10 header comment and skipped 3 tests with it.skip
- **Files modified:** src/lib/collab/thread-append.test.ts
- **Commit:** 3e1ae66

## Verification

```
bun run test:run src/lib/collab/
Test Files  17 passed (17)
Tests  156 passed | 16 skipped (172)
```

## Self-Check: PASSED

- [x] src/lib/collab/yjsAnnotations.test.ts exists and was modified
- [x] src/lib/collab/thread-append.test.ts exists and was modified
- [x] src/lib/collab/yjsAnnotations.convergence.test.ts deleted
- [x] Commit e249bda exists
- [x] Commit 0060f38 exists
- [x] Commit 3e1ae66 exists
