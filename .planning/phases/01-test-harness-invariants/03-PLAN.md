---
phase: 1
plan: 3
title: Feedback-loop test (≤ N Yjs updates for N keystrokes) + fuzz dir scaffold
wave: 2
depends_on: [1]
requirements: [SYNC-06]
files_modified:
  - src/lib/collab/feedback-loop.test.ts
  - src/lib/collab/fuzz/.gitkeep
  - src/lib/collab/fuzz/README.md
autonomous: true
---

<objective>
Add the SYNC-06 feedback-loop regression harness: type N single-character dispatches into peer A's view, `flushAll`, then assert that peer A's `ydoc` emitted ≤ N update events. Also create the empty `src/lib/collab/fuzz/` directory with a README that explains it is the home of Phase 9's 10k-op convergence fuzz and is intentionally `.skip`'d in CI until then.

Per D-08: this test is a regression harness for the Phase 3 rewrite (`commands.ts`). It is expected to PASS against current code (the four-guard origin discipline is already in place); the value is that when Phase 3 forgets a guard, this test fails loudly at CI time instead of silently in prod as O(N²) relay traffic.
</objective>

<must_haves>
- A test file `src/lib/collab/feedback-loop.test.ts` that types N single-char dispatches into one peer and asserts `updateCount <= N` after `flushAll`. The failure message must contain the literal string `amplification` so a future dev hitting the regression knows the failure mode by name.
- A fuzz scaffold directory `src/lib/collab/fuzz/` with a `README.md` declaring its purpose, expected residents (Phase 9 fuzz), and the CI-skip convention.
</must_haves>

<tasks>

<task id="1.3.1">
<title>Write feedback-loop.test.ts</title>
<read_first>
- src/lib/collab/test-helpers/twoPeerHarness.ts (Peer interface, makePeerWithAnnotationSync, connect, teardown, flushAll from Plan 01)
- src/lib/collab/main-text-sync.test.ts (reference for typing into a peer view via dispatch)
</read_first>
<action>
Create `src/lib/collab/feedback-loop.test.ts`:

```ts
/**
 * feedback-loop.test.ts -- SYNC-06 (Phase 1 SC-3).
 *
 * Asserts that N single-character keystrokes from one peer produce AT MOST N
 * Yjs update events on that peer's ydoc. Catches the amplification failure
 * mode where one local op produces an unbounded chain of remote-applied
 * updates (the classic dual-source-of-truth feedback loop).
 *
 * Single-char dispatches matter (not bursts) -- bursts hide amplification
 * behind CodeMirror's transaction coalescing; single chars are the sensitive
 * case (D-07).
 *
 * Per D-08: this test is a REGRESSION HARNESS for the Phase 3 rewrite. It is
 * expected to pass against current code. When Phase 3 forgets a guard, this
 * test fails loudly at CI time rather than silently in prod as O(N^2) relay
 * traffic.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    type Peer,
    connect,
    flushAll,
    makePeerWithAnnotationSync,
    teardown,
} from "./test-helpers/twoPeerHarness";

describe("SYNC-06: feedback-loop / amplification regression", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: (() => void) | undefined;

    beforeEach(() => {
        peerA = makePeerWithAnnotationSync("A", "");
        peerB = makePeerWithAnnotationSync("B", "");
        disconnect = connect(peerA, peerB);
    });

    afterEach(() => {
        disconnect?.();
        teardown(peerA);
        teardown(peerB);
    });

    test("N single-char keystrokes from peer A produce <= N Yjs updates on A", async () => {
        const N = 20;

        // Drain the connect-time initial sync so it is not counted.
        await flushAll(peerA, peerB);

        let updateCount = 0;
        const onUpdate = () => {
            updateCount++;
        };
        peerA.ydoc.on("update", onUpdate);

        try {
            for (let i = 0; i < N; i++) {
                const pos = peerA.view.state.doc.length;
                peerA.view.dispatch({ changes: { from: pos, insert: String.fromCharCode(97 + (i % 26)) } });
                // Yield once per keystroke to let any synchronous observer chain run.
                await Promise.resolve();
            }
            await flushAll(peerA, peerB);
        } finally {
            peerA.ydoc.off("update", onUpdate);
        }

        expect(
            updateCount,
            `amplification regression: ${N} single-char keystrokes produced ${updateCount} Yjs updates on peer A ` +
                `(expected <= ${N}). One local op is producing more than one Yjs update -- check the four-guard ` +
                `origin discipline in src/lib/collab/yjsAnnotations.ts and src/lib/collab/yjsBinding.ts.`,
        ).toBeLessThanOrEqual(N);
    });
});
```
</action>
<acceptance_criteria>
- File `src/lib/collab/feedback-loop.test.ts` exists.
- `grep -n "amplification regression" src/lib/collab/feedback-loop.test.ts` returns one match (failure message contains the word).
- `grep -n "flushAll" src/lib/collab/feedback-loop.test.ts` returns at least two matches (import + call).
- `grep -n "ydoc.on(\"update\"" src/lib/collab/feedback-loop.test.ts` returns one match.
- `grep -n "toBeLessThanOrEqual(N)" src/lib/collab/feedback-loop.test.ts` returns one match.
- `bun run check` exits 0.
- `bun run test:run src/lib/collab/feedback-loop.test.ts` exits 0 (per D-08 the current code is expected to pass this).
</acceptance_criteria>
</task>

<task id="1.3.2">
<title>Scaffold src/lib/collab/fuzz/ for Phase 9 fuzz residency</title>
<read_first>
- .planning/phases/01-test-harness-invariants/01-CONTEXT.md (D-12 for the fuzz directory convention)
- .planning/REQUIREMENTS.md §HARNESS (HARNESS-03 is the Phase 9 10k-op fuzz)
</read_first>
<action>
Create the directory `src/lib/collab/fuzz/` and add two files:

1. `src/lib/collab/fuzz/.gitkeep` — empty file so git tracks the directory.

2. `src/lib/collab/fuzz/README.md`:

```markdown
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
```
</action>
<acceptance_criteria>
- `test -d src/lib/collab/fuzz` succeeds.
- `test -f src/lib/collab/fuzz/.gitkeep` succeeds.
- `test -f src/lib/collab/fuzz/README.md` succeeds.
- `grep -n "HARNESS-03" src/lib/collab/fuzz/README.md` returns one match.
- `grep -n "Phase 9" src/lib/collab/fuzz/README.md` returns at least one match.
- `grep -n "\\*.fuzz.test.ts" src/lib/collab/fuzz/README.md` returns one match (CI exclusion convention is documented).
- No `*.ts` test files exist in the directory (Phase 1 only scaffolds): `ls src/lib/collab/fuzz/*.ts 2>/dev/null | wc -l` returns 0.
</acceptance_criteria>
</task>

</tasks>

<verification>
- `bun run check` exits 0.
- `bun run lint` exits 0.
- `bun run test:run src/lib/collab/feedback-loop.test.ts` exits 0 (passes against current code per D-08).
- All Phase 1 tests run together green: `bun run test:run src/lib/collab/feedback-loop.test.ts src/lib/collab/convergence-projection.test.ts` exits 0.
- The fuzz directory exists with README + .gitkeep and contains zero `*.ts` files.
</verification>
</content>
</invoke>