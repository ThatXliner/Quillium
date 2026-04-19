/**
 * yjsAnnotations.test.ts -- Unit tests for annotation sync plugin.
 *
 * Tests bidirectional sync between Y.Map<YjsAnnotationNode> and CodeMirror annotationField.
 * Verifies origin tracking for feedback loop prevention.
 *
 * Per D-90/D-92: YjsAnnotationNode is a recursive Y.Map structure with Y.Array for
 * threads and Y.Map for versions. Tests must read values via .get() on Y types.
 *
 * Phase 10: Write path (CM -> Yjs) disabled. Tests for write path skipped.
 * Phase 11 will rebuild and re-enable these tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import { createAnnotationSyncPlugin, yjsAnnotationSync } from "./yjsAnnotations";
import {
    addAnnotation,
    removeAnnotation,
    updateThread,
    annotationField,
} from "$lib/editor/plugins/annotations/annotationField";
import type { YjsAnnotationNode, MessageObject } from "./types";
import {
    isAnnotationOfType,
    type GenericAnnotation,
} from "$lib/editor/plugins/annotations/models";

describe("yjsAnnotations", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let ymap: Y.Map<YjsAnnotationNode>;
    let view: EditorView;
    const clientId = "test-client";

    function createTestAnnotation(id: number, from: number, to: number): GenericAnnotation {
        return {
            id,
            _type: "comment",
            selection: EditorSelection.single(from, to),
            thread: [],
        };
    }

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

        // Seed document
        ydoc.transact(() => {
            ytext.insert(0, "hello world");
        }, "init");

        const state = EditorState.create({
            doc: "hello world",
            extensions: [annotationField, createAnnotationSyncPlugin(ytext, ymap, clientId)],
        });
        view = new EditorView({ state, parent: document.body });
    });

    afterEach(() => {
        view.destroy();
        ydoc.destroy();
    });

    describe("CodeMirror -> Y.Map sync", () => {
        // Phase 10: write path disabled — these tests are skipped until Phase 11 rebuilds it
        it.skip("propagates addAnnotation to Y.Map", () => {
            const annotation = createTestAnnotation(0, 0, 5);

            view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });

            expect(ymap.size).toBe(1);
            const yjsAnn = Array.from(ymap.values())[0];
            expect(yjsAnn.get("_type")).toBe("comment");
        });

        it.skip("propagates removeAnnotation to Y.Map", () => {
            // First add an annotation
            const annotation = createTestAnnotation(0, 0, 5);
            view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });
            expect(ymap.size).toBe(1);

            // Then remove it
            view.dispatch({
                effects: [removeAnnotation.of(annotation)],
            });
            expect(ymap.size).toBe(0);
        });

        it.skip("propagates updateThread to Y.Map via Y.Array.push", () => {
            // First add an annotation
            const annotation = createTestAnnotation(0, 0, 5);
            view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });

            // Update the thread
            view.dispatch({
                effects: [
                    updateThread.of({
                        annotationId: 0,
                        newThread: [{ message: "test", author: "user", time: Date.now() }],
                    }),
                ],
            });

            const yjsAnn = Array.from(ymap.values())[0];
            const threadArr = yjsAnn.get("thread") as Y.Array<MessageObject>;
            expect(threadArr instanceof Y.Array).toBe(true);
            expect(threadArr.length).toBe(1);
            expect(threadArr.get(0).message).toBe("test");
        });

        it("does not propagate Yjs-originated changes back to Y.Map", () => {
            // Simulate a Yjs-originated add (marked with yjsAnnotationSync)
            const annotation = createTestAnnotation(0, 0, 5);
            view.dispatch({
                effects: [addAnnotation.of(annotation)],
                annotations: [yjsAnnotationSync.of(true)],
            });

            // Y.Map should NOT have the annotation (it came from Y.Map originally)
            // This test verifies the feedback loop prevention
            expect(ymap.size).toBe(0);
        });
    });

    describe("Y.Map -> CodeMirror sync", () => {
        it("syncs existing Y.Map annotations on plugin mount", async () => {
            // Pre-seed ymap with an annotation BEFORE creating a new view
            const ydoc2 = new Y.Doc();
            const ytext2 = ydoc2.getText("document");
            const ymap2 = ydoc2.getMap<YjsAnnotationNode>("annotations");

            ydoc2.transact(() => {
                ytext2.insert(0, "hello world");
            }, "init");

            // Add annotation to Y.Map before mounting editor
            const node = new Y.Map<unknown>();
            ydoc2.transact(() => {
                node.set("id", "pre-existing-ann");
                node.set("_type", "comment");
                const startRel = Y.createRelativePositionFromTypeIndex(ytext2, 0);
                const endRel = Y.createRelativePositionFromTypeIndex(ytext2, 5);
                node.set("startPos", Y.encodeRelativePosition(startRel));
                node.set("endPos", Y.encodeRelativePosition(endRel));
                node.set("thread", new Y.Array<MessageObject>());
                node.set("annotations", new Y.Map<YjsAnnotationNode>());
                ymap2.set("pre-existing-ann", node as YjsAnnotationNode);
            }, "init");

            expect(ymap2.size).toBe(1);

            // Now mount editor with the sync plugin
            const state2 = EditorState.create({
                doc: "hello world",
                extensions: [annotationField, createAnnotationSyncPlugin(ytext2, ymap2, "joiner")],
            });
            const view2 = new EditorView({ state: state2, parent: document.body });

            // Initial sync uses queueMicrotask (CM doesn't allow dispatch during construction)
            await new Promise((r) => queueMicrotask(r));

            // The pre-existing annotation should now be in CodeMirror
            const annotations = view2.state.field(annotationField);
            expect(Object.keys(annotations).length).toBe(1);
            const ann = Object.values(annotations)[0];
            expect(isAnnotationOfType(ann, "comment")).toBe(true);

            view2.destroy();
            ydoc2.destroy();
        });

        // Phase 10: This test requires the write path to add the annotation first
        it.skip("removes CM annotation from remote Y.Map delete", () => {
            // First add locally
            const annotation = createTestAnnotation(0, 0, 5);
            view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });

            expect(Object.keys(view.state.field(annotationField)).length).toBe(1);

            // Get the Yjs ID that was created
            const yjsId = Array.from(ymap.keys())[0];

            // Simulate remote delete (non-local origin)
            ydoc.transact(() => {
                ymap.delete(yjsId);
            }, "remote");

            // Annotation should be removed from CM
            const annotations = view.state.field(annotationField);
            expect(Object.keys(annotations).length).toBe(0);
        });

        it("does not dispatch for local-origin Y.Map changes", () => {
            const dispatchSpy = vi.spyOn(view, "dispatch");

            // Build a properly structured YjsAnnotationNode for local origin
            const node = new Y.Map<unknown>();
            ydoc.transact(() => {
                node.set("id", "local-ann");
                node.set("_type", "comment");
                const startRel = Y.createRelativePositionFromTypeIndex(ytext, 0);
                const endRel = Y.createRelativePositionFromTypeIndex(ytext, 5);
                node.set("startPos", Y.encodeRelativePosition(startRel));
                node.set("endPos", Y.encodeRelativePosition(endRel));
                node.set("thread", new Y.Array<MessageObject>());
                node.set("annotations", new Y.Map<YjsAnnotationNode>());
                ymap.set("local-ann", node as YjsAnnotationNode);
            }, "local");

            // Should not trigger additional dispatch (observer skips local origin)
            expect(dispatchSpy).not.toHaveBeenCalled();
            dispatchSpy.mockRestore();
        });
    });

    describe("annotation types", () => {
        // Phase 10: write path disabled — these tests are skipped until Phase 11 rebuilds it
        it.skip("syncs comment annotations", () => {
            const annotation: GenericAnnotation = {
                id: 0,
                _type: "comment",
                selection: EditorSelection.single(0, 5),
                thread: [{ message: "test", author: "user", time: 123 }],
            };

            view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });

            const yjsAnn = Array.from(ymap.values())[0];
            expect(yjsAnn.get("_type")).toBe("comment");
            const threadArr = yjsAnn.get("thread") as Y.Array<MessageObject>;
            expect(threadArr.length).toBe(1);
        });

        it.skip("syncs suggestion annotations", () => {
            const annotation: GenericAnnotation = {
                id: 0,
                _type: "suggestion",
                selection: EditorSelection.single(0, 5),
                thread: [],
                replacements: [{ text: "replacement", rationale: "test" }],
                author: "ai",
            };

            view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });

            const yjsAnn = Array.from(ymap.values())[0];
            expect(yjsAnn.get("_type")).toBe("suggestion");
            expect(yjsAnn.get("author")).toBe("ai");
            const replacements = yjsAnn.get("replacements") as Y.Array<unknown>;
            expect(replacements instanceof Y.Array).toBe(true);
            expect(replacements.length).toBe(1);
            expect((replacements.get(0) as { text: string }).text).toBe("replacement");
        });

        it.skip("syncs revision annotations", () => {
            const annotation: GenericAnnotation = {
                id: 0,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [{ doc: "hello" }, { doc: "world" }],
                activeVersionIndex: 0,
            };

            view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });

            const yjsAnn = Array.from(ymap.values())[0];
            expect(yjsAnn.get("_type")).toBe("revision");
            expect(yjsAnn.get("activeVersionIndex")).toBe(0);
            const versions = yjsAnn.get("versions") as Y.Map<Y.Map<unknown>>;
            expect(versions instanceof Y.Map).toBe(true);
            expect(versions.size).toBe(2);
        });
    });
});

describe("revision sync", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let ymap: Y.Map<YjsAnnotationNode>;
    let view: EditorView;
    const clientId = "test-revision-client";

    function createRevisionAnnotation(
        id: number,
        from: number,
        to: number,
        versions: { doc: string }[],
        activeVersionIndex = 0,
    ): GenericAnnotation {
        return {
            id,
            _type: "revision",
            selection: EditorSelection.single(from, to),
            thread: [],
            versions,
            activeVersionIndex,
        };
    }

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

        ydoc.transact(() => {
            ytext.insert(0, "hello world");
        }, "init");

        const state = EditorState.create({
            doc: "hello world",
            extensions: [annotationField, createAnnotationSyncPlugin(ytext, ymap, clientId)],
        });
        view = new EditorView({ state, parent: document.body });
    });

    afterEach(() => {
        view.destroy();
        ydoc.destroy();
    });

    // Phase 10: write path disabled — these tests are skipped until Phase 11 rebuilds it
    it.skip("syncs activeVersionIndex change to Y.Map via remove+add", () => {
        const annotation = createRevisionAnnotation(
            0,
            0,
            5,
            [{ doc: "hello" }, { doc: "world" }],
            0,
        );

        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        const yjsId = Array.from(ymap.keys())[0];
        expect(ymap.get(yjsId)!.get("activeVersionIndex")).toBe(0);

        // Simulate what setActiveRevisionVersion does: it emits a doc change
        // plus internal effects. In tests we approximate via remove+add with
        // updated data (the same path that the CM->Yjs sync uses).
        const updatedAnnotation: GenericAnnotation = { ...annotation, activeVersionIndex: 1 };
        view.dispatch({
            effects: [removeAnnotation.of(annotation), addAnnotation.of(updatedAnnotation)],
        });

        // After remove+add, the entry lives under the new yjsId
        expect(ymap.size).toBe(1);
        const newYjsId = Array.from(ymap.keys())[0];
        const yjsAnn = ymap.get(newYjsId)!;
        expect(yjsAnn.get("activeVersionIndex")).toBe(1);
    });

    it.skip("syncs new version addition to Y.Map via remove+add", () => {
        const annotation = createRevisionAnnotation(0, 0, 5, [{ doc: "hello" }], 0);

        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        const yjsId = Array.from(ymap.keys())[0];
        const initialVersions = ymap.get(yjsId)!.get("versions") as Y.Map<Y.Map<unknown>>;
        expect(initialVersions.size).toBe(1);

        const updatedAnnotation: GenericAnnotation = {
            ...annotation,
            versions: [{ doc: "hello" }, { doc: "new version" }],
            activeVersionIndex: 1,
        };
        view.dispatch({
            effects: [removeAnnotation.of(annotation), addAnnotation.of(updatedAnnotation)],
        });

        // After remove+add, the entry lives under the new yjsId
        expect(ymap.size).toBe(1);
        const newYjsId = Array.from(ymap.keys())[0];
        const yjsAnn = ymap.get(newYjsId)!;
        const versions = yjsAnn.get("versions") as Y.Map<Y.Map<unknown>>;
        expect(versions.size).toBe(2);
        const v1 = versions.get("1") as Y.Map<unknown>;
        const v1Text = v1.get("text") as Y.Text;
        expect(v1Text.toString()).toBe("new version");
    });

    // Phase 10: This test requires write path to add the initial annotation
    it.skip("receives remote activeVersionIndex change via shallow Y.Map update", () => {
        const annotation = createRevisionAnnotation(
            0,
            0,
            5,
            [{ doc: "hello" }, { doc: "world" }],
            0,
        );

        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        const yjsId = Array.from(ymap.keys())[0];
        const existing = ymap.get(yjsId)!;

        // Simulate remote version switch by updating the activeVersionIndex field
        // This is a shallow Y.Map key update that observeDeep detects
        ydoc.transact(() => {
            existing.set("activeVersionIndex", 1);
        }, "remote");

        const annotations = view.state.field(annotationField);
        const updated = annotations[0];
        if (isAnnotationOfType(updated, "revision")) {
            expect(updated.activeVersionIndex).toBe(1);
        } else {
            throw new Error("Expected revision annotation");
        }
    });
});

describe("thread sync", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let ymap: Y.Map<YjsAnnotationNode>;
    let view: EditorView;
    const clientId = "test-thread-client";

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

        ydoc.transact(() => {
            ytext.insert(0, "hello world");
        }, "init");

        const state = EditorState.create({
            doc: "hello world",
            extensions: [annotationField, createAnnotationSyncPlugin(ytext, ymap, clientId)],
        });
        view = new EditorView({ state, parent: document.body });
    });

    afterEach(() => {
        view.destroy();
        ydoc.destroy();
    });

    // Phase 10: This test requires write path to add the initial annotation
    it.skip("receives remote thread reply via Y.Array.push", () => {
        const annotation: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: EditorSelection.single(0, 5),
            thread: [{ message: "initial", author: "user1", time: 100 }],
        };

        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        const yjsId = Array.from(ymap.keys())[0];
        const existing = ymap.get(yjsId)!;
        const threadArr = existing.get("thread") as Y.Array<MessageObject>;

        // Simulate remote thread reply from a peer via Y.Array.push (D-93)
        ydoc.transact(() => {
            threadArr.push([{ message: "reply", author: "user2", time: 200 }]);
        }, "remote");

        const annotations = view.state.field(annotationField);
        const updated = annotations[0];
        expect(updated.thread).toHaveLength(2);
        expect(updated.thread[1].message).toBe("reply");
        expect(updated.thread[1].author).toBe("user2");
    });

    // Phase 10: write path disabled — this test is skipped until Phase 11 rebuilds it
    it.skip("syncs local thread update to Y.Map via Y.Array.push", () => {
        const annotation: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: EditorSelection.single(0, 5),
            thread: [],
        };

        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        const yjsId = Array.from(ymap.keys())[0];

        view.dispatch({
            effects: [
                updateThread.of({
                    annotationId: 0,
                    newThread: [{ message: "hello", author: "me", time: 123 }],
                }),
            ],
        });

        const yjsAnn = ymap.get(yjsId)!;
        const threadArr = yjsAnn.get("thread") as Y.Array<MessageObject>;
        expect(threadArr.length).toBe(1);
        expect(threadArr.get(0).message).toBe("hello");
    });
});

describe("suggestion sync", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let ymap: Y.Map<YjsAnnotationNode>;
    let view: EditorView;
    const clientId = "test-suggestion-client";

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

        ydoc.transact(() => {
            ytext.insert(0, "hello world");
        }, "init");

        const state = EditorState.create({
            doc: "hello world",
            extensions: [annotationField, createAnnotationSyncPlugin(ytext, ymap, clientId)],
        });
        view = new EditorView({ state, parent: document.body });
    });

    afterEach(() => {
        view.destroy();
        ydoc.destroy();
    });

    // Phase 10: write path disabled — this test is skipped until Phase 11 rebuilds it
    it.skip("syncs suggestion acceptance state (removal)", () => {
        const annotation: GenericAnnotation = {
            id: 0,
            _type: "suggestion",
            selection: EditorSelection.single(0, 5),
            thread: [],
            replacements: [{ text: "replacement" }],
        };

        view.dispatch({ effects: [addAnnotation.of(annotation)] });
        expect(ymap.size).toBe(1);

        // Applying a suggestion removes it from the annotation field
        view.dispatch({ effects: [removeAnnotation.of(annotation)] });
        expect(ymap.size).toBe(0);
    });
});
