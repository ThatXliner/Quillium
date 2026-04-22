/**
 * annotation-sync.test.ts -- Phase 11 integration tests for annotation sync.
 *
 * Success criteria from ROADMAP.md:
 * 1. Annotations Y.Map entries mirror GenericAnnotation shape
 * 2. createAnnotationSyncPlugin writes via single diff-and-reconcile
 * 3. observeDeep drives single rebuild path
 * 4. Revision version text merges character-by-character
 * 5. activeVersionIndex syncs between peers
 * 6. Add/delete version, thread append round-trip
 * 7. Joiner sees owner's pre-existing annotations on initial sync
 *
 * Wave 0 scaffolds - tests filled in as write path is implemented.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorSelection } from "@codemirror/state";
import {
    makePeerWithAnnotationSync,
    connect,
    flushAll,
    teardown,
    type Peer,
} from "./test-helpers/twoPeerHarness";
import {
    annotationField,
    addAnnotation,
    removeAnnotation,
    updateThread,
    updateRevisionVersionState,
    setActiveRevisionVersion,
    createNewRevision as createNewRevisionTx,
    deleteRevisionVersion,
    nestedEditorEdit,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    isAnnotationOfType,
    type GenericAnnotation,
    type RawAnnotations,
    type VersionState,
} from "$lib/editor/plugins/annotations/models";

function createComment(id: number, from: number, to: number): GenericAnnotation {
    return {
        id,
        _type: "comment",
        selection: EditorSelection.single(from, to),
        thread: [],
    };
}

function createRevision(id: number, from: number, to: number, doc: string): GenericAnnotation {
    return {
        id,
        _type: "revision",
        selection: EditorSelection.single(from, to),
        thread: [],
        versions: [{ doc }],
        activeVersionIndex: 0,
    };
}

function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(() => resolve()));
}

describe("annotation sync (Phase 11)", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: () => void;

    beforeEach(() => {
        peerA = makePeerWithAnnotationSync("peer-a", "hello world");
        peerB = makePeerWithAnnotationSync("peer-b");
        disconnect = connect(peerA, peerB);
    });

    afterEach(() => {
        disconnect();
        teardown(peerA);
        teardown(peerB);
    });

    describe("comment sync", () => {
        it("owner creates comment, joiner sees it", async () => {
            // Owner creates a comment on "world" (positions 6-11)
            const comment = createComment(1, 6, 11);
            peerA.view.dispatch({
                effects: addAnnotation.of(comment),
            });

            // Allow microtask queue to flush for sync
            await flushMicrotasks();

            // Joiner should see the comment
            const annB = peerB.view.state.field(annotationField);
            const keys = Object.keys(annB);
            expect(keys.length).toBe(1);

            const syncedAnn = Object.values(annB)[0];
            expect(isAnnotationOfType(syncedAnn, "comment")).toBe(true);
            expect(syncedAnn.selection.main.from).toBe(6);
            expect(syncedAnn.selection.main.to).toBe(11);
        });

        it("joiner creates comment, owner sees it", async () => {
            // Joiner creates a comment on "hello" (positions 0-5)
            const comment = createComment(1, 0, 5);
            peerB.view.dispatch({
                effects: addAnnotation.of(comment),
            });

            await flushMicrotasks();

            // Owner should see the comment
            const annA = peerA.view.state.field(annotationField);
            const keys = Object.keys(annA);
            expect(keys.length).toBe(1);

            const syncedAnn = Object.values(annA)[0];
            expect(isAnnotationOfType(syncedAnn, "comment")).toBe(true);
            expect(syncedAnn.selection.main.from).toBe(0);
            expect(syncedAnn.selection.main.to).toBe(5);
        });

        it("comment deletion syncs between peers", async () => {
            // Owner creates a comment
            const comment = createComment(1, 0, 5);
            peerA.view.dispatch({
                effects: addAnnotation.of(comment),
            });

            await flushMicrotasks();

            // Verify joiner has it
            let annB = peerB.view.state.field(annotationField);
            expect(Object.keys(annB).length).toBe(1);

            // Owner deletes the comment
            const annA = peerA.view.state.field(annotationField);
            const toDelete = Object.values(annA)[0];
            peerA.view.dispatch({
                effects: removeAnnotation.of(toDelete),
            });

            await flushMicrotasks();

            // Joiner should see deletion
            annB = peerB.view.state.field(annotationField);
            expect(Object.keys(annB).length).toBe(0);
        });
    });

    describe("revision sync", () => {
        it("owner creates revision, joiner sees it with version text", async () => {
            // Owner creates a revision on "world" with version text
            const revision = createRevision(1, 6, 11, "world");
            peerA.view.dispatch({
                effects: addAnnotation.of(revision),
            });

            await flushMicrotasks();

            // Joiner should see the revision with version
            const annB = peerB.view.state.field(annotationField);
            const keys = Object.keys(annB);
            expect(keys.length).toBe(1);

            const syncedAnn = Object.values(annB)[0];
            expect(isAnnotationOfType(syncedAnn, "revision")).toBe(true);
            if (isAnnotationOfType(syncedAnn, "revision")) {
                expect(syncedAnn.versions.length).toBeGreaterThanOrEqual(1);
                expect(syncedAnn.versions[0].doc).toBe("world");
                expect(syncedAnn.activeVersionIndex).toBe(0);
            }
        });

        it("version text update syncs between peers", async () => {
            // Owner creates a revision
            const revision = createRevision(1, 6, 11, "world");
            peerA.view.dispatch({
                effects: addAnnotation.of(revision),
            });

            await flushMicrotasks();

            // Get annotation ID on owner
            const annA = peerA.view.state.field(annotationField);
            const annIdA = Number(Object.keys(annA)[0]);

            // Owner updates version text
            const trA = updateRevisionVersionState(peerA.view.state, annIdA, 0, {
                doc: "modified world",
            });
            peerA.view.dispatch(trA);

            await flushMicrotasks();

            // Joiner should see the updated text
            const annB = peerB.view.state.field(annotationField);
            const revB = Object.values(annB)[0];

            if (isAnnotationOfType(revB, "revision")) {
                expect(revB.versions[0].doc).toBe("modified world");
            } else {
                expect.fail("Expected revision annotation");
            }
        });

        it("nested annotations inside revision versions sync between peers", async () => {
            const revision = createRevision(1, 6, 11, "world");
            peerA.view.dispatch({
                effects: addAnnotation.of(revision),
            });
            await flushAll(peerA, peerB);

            const annIdA = Number(Object.keys(peerA.view.state.field(annotationField))[0]);
            const nestedAnnotations: RawAnnotations = {
                "0": {
                    id: 0,
                    _type: "comment",
                    selection: EditorSelection.single(0, 5).toJSON(),
                    thread: [],
                },
            };
            const nestedVersion = {
                doc: "world",
                annotationField: nestedAnnotations,
            } as VersionState & { annotationField: RawAnnotations };

            peerA.view.dispatch(
                updateRevisionVersionState(peerA.view.state, annIdA, 0, nestedVersion),
            );
            await flushAll(peerA, peerB);

            const revB = Object.values(peerB.view.state.field(annotationField))[0];
            if (!isAnnotationOfType(revB, "revision")) {
                expect.fail("Expected revision annotation");
                return;
            }

            const nestedField = (
                revB.versions[0] as VersionState & { annotationField?: RawAnnotations }
            ).annotationField;
            expect(nestedField?.["0"]?._type).toBe("comment");
            expect(nestedField?.["0"]?.selection).toEqual(
                EditorSelection.single(0, 5).toJSON(),
            );
        });

        it("nested editor typing syncs character-by-character", async () => {
            // Owner creates a revision on "world" (positions 6-11)
            const revision = createRevision(1, 6, 11, "world");
            peerA.view.dispatch({
                effects: addAnnotation.of(revision),
            });

            await flushMicrotasks();

            const annIdA = Number(Object.keys(peerA.view.state.field(annotationField))[0]);

            // Simulate nested editor typing by dispatching with nestedEditorEdit annotation
            // This mimics what translateAndDispatch does when typing in the nested editor
            const annA = peerA.view.state.field(annotationField)[annIdA];
            if (!isAnnotationOfType(annA, "revision")) throw new Error("Expected revision");

            const from = annA.selection.main.from;
            peerA.view.dispatch({
                changes: { from: from, to: from + 5, insert: "hello" },
                annotations: [nestedEditorEdit.of(annIdA)],
            });

            await flushMicrotasks();

            // Joiner should see the updated text
            const annB = peerB.view.state.field(annotationField);
            const revB = Object.values(annB)[0];

            if (isAnnotationOfType(revB, "revision")) {
                expect(revB.versions[0].doc).toBe("hello");
            } else {
                expect.fail("Expected revision annotation");
            }
        });

        it("activeVersionIndex switch on owner propagates to joiner", async () => {
            // Owner creates revision with initial version
            const revision = createRevision(1, 6, 11, "version0");
            peerA.view.dispatch({
                effects: addAnnotation.of(revision),
            });

            await flushMicrotasks();

            // Get annotation ID
            const annA = peerA.view.state.field(annotationField);
            const annIdA = Number(Object.keys(annA)[0]);

            // Owner adds a second version
            const addTr = createNewRevisionTx(peerA.view.state, annIdA);
            peerA.view.dispatch(addTr);

            await flushMicrotasks();

            // Verify both peers have 2 versions
            let revA = Object.values(peerA.view.state.field(annotationField))[0];
            let revB = Object.values(peerB.view.state.field(annotationField))[0];

            if (!isAnnotationOfType(revA, "revision") || !isAnnotationOfType(revB, "revision")) {
                expect.fail("Expected revision annotations");
                return;
            }

            expect(revA.versions.length).toBe(2);
            expect(revB.versions.length).toBe(2);
            expect(revA.activeVersionIndex).toBe(1); // createNewRevision switches to new version
            expect(revB.activeVersionIndex).toBe(1);

            // Owner switches back to version 0
            const switchTr = setActiveRevisionVersion(peerA.view.state, annIdA, 0);
            peerA.view.dispatch(switchTr);

            await flushMicrotasks();

            // Joiner should see the switch
            revA = Object.values(peerA.view.state.field(annotationField))[0] as typeof revA;
            revB = Object.values(peerB.view.state.field(annotationField))[0] as typeof revB;

            expect(revA.activeVersionIndex).toBe(0);
            expect(revB.activeVersionIndex).toBe(0);
        });

        it("activeVersionIndex switch on joiner preserves revision annotation", async () => {
            const revision: GenericAnnotation = {
                id: 1,
                _type: "revision",
                selection: EditorSelection.single(6, 11),
                thread: [],
                versions: [{ doc: "world" }, { doc: "earth" }],
                activeVersionIndex: 0,
            };
            peerA.view.dispatch({
                effects: addAnnotation.of(revision),
            });
            await flushAll(peerA, peerB);

            const annIdB = Number(Object.keys(peerB.view.state.field(annotationField))[0]);
            peerB.view.dispatch(setActiveRevisionVersion(peerB.view.state, annIdB, 1));
            await flushAll(peerA, peerB);
            await Promise.resolve();

            const annA = Object.values(peerA.view.state.field(annotationField));
            const annB = Object.values(peerB.view.state.field(annotationField));
            expect(annA).toHaveLength(1);
            expect(annB).toHaveLength(1);

            const revA = annA[0];
            const revB = annB[0];
            if (!isAnnotationOfType(revA, "revision") || !isAnnotationOfType(revB, "revision")) {
                expect.fail("Expected revision annotations");
                return;
            }
            expect(revA.activeVersionIndex).toBe(1);
            expect(revB.activeVersionIndex).toBe(1);
            expect(peerA.view.state.doc.toString()).toBe("hello earth");
            expect(peerB.view.state.doc.toString()).toBe("hello earth");
        });

        it("add version on owner propagates to joiner", async () => {
            // Owner creates revision with initial version
            const revision = createRevision(1, 6, 11, "v0");
            peerA.view.dispatch({
                effects: addAnnotation.of(revision),
            });

            await flushMicrotasks();

            const annIdA = Number(Object.keys(peerA.view.state.field(annotationField))[0]);

            // Owner adds a new version
            const addTr = createNewRevisionTx(peerA.view.state, annIdA);
            peerA.view.dispatch(addTr);

            await flushMicrotasks();

            // Joiner should see the new version
            const revB = Object.values(peerB.view.state.field(annotationField))[0];

            if (isAnnotationOfType(revB, "revision")) {
                expect(revB.versions.length).toBe(2);
            } else {
                expect.fail("Expected revision annotation");
            }
        });

        it("delete version on owner propagates to joiner", async () => {
            // Owner creates revision and adds a second version
            const revision = createRevision(1, 6, 11, "v0");
            peerA.view.dispatch({
                effects: addAnnotation.of(revision),
            });

            await flushMicrotasks();

            const annIdA = Number(Object.keys(peerA.view.state.field(annotationField))[0]);

            // Add second version
            const addTr = createNewRevisionTx(peerA.view.state, annIdA);
            peerA.view.dispatch(addTr);

            await flushMicrotasks();

            // Verify both have 2 versions
            let revB = Object.values(peerB.view.state.field(annotationField))[0];
            if (!isAnnotationOfType(revB, "revision")) {
                expect.fail("Expected revision");
                return;
            }
            expect(revB.versions.length).toBe(2);

            // Owner deletes version 1 (the new one)
            const delTr = deleteRevisionVersion(peerA.view.state, annIdA, 1);
            peerA.view.dispatch(delTr);

            await flushMicrotasks();

            // Joiner should see the deletion
            revB = Object.values(peerB.view.state.field(annotationField))[0];

            if (isAnnotationOfType(revB, "revision")) {
                expect(revB.versions.length).toBe(1);
            } else {
                expect.fail("Expected revision annotation");
            }
        });

        it("remote rebuild preserves version text (#12-01)", async () => {
            // Regression test: remote annotation rebuild should preserve versions[].doc.
            // Bug: Phase 3 (pushDocToVersionState) was running on remote syncs,
            // pulling the main doc slice into versions[activeVersionIndex].doc.
            // Fix: addAnnotation now adds to revisionsWithExplicitEffect so
            // Phase 3 skips rebuilds from remote sync.

            // Owner creates revision - "world" at positions 6-11
            const revision = createRevision(1, 6, 11, "world");
            peerA.view.dispatch({
                effects: addAnnotation.of(revision),
            });

            await flushMicrotasks();

            // Joiner should have exact same version text from Yjs
            const revB = Object.values(peerB.view.state.field(annotationField))[0];
            if (!isAnnotationOfType(revB, "revision")) {
                expect.fail("Expected revision");
                return;
            }

            // This is the key assertion: the version doc should match what was
            // sent, not be corrupted by Phase 3 pulling from main doc
            expect(revB.versions[0].doc).toBe("world");
        });
    });

    describe("thread sync", () => {
        it("thread append from owner appears on joiner", async () => {
            // Owner creates a comment
            const comment = createComment(1, 0, 5);
            peerA.view.dispatch({
                effects: addAnnotation.of(comment),
            });

            await flushMicrotasks();

            // Get annotation ID on owner
            const annA = peerA.view.state.field(annotationField);
            const annIdA = Number(Object.keys(annA)[0]);

            // Owner adds a thread message
            peerA.view.dispatch({
                effects: updateThread.of({
                    annotationId: annIdA,
                    newThread: [{ message: "First message", author: "Owner", time: Date.now() }],
                }),
            });

            await flushMicrotasks();

            // Joiner should see the thread message
            const annB = peerB.view.state.field(annotationField);
            const syncedAnn = Object.values(annB)[0];

            expect(syncedAnn.thread.length).toBe(1);
            expect(syncedAnn.thread[0].message).toBe("First message");
            expect(syncedAnn.thread[0].author).toBe("Owner");
        });

        it("sequential thread appends from both peers survive", async () => {
            // Owner creates a comment
            const comment = createComment(1, 0, 5);
            peerA.view.dispatch({
                effects: addAnnotation.of(comment),
            });

            await flushMicrotasks();

            // Get annotation IDs
            const annIdA = Number(Object.keys(peerA.view.state.field(annotationField))[0]);

            // Owner adds first message
            const timeA = Date.now();
            peerA.view.dispatch({
                effects: updateThread.of({
                    annotationId: annIdA,
                    newThread: [{ message: "From owner", author: "Owner", time: timeA }],
                }),
            });

            await flushMicrotasks();

            // Joiner should now have owner's message
            const annB = peerB.view.state.field(annotationField);
            const annIdB = Number(Object.keys(annB)[0]);
            expect(Object.values(annB)[0].thread.length).toBe(1);

            // Joiner adds second message (appending to the synced thread)
            const timeB = timeA + 1;
            peerB.view.dispatch({
                effects: updateThread.of({
                    annotationId: annIdB,
                    newThread: [
                        { message: "From owner", author: "Owner", time: timeA },
                        { message: "From joiner", author: "Joiner", time: timeB },
                    ],
                }),
            });

            await flushMicrotasks();

            // Both should have both messages
            const finalA = Object.values(peerA.view.state.field(annotationField))[0];
            const finalB = Object.values(peerB.view.state.field(annotationField))[0];

            // Both peers should have 2 messages
            expect(finalA.thread.length).toBe(2);
            expect(finalB.thread.length).toBe(2);

            // Both messages should be present on both peers
            const messagesA = finalA.thread.map((t) => t.message).sort();
            const messagesB = finalB.thread.map((t) => t.message).sort();

            expect(messagesA).toEqual(["From joiner", "From owner"]);
            expect(messagesB).toEqual(["From joiner", "From owner"]);
        });
    });

    describe("initial sync", () => {
        it("joiner sees owner pre-existing annotations on connect", async () => {
            // Create owner with pre-existing comment BEFORE connecting
            teardown(peerA);
            teardown(peerB);
            disconnect();

            // Create owner with initial text and comment
            peerA = makePeerWithAnnotationSync("peer-a", "hello world");
            const comment = createComment(1, 0, 5);
            peerA.view.dispatch({
                effects: addAnnotation.of(comment),
            });

            // Allow owner's sync to Yjs
            await flushMicrotasks();

            // Now create joiner and connect
            peerB = makePeerWithAnnotationSync("peer-b");
            disconnect = connect(peerA, peerB);

            // Allow initial sync
            await flushMicrotasks();

            // Joiner should see owner's pre-existing annotation
            const annB = peerB.view.state.field(annotationField);
            expect(Object.keys(annB).length).toBe(1);

            const syncedAnn = Object.values(annB)[0];
            expect(isAnnotationOfType(syncedAnn, "comment")).toBe(true);
        });

        it("owner sees joiner pre-existing annotations on connect", async () => {
            // Note: This is an edge case - normally joiner doesn't have pre-existing.
            // But if they do (e.g., reconnect scenario), owner should see them.
            teardown(peerA);
            teardown(peerB);
            disconnect();

            // Create both peers with their own annotations
            peerA = makePeerWithAnnotationSync("peer-a", "hello world");
            peerB = makePeerWithAnnotationSync("peer-b", "hello world");

            // Each creates their own comment
            peerA.view.dispatch({
                effects: addAnnotation.of(createComment(1, 0, 5)),
            });
            peerB.view.dispatch({
                effects: addAnnotation.of(createComment(2, 6, 11)),
            });

            await flushMicrotasks();

            // Now connect
            disconnect = connect(peerA, peerB);

            await flushMicrotasks();

            // Both should have both annotations
            const annA = peerA.view.state.field(annotationField);
            const annB = peerB.view.state.field(annotationField);

            expect(Object.keys(annA).length).toBe(2);
            expect(Object.keys(annB).length).toBe(2);
        });
    });
});
