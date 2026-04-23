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
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { yjsAnnotationToCodeMirror } from "./annotationSchema";
import {
    type Peer,
    connect,
    flushAll,
    makePeerWithAnnotationSync,
    teardown,
} from "./test-helpers/twoPeerHarness";
import type { YjsAnnotationNode } from "./types";

// -- helpers ---------------------------------------------------------------

function projectFromYjs(peer: Peer): unknown {
    // Build the projection the same way yjsAnnotations.ts does at runtime,
    // then normalize to a comparable shape (sorted by id) so deep-equal does
    // not flake on key/insertion order.
    const projected: Record<string, unknown> = {};
    peer.ymap.forEach((value, yjsId) => {
        const cmId = peer.idMap?.getCmId(yjsId);
        if (cmId === undefined) return;
        const node = yjsAnnotationToCodeMirror(
            value as YjsAnnotationNode,
            peer.ydoc,
            peer.ytext,
            cmId,
        );
        if (node !== null) projected[String(cmId)] = node;
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
// Keep the surface small in Phase 1: text-typing + delete are enough to
// exercise the projection. Phase 9 fuzz expands this to cover annotation
// create/remove effects.
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
