---
phase: 1
plan: 1
title: flushAll helper + canonical-source invariant comments
wave: 1
depends_on: []
requirements: [HARNESS-01, SYNC-06]
files_modified:
  - src/lib/collab/test-helpers/twoPeerHarness.ts
  - src/lib/collab/yjsAnnotations.ts
autonomous: true
---

<objective>
Land the deterministic `flushAll(...peers)` flush primitive in the existing two-peer harness and document the canonical-source / four-guard origin discipline as top-of-file invariant comments in `yjsAnnotations.ts`. No sync behavior changes; this plan only adds the test substrate and documentation that Plans 02 and 03 (and Phases 2–9) depend on.

Covers HARNESS-01 (the helper itself) and SC-4 of Phase 1 (invariant comments). SYNC-06 listed because the helper is a prerequisite for the feedback-loop test in Plan 03.
</objective>

<must_haves>
- `flushAll(...peers: Peer[])` exported from `src/lib/collab/test-helpers/twoPeerHarness.ts`, variadic (accepts N peers), state-vector-equality based, with a max-iteration cap of 20 that throws a loud, named error on exceedance.
- The four-guard origin discipline and Yjs-canonical / annotationField-derived contract are documented in a top-of-file comment block in `src/lib/collab/yjsAnnotations.ts`, with `file:line` references to each of the four guard sites.
</must_haves>

<tasks>

<task id="1.1.1">
<title>Add flushAll helper to twoPeerHarness.ts</title>
<read_first>
- src/lib/collab/test-helpers/twoPeerHarness.ts (current Peer interface, makePeer, connect)
- src/lib/collab/yjsBinding.convergence.test.ts (current convergence-detection style for reference)
</read_first>
<action>
Append a new exported function to `src/lib/collab/test-helpers/twoPeerHarness.ts` (do NOT rewrite existing code):

```ts
import * as Y from "yjs";
// ... existing imports unchanged

/**
 * flushAll -- Variadic state-vector-equality flush primitive for N-peer convergence tests.
 *
 * Drains queued microtasks, then checks pairwise Y.encodeStateVector equality
 * across every peer. Repeats until stable or until MAX_ITERATIONS is exceeded
 * (in which case it throws a loud error -- this signals real amplification or
 * a feedback loop, not a transient miss).
 *
 * This is the ONLY flush primitive used by two-peer convergence tests in Phases
 * 1-9. Do not introduce alternative flush helpers (fixed-N microtask ticks,
 * explicit update-queue drains, single awaits) -- they hide amplification bugs
 * behind their own counters or tick budgets.
 *
 * Decisions: D-01 (variadic), D-02 (state-vector loop with cap), D-03 (rejected alts).
 */
export const FLUSH_ALL_MAX_ITERATIONS = 20;

export async function flushAll(...peers: Peer[]): Promise<void> {
    if (peers.length < 2) {
        throw new Error("flushAll: requires at least 2 peers");
    }
    for (let iter = 0; iter < FLUSH_ALL_MAX_ITERATIONS; iter++) {
        // Drain queued microtasks (observers in yjsAnnotations.ts dispatch via queueMicrotask).
        await Promise.resolve();
        await Promise.resolve();
        // Check pairwise state-vector equality across all peers.
        const sv0 = Y.encodeStateVector(peers[0].ydoc);
        let converged = true;
        for (let i = 1; i < peers.length; i++) {
            const svi = Y.encodeStateVector(peers[i].ydoc);
            if (!equalUint8(sv0, svi)) {
                converged = false;
                break;
            }
        }
        if (converged) return;
    }
    throw new Error(
        `flushAll: peers did not converge after ${FLUSH_ALL_MAX_ITERATIONS} iterations -- ` +
            `likely amplification or feedback loop (one local op produced an unbounded chain of remote updates)`,
    );
}

function equalUint8(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
```

Add the `import * as Y from "yjs"` if missing (the file currently imports yjs types implicitly via re-exports; verify by reading the existing imports first and only add if `Y.encodeStateVector` is not already available).
</action>
<acceptance_criteria>
- `grep -n "export async function flushAll" src/lib/collab/test-helpers/twoPeerHarness.ts` returns exactly one match.
- `grep -n "export const FLUSH_ALL_MAX_ITERATIONS = 20" src/lib/collab/test-helpers/twoPeerHarness.ts` returns one match.
- `grep -n "Y.encodeStateVector" src/lib/collab/test-helpers/twoPeerHarness.ts` returns at least one match.
- `grep -n "amplification or feedback loop" src/lib/collab/test-helpers/twoPeerHarness.ts` returns one match (loud error message that surfaces the failure mode by name).
- Existing exports (`makePeer`, `makePeerWithAnnotationSync`, `connect`, `teardown`, `Peer`) still present: `grep -E "export (function|interface) (makePeer|makePeerWithAnnotationSync|connect|teardown|Peer)" src/lib/collab/test-helpers/twoPeerHarness.ts` returns five matches.
- `bun run check` exits 0 (no type errors introduced).
</acceptance_criteria>
</task>

