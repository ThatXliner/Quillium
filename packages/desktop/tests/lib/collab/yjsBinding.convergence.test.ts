import { createYjsBinding } from "$lib/collab/yjsBinding";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import fc from "fast-check";
/**
 * yjsBinding.convergence.test.ts -- Two-client convergence tests.
 *
 * Simulates two CodeMirror editors connected via paired Y.Docs that relay
 * updates to each other (like what y-websocket does over the wire).
 * Verifies that both sides converge to identical text after arbitrary
 * transactions from either side.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

interface Peer {
    ydoc: Y.Doc;
    ytext: Y.Text;
    view: EditorView;
}

function makePeer(initialText = ""): Peer {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    if (initialText) {
        ydoc.transact(() => ytext.insert(0, initialText), "init");
    }
    const state = EditorState.create({
        doc: initialText,
        extensions: [createYjsBinding(ytext)],
    });
    const view = new EditorView({ state, parent: document.body });
    return { ydoc, ytext, view };
}

/**
 * Wire two peers so updates from one apply to the other, mimicking a relay.
 * Returns a cleanup function.
 */
function connect(a: Peer, b: Peer): () => void {
    const aToB = (update: Uint8Array, origin: unknown) => {
        if (origin === "remote") return;
        Y.applyUpdate(b.ydoc, update, "remote");
    };
    const bToA = (update: Uint8Array, origin: unknown) => {
        if (origin === "remote") return;
        Y.applyUpdate(a.ydoc, update, "remote");
    };
    a.ydoc.on("update", aToB);
    b.ydoc.on("update", bToA);
    return () => {
        a.ydoc.off("update", aToB);
        b.ydoc.off("update", bToA);
    };
}

describe("yjsBinding convergence (2 clients)", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: () => void;

    beforeEach(() => {
        peerA = makePeer();
        peerB = makePeer();
        disconnect = connect(peerA, peerB);
    });

    afterEach(() => {
        disconnect();
        peerA.view.destroy();
        peerB.view.destroy();
        peerA.ydoc.destroy();
        peerB.ydoc.destroy();
    });

    it("single-change local insert propagates to remote editor", () => {
        peerA.view.dispatch({ changes: { from: 0, insert: "hello" } });
        expect(peerA.ytext.toString()).toBe("hello");
        expect(peerB.ytext.toString()).toBe("hello");
        expect(peerA.view.state.doc.toString()).toBe("hello");
        expect(peerB.view.state.doc.toString()).toBe("hello");
    });

    it("multi-change transaction converges", () => {
        // Seed both peers
        peerA.view.dispatch({ changes: { from: 0, insert: "hello world" } });
        expect(peerB.view.state.doc.toString()).toBe("hello world");

        // Multi-change transaction: replace "hello" with "hi" AND "world" with "everyone"
        peerA.view.dispatch({
            changes: [
                { from: 0, to: 5, insert: "hi" },
                { from: 6, to: 11, insert: "everyone" },
            ],
        });

        expect(peerA.view.state.doc.toString()).toBe("hi everyone");
        expect(peerA.ytext.toString()).toBe("hi everyone");
        expect(peerB.ytext.toString()).toBe("hi everyone");
        expect(peerB.view.state.doc.toString()).toBe("hi everyone");
    });

    it("interleaved edits from both peers converge", () => {
        peerA.view.dispatch({ changes: { from: 0, insert: "AAA" } });
        peerB.view.dispatch({ changes: { from: 0, insert: "BBB" } });
        // Either order is OK, but both peers must agree.
        expect(peerA.view.state.doc.toString()).toBe(peerB.view.state.doc.toString());
        expect(peerA.ytext.toString()).toBe(peerB.ytext.toString());
        expect(peerA.view.state.doc.toString().length).toBe(6);
    });

    it("multi-change on multi-line doc converges", () => {
        peerA.view.dispatch({ changes: { from: 0, insert: "line1\nline2\nline3" } });
        expect(peerB.view.state.doc.toString()).toBe("line1\nline2\nline3");

        // Replace multiple lines at once in a single transaction
        peerA.view.dispatch({
            changes: [
                { from: 0, to: 5, insert: "FIRST" },
                { from: 12, to: 17, insert: "THIRD" },
            ],
        });

        expect(peerA.view.state.doc.toString()).toBe("FIRST\nline2\nTHIRD");
        expect(peerA.ytext.toString()).toBe(peerB.ytext.toString());
        expect(peerB.view.state.doc.toString()).toBe("FIRST\nline2\nTHIRD");
    });

    it("random single-change sequences converge (property-based)", () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        peer: fc.constantFrom("A" as const, "B" as const),
                        text: fc.string({ minLength: 1, maxLength: 8 }),
                    }),
                    { minLength: 1, maxLength: 30 },
                ),
                (ops) => {
                    // Fresh peers per run
                    disconnect();
                    peerA.view.destroy();
                    peerB.view.destroy();
                    peerA.ydoc.destroy();
                    peerB.ydoc.destroy();
                    peerA = makePeer();
                    peerB = makePeer();
                    disconnect = connect(peerA, peerB);

                    for (const op of ops) {
                        const peer = op.peer === "A" ? peerA : peerB;
                        const docLen = peer.view.state.doc.length;
                        const pos = Math.min(docLen, Math.floor(Math.random() * (docLen + 1)));
                        peer.view.dispatch({ changes: { from: pos, insert: op.text } });
                    }

                    expect(peerA.view.state.doc.toString()).toBe(peerB.view.state.doc.toString());
                    expect(peerA.ytext.toString()).toBe(peerB.ytext.toString());
                    expect(peerA.view.state.doc.toString()).toBe(peerA.ytext.toString());
                },
            ),
            { numRuns: 30 },
        );
    });
});
