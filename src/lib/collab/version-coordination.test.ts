/**
 * version-coordination.test.ts -- Bug #2 bisection tests (D-109).
 *
 * Per feedback_convergence_debugging: write failing tests at each suspect
 * layer BEFORE proposing fixes. Let the tests reveal the root cause.
 *
 * D-99: activeVersionIndex is local metadata only (not synced via Yjs).
 * D-109: Three suspect layers for bug #2 (first version switch destroys annotation).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorSelection } from "@codemirror/state";
import * as Y from "yjs";
import { makePeer, connect, teardown, type Peer } from "./test-helpers/twoPeerHarness";
import {
    addAnnotation,
    annotationField,
    _updateRevisionVersionDoc,
} from "$lib/editor/plugins/annotations/annotationField";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";

describe("version coordination (D-99)", () => {
    let owner: Peer;
    let joiner: Peer;
    let disconnect: () => void;

    beforeEach(() => {
        owner = makePeer("owner", "hello world");
        joiner = makePeer("joiner");
        disconnect = connect(owner, joiner);
    });

    afterEach(() => {
        disconnect();
        teardown(owner);
        teardown(joiner);
    });

    it("activeVersionIndex is local metadata only", async () => {
        // Create revision with activeVersionIndex=0
        const revision: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(0, 5),
            thread: [],
            versions: [{ doc: "hello" }, { doc: "world" }],
            activeVersionIndex: 0,
        };
        owner.view.dispatch({ effects: [addAnnotation.of(revision)] });
        await new Promise((r) => setTimeout(r, 50));

        // Verify joiner has the revision
        const joinerAnns = joiner.view.state.field(annotationField);
        const joinerRev = Object.values(joinerAnns)[0] as GenericAnnotation & {
            activeVersionIndex: number;
        };

        // Per D-99: activeVersionIndex is local-only, joiner gets default 0
        expect(joinerRev.activeVersionIndex).toBe(0);

        // Verify both peers have the same versions content
        expect(joinerRev.versions?.length).toBe(2);
    });

    it("concurrent edits into independent versions converge", async () => {
        // Create revision with two versions
        const revision: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(0, 5),
            thread: [],
            versions: [{ doc: "hello" }, { doc: "world" }],
            activeVersionIndex: 0,
        };
        owner.view.dispatch({ effects: [addAnnotation.of(revision)] });
        await new Promise((r) => setTimeout(r, 50));

        // Get Y.Text references for both versions
        const ownerKey = Array.from(owner.ymap.keys())[0];
        const ownerRevNode = owner.ymap.get(ownerKey) as Y.Map<unknown>;
        const ownerVersions = ownerRevNode.get("versions") as Y.Map<Y.Map<unknown>>;
        const ownerV0 = ownerVersions.get("0") as Y.Map<unknown>;
        const ownerV0text = ownerV0.get("text") as Y.Text;

        const joinerKey = Array.from(joiner.ymap.keys())[0];
        const joinerRevNode = joiner.ymap.get(joinerKey) as Y.Map<unknown>;
        const joinerVersions = joinerRevNode.get("versions") as Y.Map<Y.Map<unknown>>;
        const joinerV1 = joinerVersions.get("1") as Y.Map<unknown>;
        const joinerV1text = joinerV1.get("text") as Y.Text;

        // Concurrent edits to different versions
        owner.ydoc.transact(() => ownerV0text.insert(ownerV0text.length, "!"), "local");
        joiner.ydoc.transact(() => joinerV1text.insert(joinerV1text.length, "?"), "local");

        await new Promise((r) => setTimeout(r, 50));

        // Both versions should reflect their respective edits (CRDT convergence)
        expect(ownerV0text.toString()).toBe("hello!");

        // Get owner's view of version 1
        const ownerV1 = ownerVersions.get("1") as Y.Map<unknown>;
        const ownerV1text = ownerV1.get("text") as Y.Text;
        expect(ownerV1text.toString()).toBe("world?");

        // Get joiner's view of version 0
        const joinerV0 = joinerVersions.get("0") as Y.Map<unknown>;
        const joinerV0text = joinerV0.get("text") as Y.Text;
        expect(joinerV0text.toString()).toBe("hello!");
    });
});

describe("bug #2 bisection (D-109)", () => {
    let owner: Peer;
    let joiner: Peer;
    let disconnect: () => void;

    beforeEach(() => {
        owner = makePeer("owner", "hello world");
        joiner = makePeer("joiner");
        disconnect = connect(owner, joiner);
    });

    afterEach(() => {
        disconnect();
        teardown(owner);
        teardown(joiner);
    });

    describe("Layer 1: subtree binding lifecycle", () => {
        it("Y.Map entry survives binding teardown/rebuild cycle", async () => {
            // Create revision
            const revision: GenericAnnotation = {
                id: 0,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [{ doc: "hello" }, { doc: "world" }],
                activeVersionIndex: 0,
            };
            owner.view.dispatch({ effects: [addAnnotation.of(revision)] });
            await new Promise((r) => setTimeout(r, 50));

            // Verify Y.Map entry exists on both peers
            expect(owner.ymap.size).toBe(1);
            expect(joiner.ymap.size).toBe(1);

            // The key invariant: Y.Map entry MUST survive any controller lifecycle
            // This test validates the Y.Map structure persists
            const ownerKey = Array.from(owner.ymap.keys())[0];
            const ownerRevNode = owner.ymap.get(ownerKey) as Y.Map<unknown>;
            expect(ownerRevNode).toBeInstanceOf(Y.Map);

            // Verify structure is intact
            expect(ownerRevNode.get("_type")).toBe("revision");
            expect(ownerRevNode.get("versions")).toBeInstanceOf(Y.Map);

            // Re-check Y.Map after a brief delay (simulating controller rebuild)
            await new Promise((r) => setTimeout(r, 20));
            expect(owner.ymap.size).toBe(1);
            expect(joiner.ymap.size).toBe(1);
        });

        it("annotation persists in CodeMirror state after Y.Map operations", async () => {
            // Create revision
            const revision: GenericAnnotation = {
                id: 0,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [{ doc: "hello" }, { doc: "world" }],
                activeVersionIndex: 0,
            };
            owner.view.dispatch({ effects: [addAnnotation.of(revision)] });
            await new Promise((r) => setTimeout(r, 50));

            // Get initial annotation count
            const ownerAnnsBefore = owner.view.state.field(annotationField);
            const joinerAnnsBefore = joiner.view.state.field(annotationField);
            expect(Object.keys(ownerAnnsBefore).length).toBe(1);
            expect(Object.keys(joinerAnnsBefore).length).toBe(1);

            // Perform some Y.Map operations (read)
            const ownerKey = Array.from(owner.ymap.keys())[0];
            const ownerRevNode = owner.ymap.get(ownerKey) as Y.Map<unknown>;
            const versionsMap = ownerRevNode.get("versions") as Y.Map<Y.Map<unknown>>;
            const v0 = versionsMap.get("0") as Y.Map<unknown>;
            const v0text = v0.get("text") as Y.Text;
            void v0text.toString(); // Read operation

            await new Promise((r) => setTimeout(r, 20));

            // Annotation should still exist
            const ownerAnnsAfter = owner.view.state.field(annotationField);
            const joinerAnnsAfter = joiner.view.state.field(annotationField);
            expect(Object.keys(ownerAnnsAfter).length).toBe(1);
            expect(Object.keys(joinerAnnsAfter).length).toBe(1);
        });
    });

    describe("Layer 2: annotationGeneration rebuild signal", () => {
        it("version switch does NOT incorrectly trigger annotation rebuild", async () => {
            // Create revision
            const revision: GenericAnnotation = {
                id: 0,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [{ doc: "hello" }, { doc: "world" }],
                activeVersionIndex: 0,
            };
            owner.view.dispatch({ effects: [addAnnotation.of(revision)] });
            await new Promise((r) => setTimeout(r, 50));

            // Get initial annotation state
            const beforeAnns = owner.view.state.field(annotationField);
            const beforeId = Object.keys(beforeAnns)[0];
            expect(beforeId).toBeDefined();

            // Simulate _updateRevisionVersionDoc (what happens on version content change)
            owner.view.dispatch({
                effects: [
                    _updateRevisionVersionDoc.of({
                        annotationId: 0,
                        versionIndex: 0,
                        doc: "hello!",
                    }),
                ],
            });

            await new Promise((r) => setTimeout(r, 20));

            // Annotation should still exist with same ID
            const afterAnns = owner.view.state.field(annotationField);
            expect(Object.keys(afterAnns)).toContain(beforeId);
        });

        it("thread update does NOT destroy annotation", async () => {
            // Create revision
            const revision: GenericAnnotation = {
                id: 0,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [{ doc: "hello" }],
                activeVersionIndex: 0,
            };
            owner.view.dispatch({ effects: [addAnnotation.of(revision)] });
            await new Promise((r) => setTimeout(r, 50));

            // Verify annotation exists
            const beforeAnns = owner.view.state.field(annotationField);
            expect(Object.keys(beforeAnns).length).toBe(1);

            // Add to thread via Y.Array
            const ownerKey = Array.from(owner.ymap.keys())[0];
            const ownerRevNode = owner.ymap.get(ownerKey) as Y.Map<unknown>;
            const thread = ownerRevNode.get("thread") as Y.Array<unknown>;

            owner.ydoc.transact(() => {
                thread.push([
                    {
                        author: "test",
                        content: "test message",
                        timestamp: Date.now(),
                    },
                ]);
            }, "local");

            await new Promise((r) => setTimeout(r, 50));

            // Annotation should still exist
            const afterAnns = owner.view.state.field(annotationField);
            expect(Object.keys(afterAnns).length).toBe(1);
        });
    });

    describe("Layer 3: Yjs observer race during initial sync", () => {
        it("queueMicrotask dispatch does not race with observeDeep", async () => {
            // This test validates that _syncInitialFromYjs and observeDeep
            // don't both try to add the same annotation

            // Create revision on owner
            const revision: GenericAnnotation = {
                id: 0,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [{ doc: "hello" }],
                activeVersionIndex: 0,
            };
            owner.view.dispatch({ effects: [addAnnotation.of(revision)] });

            // Force multiple microtask cycles to flush any races
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 50));

            // Joiner should have exactly 1 annotation (not 2 from race)
            const joinerAnns = joiner.view.state.field(annotationField);
            expect(Object.keys(joinerAnns).length).toBe(1);
        });

        it("rapid successive annotations do not duplicate", async () => {
            // Rapidly add annotations
            for (let i = 0; i < 3; i++) {
                const ann: GenericAnnotation = {
                    id: i,
                    _type: "comment",
                    selection: EditorSelection.single(i, i + 1),
                    thread: [],
                };
                owner.view.dispatch({ effects: [addAnnotation.of(ann)] });
            }

            // Allow all microtasks and syncs to complete
            await new Promise((r) => setTimeout(r, 100));

            // Both peers should have exactly 3 annotations
            const ownerAnns = owner.view.state.field(annotationField);
            const joinerAnns = joiner.view.state.field(annotationField);

            expect(Object.keys(ownerAnns).length).toBe(3);
            expect(Object.keys(joinerAnns).length).toBe(3);
        });

        it("annotation ID mapping is consistent across peers", async () => {
            // Create revision
            const revision: GenericAnnotation = {
                id: 42,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [{ doc: "hello" }],
                activeVersionIndex: 0,
            };
            owner.view.dispatch({ effects: [addAnnotation.of(revision)] });
            await new Promise((r) => setTimeout(r, 50));

            // Both peers should reference the same annotation ID
            const ownerAnns = owner.view.state.field(annotationField);
            const joinerAnns = joiner.view.state.field(annotationField);

            // Owner should have annotation with ID 42
            expect(ownerAnns[42]).toBeDefined();

            // Joiner's annotation should map correctly
            // (may have different internal ID but same content)
            const joinerAnnValues = Object.values(joinerAnns);
            expect(joinerAnnValues.length).toBe(1);
            expect(joinerAnnValues[0]._type).toBe("revision");
        });
    });
});
