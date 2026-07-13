# src/lib/collab/fuzz

**Purpose:** Opt-in, long-running convergence fuzz tests that are too expensive for every PR.

`convergence.fuzz.test.ts` implements HARNESS-03 by applying 10,000 deterministic,
seeded text and annotation operations across two connected peers. It checks text,
Yjs state, and CodeMirror annotation projections every 100 operations and at the end.
The peers settle after each operation to match the event-loop cadence of real user input.

Run it from the repository root:

```bash
bun run desktop:test:collab-fuzz
```

Replay a failure or change the stress budget:

```bash
COLLAB_FUZZ_SEED=12345 COLLAB_FUZZ_OPERATIONS=20000 bun run desktop:test:collab-fuzz
```

Cross-peer `Y.UndoManager` fuzz validation remains separate HARNESS-04 work. Until then:

- **Do not** add tests here that should run in CI on every PR. Those go in
  `src/lib/collab/*.test.ts` (sibling of this directory).
- **Do** add tests here when they are exploratory, slow, or property-based at
  a scale that would blow the per-PR test budget (e.g., `numRuns > 1000`).

**CI exclusion mechanism:** Tests in this directory MUST use an explicit environment
gate such as `describe.skipIf(process.env.COLLAB_FUZZ !== "1")`. The `*.fuzz.test.ts`
suffix identifies long-running suites but does not, by itself, exclude them from Vitest.

The bounded property test (`tests/lib/collab/convergence-projection.test.ts`) is
not a long-running fuzz test. It stays in CI with a small `numRuns` budget, while
the suites here run on demand.

**Related requirements:** HARNESS-03 (10k-op fuzz, implemented), HARNESS-04 (cross-peer undo),
HARNESS-05 (two-device dogfood checklist).
