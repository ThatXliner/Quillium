# src/lib/collab/fuzz

**Purpose:** Long-running convergence fuzz tests (Phase 9, HARNESS-03 / -04).

This directory is intentionally empty in Phase 1. The 10k-op convergence fuzz
and cross-peer `Y.UndoManager` validation land in Phase 9. Until then:

- **Do not** add tests here that should run in CI on every PR. Those go in
  `src/lib/collab/*.test.ts` (sibling of this directory).
- **Do** add tests here when they are exploratory, slow, or property-based at
  a scale that would blow the per-PR test budget (e.g., `numRuns > 1000`).

**CI exclusion mechanism:** Tests in this directory MUST opt out of CI explicitly,
either by:
- Naming the file `*.fuzz.test.ts` (not `*.test.ts`) so the default Vitest glob
  in `vitest.config.ts` does not pick them up, OR
- Wrapping the suite in `describe.skip(...)` with a TODO referencing Phase 9.

The Phase 1 property test (`src/lib/collab/convergence-projection.test.ts`) is
NOT a fuzz test — it runs in CI with a small `numRuns` budget. The fuzz here is
the long-running cousin scheduled for Phase 9.

**Related requirements:** HARNESS-03 (10k-op fuzz), HARNESS-04 (cross-peer undo),
HARNESS-05 (two-device dogfood checklist).
