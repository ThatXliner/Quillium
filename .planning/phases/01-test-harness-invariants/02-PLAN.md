---
phase: 1
plan: 2
title: Convergence property test (yjsAnnotationToCodeMirror === annotationField)
wave: 2
depends_on: [1]
requirements: [HARNESS-02]
files_modified:
  - src/lib/collab/convergence-projection.test.ts
autonomous: true
---

<objective>
Add a fast-check property-based test that asserts, for random sequences of local annotation effects on two connected peers, the projection invariant holds after every `flushAll`:

  `yjsAnnotationToCodeMirror(peer.ymap) === peer.view.state.field(annotationField)`

This is the runtime enforcement of the canonical-source contract documented in Plan 01's invariant comment block (HARNESS-02 / Phase 1 SC-2). Failures that exist on current code are `.skip`'d with a TODO referencing the phase that will fix them; the baseline is "whatever passes is what we don't regress on."
</objective>

<must_haves>
- A new file `src/lib/collab/convergence-projection.test.ts` exists and is picked up by the existing Vitest config (no config edits required — it sits alongside other `*.test.ts` files in `src/lib/collab/`).
- The test uses fast-check (`fc.assert` + `fc.asyncProperty`) to drive random local-effect sequences against two peers built with `makePeerWithAnnotationSync`.
- After every `flushAll`, both peers' projected annotation state (via `yjsAnnotationToCodeMirror`) is deeply equal to their live `annotationField` state.
- Any case that fails against current code is marked `.skip` with `TODO(phase-N):` referencing Phase 3 or 4 (per D-13). Do NOT attempt to fix sync-layer bugs in this plan.
</must_haves>

<tasks>

<task id="1.2.1">
<title>Write convergence-projection.test.ts</title>
<read_first>
- src/lib/collab/test-helpers/twoPeerHarness.ts (uses flushAll from Plan 01, makePeerWithAnnotationSync, connect, teardown)
- src/lib/collab/annotationSchema.ts (yjsAnnotationToCodeMirror signature — currently lines around 110)
- src/lib/collab/yjsBinding.convergence.test.ts (reference style for beforeEach/afterEach + connect/disconnect cleanup)
- src/lib/collab/annotation-sync.test.ts (reference for how local annotation effects are dispatched in existing tests)
- src/lib/editor/plugins/annotations/annotationField.ts (annotationField StateField, the projection target)
- src/lib/editor/plugins/annotations/index.ts (exported annotation effects: addAnnotation / removeAnnotation / etc. — locate the actual exported effect names before composing the fast-check arbitrary)
</read_first>
<action>
Create `src/lib/collab/convergence-projection.test.ts` with the following structure (resolve actual effect names by reading `src/lib/editor/plugins/annotations/index.ts` first; substitute the real exported names where the placeholder `dispatchRandomLocalEffect` is used):

