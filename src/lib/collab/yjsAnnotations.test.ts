/**
 * yjsAnnotations.test.ts -- Unit tests for annotation sync plugin.
 *
 * Tests bidirectional sync between Y.Map<YjsAnnotation> and CodeMirror annotationField.
 * Verifies origin tracking for feedback loop prevention.
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
import type { YjsAnnotation } from "./types";
import {
    isAnnotationOfType,
    type GenericAnnotation,
} from "$lib/editor/plugins/annotations/models";

describe("yjsAnnotations", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let ymap: Y.Map<YjsAnnotation>;
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
        ymap = ydoc.getMap("annotations");

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
        it("propagates addAnnotation to Y.Map", () => {
            const annotation = createTestAnnotation(0, 0, 5);

            view.dispatch({
                effects: [addAnnotation.of(annotation)],
            });

            expect(ymap.size).toBe(1);
            const yjsAnn = Array.from(ymap.values())[0];
            expect(yjsAnn._type).toBe("comment");
        });

        it("propagates removeAnnotation to Y.Map", () => {
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

        it("propagates updateThread to Y.Map", () => {
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
            const thread = JSON.parse(yjsAnn.thread);
            expect(thread).toHaveLength(1);
            expect(thread[0].message).toBe("test");
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
        it("removes CM annotation from remote Y.Map delete", () => {
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

            // Local Y.Map change (origin === "local")
            ydoc.transact(() => {
                ymap.set("local-ann", {
                    id: "local-ann",
                    _type: "comment",
                    startPos: new Uint8Array([]),
                    endPos: new Uint8Array([]),
                    thread: "[]",
                });
            }, "local");

            // Should not trigger additional dispatch (observer skips local origin)
            expect(dispatchSpy).not.toHaveBeenCalled();
            dispatchSpy.mockRestore();
        });
    });

    describe("annotation types", () => {
        it("syncs comment annotations", () => {
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
            expect(yjsAnn._type).toBe("comment");
            expect(JSON.parse(yjsAnn.thread)).toHaveLength(1);
        });

        it("syncs suggestion annotations", () => {
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
            expect(yjsAnn._type).toBe("suggestion");
            expect(yjsAnn.author).toBe("ai");
            const replacements = JSON.parse(yjsAnn.replacements!);
            expect(replacements).toHaveLength(1);
            expect(replacements[0].text).toBe("replacement");
        });

        it("syncs revision annotations", () => {
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
            expect(yjsAnn._type).toBe("revision");
            expect(yjsAnn.activeVersionIndex).toBe(0);
            const versions = JSON.parse(yjsAnn.versions!);
            expect(versions).toHaveLength(2);
        });
    });
});

// ── Shared setup helpers used by the describe blocks below ──────────────────
// These run in the same jsdom environment as the outer describe block above.

describe("revision sync", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let ymap: Y.Map<YjsAnnotation>;
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
        ymap = ydoc.getMap("annotations");

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

    it("syncs activeVersionIndex change to Y.Map via remove+add", () => {
        const annotation = createRevisionAnnotation(0, 0, 5, [
            { doc: "hello" },
            { doc: "world" },
        ], 0);

        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        const yjsId = Array.from(ymap.keys())[0];
        expect(ymap.get(yjsId)!.activeVersionIndex).toBe(0);

        // Simulate what setActiveRevisionVersion does: it emits a doc change
        // plus internal effects. In tests we approximate via remove+add with
        // updated data (the same path that the CM->Yjs sync uses).
        // Note: removeAnnotation deletes the old yjsId; addAnnotation creates a new one.
        const updatedAnnotation: GenericAnnotation = { ...annotation, activeVersionIndex: 1 };
        view.dispatch({
            effects: [removeAnnotation.of(annotation), addAnnotation.of(updatedAnnotation)],
        });

        // After remove+add, the entry lives under the new yjsId
        expect(ymap.size).toBe(1);
        const newYjsId = Array.from(ymap.keys())[0];
        const yjsAnn = ymap.get(newYjsId)!;
        expect(yjsAnn.activeVersionIndex).toBe(1);
    });

    it("syncs new version addition to Y.Map via remove+add", () => {
        const annotation = createRevisionAnnotation(0, 0, 5, [{ doc: "hello" }], 0);

        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        const yjsId = Array.from(ymap.keys())[0];
        const initialVersions = JSON.parse(ymap.get(yjsId)!.versions!);
        expect(initialVersions).toHaveLength(1);

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
        const versions = JSON.parse(yjsAnn.versions!);
        expect(versions).toHaveLength(2);
        expect(versions[1].doc).toBe("new version");
    });

    it("receives remote activeVersionIndex change", () => {
        const annotation = createRevisionAnnotation(0, 0, 5, [
            { doc: "hello" },
            { doc: "world" },
        ], 0);

        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        const yjsId = Array.from(ymap.keys())[0];
        const existing = ymap.get(yjsId)!;

        // Simulate remote version switch from a peer
        ydoc.transact(() => {
            ymap.set(yjsId, {
                ...existing,
                activeVersionIndex: 1,
            });
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
    let ymap: Y.Map<YjsAnnotation>;
    let view: EditorView;
    const clientId = "test-thread-client";

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        ymap = ydoc.getMap("annotations");

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

    it("receives remote thread reply", () => {
        const annotation: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: EditorSelection.single(0, 5),
            thread: [{ message: "initial", author: "user1", time: 100 }],
        };

        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        const yjsId = Array.from(ymap.keys())[0];
        const existing = ymap.get(yjsId)!;

        // Simulate remote thread reply from a peer
        const updatedThread = [
            { message: "initial", author: "user1", time: 100 },
            { message: "reply", author: "user2", time: 200 },
        ];

        ydoc.transact(() => {
            ymap.set(yjsId, {
                ...existing,
                thread: JSON.stringify(updatedThread),
            });
        }, "remote");

        const annotations = view.state.field(annotationField);
        const updated = annotations[0];
        expect(updated.thread).toHaveLength(2);
        expect(updated.thread[1].message).toBe("reply");
        expect(updated.thread[1].author).toBe("user2");
    });

    it("syncs local thread update to Y.Map", () => {
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
        const thread = JSON.parse(yjsAnn.thread);
        expect(thread).toHaveLength(1);
        expect(thread[0].message).toBe("hello");
    });
});

describe("suggestion sync", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let ymap: Y.Map<YjsAnnotation>;
    let view: EditorView;
    const clientId = "test-suggestion-client";

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        ymap = ydoc.getMap("annotations");

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

    it("syncs suggestion acceptance state (removal)", () => {
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