<task id="1.1.2">
<title>Add canonical-source invariant comment block to yjsAnnotations.ts</title>
<read_first>
- src/lib/collab/yjsAnnotations.ts (current top-of-file comment, lines 1–50)
- src/lib/collab/yjsBinding.ts (referenced guard sites; verify current line numbers for `origin === "local"` skips)
</read_first>
<action>
Replace the existing top-of-file comment block in `src/lib/collab/yjsAnnotations.ts` (preserve all imports and code; only edit the leading `/** ... */` block) with the following expanded version. Verify the four guard line numbers by reading the actual files BEFORE writing the comment — if line numbers have drifted from the values listed below (yjsBinding.ts:39, yjsAnnotations.ts:74, yjsAnnotations.ts:254, yjsBinding.ts:77), update the references to the actual current lines. Use `grep -n 'origin === "local"' src/lib/collab/yjsBinding.ts src/lib/collab/yjsAnnotations.ts` and `grep -n "yjsAnnotationSync" src/lib/collab/yjsAnnotations.ts` to find the real current positions.

The comment block to write (with line numbers updated to actual current values):

```ts
/**
 * yjsAnnotations.ts -- Yjs ↔ CodeMirror annotation sync plugin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  CANONICAL-SOURCE INVARIANT (v1.1)
 * ─────────────────────────────────────────────────────────────────────────
 *  Yjs is canonical. The CodeMirror `annotationField` is a DERIVED PROJECTION
 *  of the Yjs `annotations` Y.Map. Reads of annotation state for sync purposes
 *  go through `yjsAnnotationToCodeMirror(yMap)`; writes go through Yjs first
 *  inside `ydoc.transact(fn, "local")` and the CM dispatch is the projection.
 *
 *  This file does NOT enforce that contract for the entire codebase yet (Phases
 *  3–5 do that). It is the SOLE writer of `annotationField` on the read path
 *  and it MUST never write to Yjs from inside an observer callback. The Phase 1
 *  convergence property test (HARNESS-02) is the runtime enforcement of the
 *  projection invariant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  FOUR-GUARD ORIGIN DISCIPLINE
 * ─────────────────────────────────────────────────────────────────────────
 *  Feedback loops between CM transactions and Y updates are prevented by four
 *  guard sites that MUST stay in lockstep. If any guard is removed or its
 *  predicate weakened, expect O(N²) relay traffic and the SYNC-06 feedback-
 *  loop test to fail loudly.
 *
 *    Guard 1 -- src/lib/collab/yjsBinding.ts (Y.Text observer)
 *      Skips the CM dispatch when `yTransaction.origin === "local"` (the write
 *      came from this peer's CM binding, not from a remote update).
 *
 *    Guard 2 -- src/lib/collab/yjsAnnotations.ts (Y.Map observer, this file)
 *      Same shape: skips CM dispatch when `yTransaction.origin === "local"`.
 *
 *    Guard 3 -- src/lib/collab/yjsAnnotations.ts (CM update listener, this file)
 *      Skips Y.Map writes when the CM transaction carries the
 *      `yjsAnnotationSync` annotation (i.e., the transaction was DISPATCHED BY
 *      Guard 2's projection, so writing back to Y would echo).
 *
 *    Guard 4 -- src/lib/collab/yjsBinding.ts (CM update listener, Y.Text side)
 *      Same shape on the Y.Text side: skips Y.Text writes when the CM
 *      transaction is itself a remote-applied projection.
 *
 *  Run `grep -n 'origin === "local"' src/lib/collab/{yjsBinding,yjsAnnotations}.ts`
 *  and `grep -n 'yjsAnnotationSync' src/lib/collab/yjsAnnotations.ts` to locate
 *  the live guard sites. Phase 3 may move them; update the line refs above when
 *  it does. The COUNT (four) and the SHAPE (two origin-skips on each side, two
 *  annotation-skips on each side) is the invariant; the line numbers are for
 *  navigation, not enforcement.
 *
 *  Existing JSDoc continues below.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  [...preserve any other existing comment content from the original block...]
 */
```

Preserve any pre-existing role/dependency notes from the original comment block by appending them under the new invariant block (do not delete information; only add the invariant section). Do not modify any code below the comment.
</action>
<acceptance_criteria>
- `grep -n "CANONICAL-SOURCE INVARIANT" src/lib/collab/yjsAnnotations.ts` returns one match in the first 80 lines.
- `grep -n "FOUR-GUARD ORIGIN DISCIPLINE" src/lib/collab/yjsAnnotations.ts` returns one match.
- `grep -c "Guard [1-4] --" src/lib/collab/yjsAnnotations.ts` returns at least 4.
- `grep -n "Yjs is canonical" src/lib/collab/yjsAnnotations.ts` returns one match.
- `grep -n "annotationField is a DERIVED PROJECTION\|derived projection" src/lib/collab/yjsAnnotations.ts` returns at least one match.
- The first non-comment line of the file (i.e., the first `import` statement) is unchanged: `head -100 src/lib/collab/yjsAnnotations.ts | grep -n "^import" | head -1` returns the first import line, and the file still type-checks: `bun run check` exits 0.
- The annotation export is unchanged: `grep -n "export const yjsAnnotationSync = Annotation.define" src/lib/collab/yjsAnnotations.ts` still returns one match.
</acceptance_criteria>
</task>

</tasks>

<verification>
- Run `bun run check` — must exit 0.
- Run `bun run lint` — must exit 0 (no Biome violations introduced).
- Run `bun run test:run src/lib/collab/yjsBinding.convergence.test.ts src/lib/collab/annotation-sync.test.ts` — existing collab tests must still pass (this plan adds code but does not change runtime behavior).
- Manual inspection: `head -80 src/lib/collab/yjsAnnotations.ts` shows the new invariant block with all four guards documented and `file:line` references that match the actual code.
</verification>
</content>
</invoke>