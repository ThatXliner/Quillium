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
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";

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
