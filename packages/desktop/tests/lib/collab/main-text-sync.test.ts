import { type Peer, connect, makePeer, teardown } from "$lib/collab/test-helpers/twoPeerHarness";
/**
 * main-text-sync.test.ts -- Phase 10 integration test proving main text sync works.
 *
 * Success criterion #8: "two peers connected via the twoPeerHarness, main text
 * edits on peer A character-wise appear on peer B"
 *
 * This test uses the stripped twoPeerHarness (no annotation sync) to verify
 * that Yjs text binding still works after Phase 10's cleanup.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("main text sync (Phase 10 verification)", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: () => void;

    beforeEach(() => {
        peerA = makePeer("peer-a", "initial");
        peerB = makePeer("peer-b");
        disconnect = connect(peerA, peerB);
    });

    afterEach(() => {
        disconnect();
        teardown(peerA);
        teardown(peerB);
    });

    it("peer B receives peer A initial content on connect", () => {
        // After connect(), initial sync should have propagated
        expect(peerA.view.state.doc.toString()).toBe("initial");
        expect(peerB.view.state.doc.toString()).toBe("initial");
        expect(peerA.ytext.toString()).toBe("initial");
        expect(peerB.ytext.toString()).toBe("initial");
    });

    it("character-wise insert on peer A appears on peer B", () => {
        // Type "X" at position 0 on peer A
        peerA.view.dispatch({ changes: { from: 0, insert: "X" } });

        // Should appear on peer B
        expect(peerA.view.state.doc.toString()).toBe("Xinitial");
        expect(peerB.view.state.doc.toString()).toBe("Xinitial");
    });

    it("character-wise insert on peer B appears on peer A", () => {
        // Type "Y" at end on peer B
        const len = peerB.view.state.doc.length;
        peerB.view.dispatch({ changes: { from: len, insert: "Y" } });

        // Should appear on peer A
        expect(peerA.view.state.doc.toString()).toBe("initialY");
        expect(peerB.view.state.doc.toString()).toBe("initialY");
    });

    it("concurrent edits from both peers merge correctly", () => {
        // Peer A inserts at start, peer B appends at end (based on its view)
        peerA.view.dispatch({ changes: { from: 0, insert: "A" } });
        // Peer B's doc is now "Ainitial" (8 chars). Insert at end.
        const lenB = peerB.view.state.doc.length;
        peerB.view.dispatch({ changes: { from: lenB, insert: "B" } });

        // Both should converge to same content: "AinitialB"
        const aDoc = peerA.view.state.doc.toString();
        const bDoc = peerB.view.state.doc.toString();
        expect(aDoc).toBe(bDoc);
        expect(aDoc).toBe("AinitialB");
    });

    it("deletion on peer A reflects on peer B", () => {
        // Delete first 2 chars on peer A
        peerA.view.dispatch({ changes: { from: 0, to: 2, insert: "" } });

        expect(peerA.view.state.doc.toString()).toBe("itial");
        expect(peerB.view.state.doc.toString()).toBe("itial");
    });

    it("replace on peer A reflects on peer B", () => {
        // Replace "init" with "XXXX"
        peerA.view.dispatch({ changes: { from: 0, to: 4, insert: "XXXX" } });

        expect(peerA.view.state.doc.toString()).toBe("XXXXial");
        expect(peerB.view.state.doc.toString()).toBe("XXXXial");
    });

    it("multi-character typing sequence syncs correctly", () => {
        // Simulate typing "hello" character by character
        const chars = "hello".split("");
        let pos = 0;
        for (const c of chars) {
            peerA.view.dispatch({ changes: { from: pos, insert: c } });
            pos++;
        }

        expect(peerA.view.state.doc.toString()).toBe("helloinitial");
        expect(peerB.view.state.doc.toString()).toBe("helloinitial");
    });
});
