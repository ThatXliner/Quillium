---
phase: 10-strip-broken-collab-sync-layer
plan: 06
subsystem: collab
tags: [test, integration, yjs, sync]
dependency-graph:
  requires: [twoPeerHarness.ts]
  provides: [main-text-sync.test.ts]
  affects: []
tech-stack:
  added: []
  patterns: [two-peer harness, Yjs text binding]
key-files:
  created:
    - src/lib/collab/main-text-sync.test.ts
  modified: []
decisions: []
metrics:
  duration: 1min
  completed: 2026-04-19T17:06:02Z
---

# Phase 10 Plan 06: Main Text Sync Integration Test Summary

Integration test proving main text sync works between two peers after stripping the annotation sync layer.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create main-text-sync.test.ts | f761ca6 | src/lib/collab/main-text-sync.test.ts |

## Implementation Details

### Test Coverage

Created `src/lib/collab/main-text-sync.test.ts` with 7 test cases:

1. **peer B receives peer A initial content on connect** - Verifies initial state sync when peers connect
2. **character-wise insert on peer A appears on peer B** - Single character insert at start
3. **character-wise insert on peer B appears on peer A** - Single character insert at end
4. **concurrent edits from both peers merge correctly** - Both peers edit, documents converge
5. **deletion on peer A reflects on peer B** - Delete operation syncs
6. **replace on peer A reflects on peer B** - Replace operation syncs
7. **multi-character typing sequence syncs correctly** - Character-by-character typing simulation

### Harness Usage

Uses the stripped `twoPeerHarness.ts` from Plan 04, which:
- Creates peers with `makePeer(clientId, initialText)`
- Connects via `connect(a, b)` returning disconnect function
- Cleans up via `teardown(peer)`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed concurrent edit test assertion**
- **Found during:** Task 1 initial test run
- **Issue:** Original test assumed peer B's insert at position 7 would append to "initial", but peer A's prior insert shifted positions
- **Fix:** Updated test to query `peerB.view.state.doc.length` dynamically and expect "AinitialB"
- **Files modified:** src/lib/collab/main-text-sync.test.ts
- **Commit:** f761ca6

## Verification Results

```
$ bun run test:run src/lib/collab/main-text-sync.test.ts

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

## Success Criteria

- [x] `main-text-sync.test.ts` exists
- [x] All 7 tests pass
- [x] Test proves: two peers connected, main text edits on peer A appear on peer B
- [x] Test proves: concurrent edits merge correctly

## Self-Check: PASSED

- [x] FOUND: src/lib/collab/main-text-sync.test.ts
- [x] FOUND: commit f761ca6
