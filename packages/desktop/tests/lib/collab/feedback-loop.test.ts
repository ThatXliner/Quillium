import {
    type Peer,
    connect,
    flushAll,
    makePeerWithAnnotationSync,
    teardown,
} from "$lib/collab/test-helpers/twoPeerHarness";
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
                peerA.view.dispatch({
                    changes: { from: pos, insert: String.fromCharCode(97 + (i % 26)) },
                });
                // Yield once per keystroke to let any synchronous observer chain run.
                await Promise.resolve();
            }
            await flushAll(peerA, peerB);
        } finally {
            peerA.ydoc.off("update", onUpdate);
        }

        expect(
            updateCount,
            `amplification regression: ${N} single-char keystrokes produced ${updateCount} Yjs updates on peer A (expected <= ${N}). One local op is producing more than one Yjs update -- check the four-guard origin discipline in src/lib/collab/yjsAnnotations.ts and src/lib/collab/yjsBinding.ts.`,
        ).toBeLessThanOrEqual(N);
    });
});