```ts
/**
 * convergence-projection.test.ts -- HARNESS-02 (Phase 1 SC-2).
 *
 * Property: for any sequence of local annotation effects applied to two
 * connected peers, after flushAll, each peer's `yjsAnnotationToCodeMirror(ymap)`
 * deep-equals its live `annotationField` state.
 *
 * This is the runtime enforcement of the canonical-source contract documented
 * in src/lib/collab/yjsAnnotations.ts. If this test fails after a Phase 3-5
 * change, the projection invariant has broken; revert or fix before merging.
 *
 * Per D-13: failures against CURRENT code are `.skip`'d with a TODO referencing
 * the fixing phase. This file does not fix sync-layer bugs.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as fc from "fast-check";
import {
    type Peer,
    connect,
    flushAll,
    makePeerWithAnnotationSync,
    teardown,
} from "./test-helpers/twoPeerHarness";
import { yjsAnnotationToCodeMirror } from "./annotationSchema";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import type { YjsAnnotationNode } from "./types";

// -- helpers ---------------------------------------------------------------

function projectFromYjs(peer: Peer): unknown {
    // Build the projection the same way yjsAnnotations.ts does at runtime,
    // then normalize to a comparable shape (sorted by id) so deep-equal does
    // not flake on key/insertion order.
    const projected: Record<string, unknown> = {};
    peer.ymap.forEach((value, id) => {
        const node = yjsAnnotationToCodeMirror(
            value as YjsAnnotationNode,
            peer.ydoc,
            peer.ytext,
            id,
        );
        if (node !== null) projected[id] = node;
    });
    return normalize(projected);
}

function projectFromCM(peer: Peer): unknown {
    const live = peer.view.state.field(annotationField);
    return normalize(live as unknown);
}

function normalize(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(normalize);
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
}

// -- fast-check arbitrary --------------------------------------------------

// LocalEffect = a serializable description of a single local mutation that the
// test will translate into a real CM dispatch on a chosen peer.
// Keep the surface small in Phase 1: text-typing + create/remove annotation
// are enough to exercise the projection. Phase 9 fuzz expands this.
type LocalEffect =
    | { kind: "type"; peer: 0 | 1; text: string; pos: number }
    | { kind: "delete"; peer: 0 | 1; from: number; to: number };

const effectArb: fc.Arbitrary<LocalEffect> = fc.oneof(
    fc.record({
        kind: fc.constant("type" as const),
        peer: fc.constantFrom<0 | 1>(0, 1),
        text: fc.string({ minLength: 1, maxLength: 5 }),
        pos: fc.nat({ max: 50 }),
    }),
    fc.record({
        kind: fc.constant("delete" as const),
        peer: fc.constantFrom<0 | 1>(0, 1),
        from: fc.nat({ max: 50 }),
        to: fc.nat({ max: 50 }),
    }),
);

function applyEffect(peers: [Peer, Peer], eff: LocalEffect) {
    const peer = peers[eff.peer];
    const docLen = peer.view.state.doc.length;
    if (eff.kind === "type") {
        const pos = Math.min(eff.pos, docLen);
        peer.view.dispatch({ changes: { from: pos, insert: eff.text } });
    } else {
        const from = Math.min(eff.from, docLen);
        const to = Math.min(Math.max(eff.to, from), docLen);
        if (from !== to) peer.view.dispatch({ changes: { from, to, insert: "" } });
    }
}

// -- test ------------------------------------------------------------------

describe("HARNESS-02: projection convergence property", () => {
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

    test("yjsAnnotationToCodeMirror equals annotationField on both peers after flushAll", async () => {
        await fc.assert(
            fc.asyncProperty(fc.array(effectArb, { maxLength: 12 }), async (effects) => {
                for (const eff of effects) {
                    applyEffect([peerA, peerB], eff);
                }
                await flushAll(peerA, peerB);
                expect(projectFromCM(peerA)).toEqual(projectFromYjs(peerA));
                expect(projectFromCM(peerB)).toEqual(projectFromYjs(peerB));
            }),
            { numRuns: 25 },
        );
    });
});
```

If during implementation any property-test failure surfaces a real sync-layer bug in current code, do NOT fix it. Wrap the offending case (or the entire `test(...)` block, if the failure is broad) with `test.skip` and a comment of the form:
  `// TODO(phase-3): fails because <one-line root cause>. Re-enable after commands.ts lands.`
Choose phase-3 if the root cause is on the write path (CM → Yjs), phase-4 if it is on the read path (Yjs → CM).
</action>
<acceptance_criteria>
- File `src/lib/collab/convergence-projection.test.ts` exists.
- `grep -n "import \* as fc from \"fast-check\"" src/lib/collab/convergence-projection.test.ts` returns one match.
- `grep -n "from \"./test-helpers/twoPeerHarness\"" src/lib/collab/convergence-projection.test.ts` returns one match and includes `flushAll` in the named imports: `grep -n "flushAll" src/lib/collab/convergence-projection.test.ts` returns at least two matches (import + call).
- `grep -n "yjsAnnotationToCodeMirror" src/lib/collab/convergence-projection.test.ts` returns at least two matches (import + call inside `projectFromYjs`).
- `grep -n "annotationField" src/lib/collab/convergence-projection.test.ts` returns at least two matches.
- `grep -n "fc.asyncProperty\|fc.assert" src/lib/collab/convergence-projection.test.ts` returns at least two matches.
- `bun run check` exits 0.
- `bun run test:run src/lib/collab/convergence-projection.test.ts` exits 0 (passing or all-skipped is acceptable per D-13; failing-and-not-skipped is NOT acceptable).
</acceptance_criteria>
</task>

</tasks>

<verification>
- `bun run check` exits 0.
- `bun run test:run src/lib/collab/convergence-projection.test.ts` exits 0.
- If any block was `.skip`'d, every skip carries a `TODO(phase-N):` comment naming the responsible later phase.
- Existing collab convergence tests (`src/lib/collab/yjsBinding.convergence.test.ts`, `src/lib/collab/annotation-sync.test.ts`, `src/lib/collab/thread-append.test.ts`) still pass.
</verification>
</content>
</invoke>