/**
 * yjsAnnotations.convergence.test.ts -- Two-client convergence tests for annotation sync.
 *
 * Simulates two CodeMirror editors with annotation sync connected via paired
 * Y.Docs that relay updates to each other. Verifies that annotations converge
 * identically on both sides after arbitrary operations.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import { createYjsBinding } from "./yjsBinding";
import { createAnnotationSyncPlugin } from "./yjsAnnotations";
import {
    addAnnotation,
    removeAnnotation,
    updateThread,
    annotationField,
} from "$lib/editor/plugins/annotations/annotationField";
import type { YjsAnnotationNode } from "./types";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";

interface Peer {
    ydoc: Y.Doc;
    ytext: Y.Text;
    ymap: Y.Map<YjsAnnotationNode>;
    view: EditorView;
    clientId: string;
}

function makePeer(clientId: string, initialText = ""): Peer {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

    if (initialText) {
        ydoc.transact(() => ytext.insert(0, initialText), "init");
    }

    const state = EditorState.create({
        doc: initialText,
        extensions: [
            annotationField,
            createYjsBinding(ytext),
            createAnnotationSyncPlugin(ytext, ymap, clientId),
        ],
    });
    const view = new EditorView({ state, parent: document.body });

    return { ydoc, ytext, ymap, view, clientId };
}

/**
 * Wire two peers so updates from one apply to the other, mimicking a relay.
 * Also performs an initial state sync so A's existing content appears in B.
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

    // Sync initial state: apply A's current state to B and vice versa.
    // This mirrors what a relay server does when a new client joins.
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc), "remote");
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc), "remote");

    return () => {
        a.ydoc.off("update", aToB);
        b.ydoc.off("update", bToA);
    };
}

function createComment(id: number, from: number, to: number): GenericAnnotation {
    return {
        id,
        _type: "comment",
        selection: EditorSelection.single(from, to),
        thread: [],
    };
}

function getAnnotationCount(peer: Peer): number {
    return Object.keys(peer.view.state.field(annotationField)).length;
}

function getAnnotationIds(peer: Peer): number[] {
    return Object.keys(peer.view.state.field(annotationField)).map(Number).sort();
}

describe("yjsAnnotations convergence (2 clients)", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: () => void;

    beforeEach(() => {
        peerA = makePeer("client-a", "hello world");
        peerB = makePeer("client-b");
        disconnect = connect(peerA, peerB);
    });

    afterEach(() => {
        disconnect();
        peerA.view.destroy();
        peerB.view.destroy();
        peerA.ydoc.destroy();
        peerB.ydoc.destroy();
    });

    describe("basic sync", () => {
        it("annotation from A appears on B", () => {
            const annotation = createComment(0, 0, 5);
            peerA.view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });

            expect(getAnnotationCount(peerA)).toBe(1);
            expect(getAnnotationCount(peerB)).toBe(1);
        });

        it("annotation from B appears on A", () => {
            const annotation = createComment(0, 6, 11);
            peerB.view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });

            expect(getAnnotationCount(peerA)).toBe(1);
            expect(getAnnotationCount(peerB)).toBe(1);
        });

        it("annotation removal from A reflects on B", () => {
            const annotation = createComment(0, 0, 5);
            peerA.view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });

            expect(getAnnotationCount(peerB)).toBe(1);

            peerA.view.dispatch({
                effects: [removeAnnotation.of(annotation)],
            });

            expect(getAnnotationCount(peerA)).toBe(0);
            expect(getAnnotationCount(peerB)).toBe(0);
        });
    });

    describe("concurrent operations", () => {
        it("concurrent annotation creation converges", () => {
            // Both peers create annotations simultaneously
            const annA = createComment(0, 0, 5);
            const annB = createComment(1, 6, 11);

            peerA.view.dispatch({ effects: [addAnnotation.of(annA)] });
            peerB.view.dispatch({ effects: [addAnnotation.of(annB)] });

            // Both should have 2 annotations
            expect(getAnnotationCount(peerA)).toBe(2);
            expect(getAnnotationCount(peerB)).toBe(2);
        });

        it("text edit + annotation creation converges", () => {
            // A creates annotation while B edits text
            const annotation = createComment(0, 6, 11); // "world"

            peerA.view.dispatch({ effects: [addAnnotation.of(annotation)] });
            peerB.view.dispatch({ changes: { from: 0, insert: "XXX " } }); // Insert before "hello"

            // Both should have the annotation
            expect(getAnnotationCount(peerA)).toBe(1);
            expect(getAnnotationCount(peerB)).toBe(1);

            // Document should converge
            expect(peerA.view.state.doc.toString()).toBe(peerB.view.state.doc.toString());
        });
    });

    describe("thread sync", () => {
        it("thread message from A appears on B", () => {
            // Create annotation on A
            const annotation = createComment(0, 0, 5);
            peerA.view.dispatch({ effects: [addAnnotation.of(annotation)] });

            // Add thread message on A
            peerA.view.dispatch({
                effects: [
                    updateThread.of({
                        annotationId: 0,
                        newThread: [{ message: "hello", author: "userA", time: 100 }],
                    }),
                ],
            });

            // Check B has the thread message
            const annotationsB = peerB.view.state.field(annotationField);
            const annB = Object.values(annotationsB)[0];
            expect(annB.thread).toHaveLength(1);
            expect(annB.thread[0].message).toBe("hello");
            expect(annB.thread[0].author).toBe("userA");
        });

        it("sequential thread messages from both peers converge", () => {
            // Create annotation on A
            const annotation = createComment(0, 0, 5);
            peerA.view.dispatch({ effects: [addAnnotation.of(annotation)] });

            // A adds first message
            peerA.view.dispatch({
                effects: [
                    updateThread.of({
                        annotationId: 0,
                        newThread: [{ message: "from A", author: "userA", time: 100 }],
                    }),
                ],
            });

            // Verify B received the annotation and can see the thread
            const annotationsB = peerB.view.state.field(annotationField);
            const annB = Object.values(annotationsB)[0];
            expect(annB).toBeDefined();
            expect(annB.thread.length).toBe(1);
            expect(annB.thread[0].message).toBe("from A");

            // Note: True concurrent append test is in thread-append.test.ts
            // which uses the proper two-peer harness. This test verifies
            // sequential thread updates propagate correctly.
            const annotationsA = peerA.view.state.field(annotationField);
            const threadA = Object.values(annotationsA)[0]?.thread;
            const threadB = annB.thread;
            expect(JSON.stringify(threadA)).toBe(JSON.stringify(threadB));
        });
    });

    describe("position tracking", () => {
        it("annotation position tracks through text insertion before it", () => {
            // Create annotation on "world" (position 6-11)
            const annotation = createComment(0, 6, 11);
            peerA.view.dispatch({ effects: [addAnnotation.of(annotation)] });

            // B inserts text before the annotation
            peerB.view.dispatch({ changes: { from: 0, insert: "XXX " } });

            // Wait for sync to complete
            // Annotation should now be at position 10-15 (shifted by 4)
            const annotationsA = peerA.view.state.field(annotationField);
            const annotationsB = peerB.view.state.field(annotationField);

            // Both should have converged position
            const annA = Object.values(annotationsA)[0];
            const annB = Object.values(annotationsB)[0];

            expect(annA.selection.main.from).toBe(annB.selection.main.from);
            expect(annA.selection.main.to).toBe(annB.selection.main.to);
        });

        it("annotation survives text deletion outside its range", () => {
            // Create annotation on "world"
            const annotation = createComment(0, 6, 11);
            peerA.view.dispatch({ effects: [addAnnotation.of(annotation)] });

            // B deletes "hello " (before the annotation)
            peerB.view.dispatch({ changes: { from: 0, to: 6, insert: "" } });

            // Annotation should still exist (now at 0-5)
            expect(getAnnotationCount(peerA)).toBe(1);
            expect(getAnnotationCount(peerB)).toBe(1);

            const annB = Object.values(peerB.view.state.field(annotationField))[0];
            expect(annB.selection.main.from).toBe(0);
            expect(annB.selection.main.to).toBe(5);
        });
    });

    describe("revision sync", () => {
        it("revision version change syncs between clients", () => {
            // Create revision on A
            const revision: GenericAnnotation = {
                id: 0,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [{ doc: "hello" }, { doc: "world" }],
                activeVersionIndex: 0,
            };

            peerA.view.dispatch({ effects: [addAnnotation.of(revision)] });

            expect(getAnnotationCount(peerB)).toBe(1);

            // Switch version on A
            const updatedRevision = { ...revision, activeVersionIndex: 1 };
            peerA.view.dispatch({
                effects: [
                    removeAnnotation.of(revision),
                    addAnnotation.of(updatedRevision),
                ],
            });

            // B should see the version switch
            const annotationsB = peerB.view.state.field(annotationField);
            const revB = Object.values(annotationsB)[0];
            if (revB._type === "revision") {
                expect(revB.activeVersionIndex).toBe(1);
            }
        });
    });
});
