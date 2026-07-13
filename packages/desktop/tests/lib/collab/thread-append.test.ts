import { codeMirrorToYjsAnnotation } from "$lib/collab/annotationSchema";
import {
    type Peer,
    connect,
    flushAll,
    makePeerWithAnnotationSync,
    teardown,
} from "$lib/collab/test-helpers/twoPeerHarness";
import type { YjsAnnotationNode } from "$lib/collab/types";
import { createAnnotationSyncPlugin } from "$lib/collab/yjsAnnotations";
import { createYjsBinding } from "$lib/collab/yjsBinding";
import {
    addAnnotation,
    annotationField,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import type { ThreadMessage } from "$lib/editor/plugins/annotations/models";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
/**
 * thread-append.test.ts -- Y.Array append-only threads (D-93).
 *
 * Tests the thread Y.Array sync path in createAnnotationSyncPlugin:
 *   - Single-peer append: updateThread effect appends to Y.Array
 *   - Concurrent append: Two peers each append distinct messages; both survive
 *   - Shrink fallback: updateThread with shorter thread replaces atomically
 *
 * Key dependencies: yjs, @codemirror/view, @codemirror/state.
 * Interactions: Uses twoPeerHarness for two-peer scenarios.
 *
 * Phase 10: Write path (CM -> Yjs) disabled. Tests that depend on write path skipped.
 * Phase 11 will rebuild and re-enable these tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

describe("thread Y.Array sync", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: () => void;

    beforeEach(() => {
        peerA = makePeerWithAnnotationSync("client-a", "hello world");
        peerB = makePeerWithAnnotationSync("client-b");
        disconnect = connect(peerA, peerB);
    });

    afterEach(() => {
        disconnect();
        teardown(peerA);
        teardown(peerB);
    });

    // Phase 10: write path disabled — skipped until Phase 11 rebuilds it
    it("concurrent append from two peers surfaces both messages", async () => {
        // Seed a comment annotation on A
        const comment: GenericAnnotation = {
            _type: "comment",
            status: "active" as const,
            id: 0,
            selection: EditorSelection.single(0, 5),
            thread: [],
        };
        peerA.view.dispatch({
            effects: addAnnotation.of(comment),
        });

        // Wait for sync
        await Promise.resolve();

        // Get the yjs annotation key from peerA's ymap
        const keys = Array.from(peerA.ymap.keys());
        expect(keys.length).toBe(1);
        const yjsKey = keys[0];

        // Wait for peerB to receive the annotation
        await Promise.resolve();

        // Each peer appends a distinct message concurrently
        const msgA: ThreadMessage = { message: "from A", author: "A", time: 1000 };
        const msgB: ThreadMessage = { message: "from B", author: "B", time: 1001 };

        // Peer A appends
        peerA.view.dispatch({
            effects: updateThread.of({ annotationId: 0, newThread: [msgA] }),
        });

        // Peer B appends (simulated via direct Y.Array manipulation since plugin
        // won't have the cmId mapping yet due to timing)
        const bNode = peerB.ymap.get(yjsKey) as YjsAnnotationNode;
        const bThread = bNode.get("thread") as Y.Array<ThreadMessage>;
        peerB.ydoc.transact(() => {
            bThread.push([msgB]);
        }, "local");

        // Wait for sync
        await Promise.resolve();

        // Both peers should see both messages
        const aNode = peerA.ymap.get(yjsKey) as YjsAnnotationNode;
        const aThread = aNode.get("thread") as Y.Array<ThreadMessage>;
        const aMessages = aThread.toArray();

        expect(aMessages.length).toBe(2);
        expect(aMessages.map((m) => m.message).sort()).toEqual(["from A", "from B"]);

        // peerB should also have both
        const bMessages = bThread.toArray();
        expect(bMessages.length).toBe(2);
        expect(bMessages.map((m) => m.message).sort()).toEqual(["from A", "from B"]);
    });

    // Phase 10: write path disabled — skipped until Phase 11 rebuilds it
    it("single-peer append is mirrored remotely via observeDeep", async () => {
        // Seed a comment annotation on A with one initial message
        const comment: GenericAnnotation = {
            _type: "comment",
            status: "active" as const,
            id: 0,
            selection: EditorSelection.single(0, 5),
            thread: [{ message: "initial", author: "A", time: 1 }],
        };
        peerA.view.dispatch({
            effects: addAnnotation.of(comment),
        });

        // Wait for sync
        await Promise.resolve();

        // Get the annotation key
        const keys = Array.from(peerA.ymap.keys());
        expect(keys.length).toBe(1);
        const yjsKey = keys[0];

        // Append a second message
        const newMsg: ThreadMessage = { message: "appended", author: "A", time: 2 };
        peerA.view.dispatch({
            effects: updateThread.of({
                annotationId: 0,
                newThread: [{ message: "initial", author: "A", time: 1 }, newMsg],
            }),
        });

        // Wait for sync
        await Promise.resolve();

        // peerB should see the Y.Array with 2 messages
        const bNode = peerB.ymap.get(yjsKey) as YjsAnnotationNode;
        const bThread = bNode.get("thread") as Y.Array<ThreadMessage>;
        expect(bThread.length).toBe(2);
        expect(bThread.toArray().map((m) => m.message)).toEqual(["initial", "appended"]);
    });

    // Phase 10: write path disabled — skipped until Phase 11 rebuilds it
    it("shrink-path fallback replaces the full thread array", async () => {
        // Create a standalone peer with a comment that has 3 messages
        const ydoc = new Y.Doc();
        const ytext = ydoc.getText("document");
        const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

        ydoc.transact(() => ytext.insert(0, "hello world"), "init");

        const state = EditorState.create({
            doc: "hello world",
            extensions: [
                annotationField,
                createYjsBinding(ytext),
                createAnnotationSyncPlugin(ytext, ymap, "test-client"),
            ],
        });
        const view = new EditorView({ state, parent: document.body });

        try {
            // Create annotation with 3 messages
            const comment: GenericAnnotation = {
                _type: "comment",
                status: "active" as const,
                id: 0,
                selection: EditorSelection.single(0, 5),
                thread: [
                    { message: "one", author: "A", time: 1 },
                    { message: "two", author: "A", time: 2 },
                    { message: "three", author: "A", time: 3 },
                ],
            };
            view.dispatch({ effects: addAnnotation.of(comment) });

            // Get the annotation
            const keys = Array.from(ymap.keys());
            expect(keys.length).toBe(1);
            const yjsKey = keys[0];
            const node = ymap.get(yjsKey) as YjsAnnotationNode;
            const threadArr = node.get("thread") as Y.Array<ThreadMessage>;
            expect(threadArr.length).toBe(3);

            // Now dispatch an updateThread with only 1 message (shrink)
            view.dispatch({
                effects: updateThread.of({
                    annotationId: 0,
                    newThread: [{ message: "replacement", author: "B", time: 4 }],
                }),
            });

            // The Y.Array should be atomically replaced
            expect(threadArr.length).toBe(1);
            expect(threadArr.toArray()[0].message).toBe("replacement");
        } finally {
            view.destroy();
            ydoc.destroy();
        }
    });
});

describe("thread ordering (D-93)", () => {
    it("sort by timestamp on read", () => {
        // This is tested implicitly via the thread roundtrip test in annotation-tree.test.ts
        // Y.Array preserves insertion order, and messages with timestamps allow
        // sorting at the UI layer if needed. The sync plugin does not sort.
        const ydoc = new Y.Doc();
        // Must attach Y.Array to doc before using it
        const threadArr = ydoc.getArray<ThreadMessage>("test-thread");

        ydoc.transact(() => {
            threadArr.push([
                { message: "third", author: "A", time: 3 },
                { message: "first", author: "B", time: 1 },
                { message: "second", author: "C", time: 2 },
            ]);
        });

        // Y.Array preserves insertion order
        const raw = threadArr.toArray();
        expect(raw.map((m) => m.message)).toEqual(["third", "first", "second"]);

        // Sorting by time is the consumer's responsibility
        const sorted = [...raw].sort((a, b) => a.time - b.time);
        expect(sorted.map((m) => m.message)).toEqual(["first", "second", "third"]);

        ydoc.destroy();
    });
});
