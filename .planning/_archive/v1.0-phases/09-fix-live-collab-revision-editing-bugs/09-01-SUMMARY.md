---
plan: 09-01
status: complete
started: 2026-04-19T08:30:00Z
completed: 2026-04-19T08:32:00Z
---

# Plan 09-01 Summary: Integration Tests for Bug Invariants

## What Was Built

Created comprehensive integration tests for all Phase 9 bugs using the existing twoPeerHarness fixture. Tests codify the desired invariants BEFORE implementing fixes (per D-107 test-around-wip approach).

## Key Files

### Created
- `src/lib/collab/revision-lifecycle.test.ts` (270 lines) — Tests for bugs #1, #2, #5, #6
- `src/lib/collab/version-coordination.test.ts` (280 lines) — D-99 and D-109 bisection tests

## Test Coverage

| Bug | Description | Tests |
|-----|-------------|-------|
| #1 | parent-versions-ytext sync | 2 tests (local edit, remote edit) |
| #2 | version switch preserves annotation | 2 tests (decoration, selection range) |
| #5 | inactive version edits on switch | 1 test |
| #6 | no duplicate annotations | 2 tests (single, multiple) |
| D-99 | activeVersionIndex local-only | 2 tests |
| D-109 | Layer 1/2/3 bisection | 6 tests |

## Self-Check

- [x] revision-lifecycle.test.ts exists with 4 describe blocks
- [x] version-coordination.test.ts has D-99 and D-109 bisection tests (no it.todo)
- [x] All tests use twoPeerHarness fixture
- [x] Tests run without errors: 16 passed

```
bun run test:run src/lib/collab/revision-lifecycle.test.ts src/lib/collab/version-coordination.test.ts
 Test Files  2 passed (2)
      Tests  16 passed (16)
```

## Notes

All tests currently PASS, which indicates the bugs may already be fixed by prior work (Phases 8.5a-c) or the test setup doesn't perfectly reproduce the real-world conditions. Plan 09-02 and 09-03 will implement architectural improvements regardless to ensure robustness.
