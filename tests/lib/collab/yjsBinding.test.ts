/**
 * yjsBinding.test.ts -- Tests for Y.Text <-> CodeMirror binding.
 *
 * Tests bidirectional sync between Y.Text shared type and CodeMirror EditorState.
 * Verifies origin tracking for UndoManager compatibility (D-74).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import { createYjsBinding, yjsAnnotation } from "$lib/collab/yjsBinding";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";

describe("yjsBinding", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let view: EditorView;

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        const state = EditorState.create({ doc: "", extensions: [createYjsBinding(ytext)] });
        view = new EditorView({ state, parent: document.body });
    });

    afterEach(() => {
        view.destroy();
        ydoc.destroy();
    });

    describe("CodeMirror -> Y.Text (local changes)", () => {
        it("propagates local insert to Y.Text", () => {
            view.dispatch({ changes: { from: 0, insert: "hello" } });
            expect(ytext.toString()).toBe("hello");
        });

        it("propagates local delete to Y.Text", () => {
            // Setup: insert content first
            view.dispatch({ changes: { from: 0, insert: "hello" } });
            expect(ytext.toString()).toBe("hello");

            // Delete first two characters
            view.dispatch({ changes: { from: 0, to: 2, insert: "" } });
            expect(ytext.toString()).toBe("llo");
        });

        it("propagates local replace to Y.Text", () => {
            view.dispatch({ changes: { from: 0, insert: "hello" } });
            view.dispatch({ changes: { from: 1, to: 4, insert: "XY" } });
            expect(ytext.toString()).toBe("hXYo");
        });

        it("uses 'local' origin for local changes", () => {
            let capturedOrigin: unknown;
            ydoc.on("update", (_update: Uint8Array, origin: unknown) => {
                capturedOrigin = origin;
            });

            view.dispatch({ changes: { from: 0, insert: "test" } });
            expect(capturedOrigin).toBe("local");
        });
    });

    describe("Y.Text -> CodeMirror (remote changes)", () => {
        it("propagates remote insert to CodeMirror", () => {
            // Simulate remote change (non-local origin)
            ydoc.transact(() => {
                ytext.insert(0, "remote");
            }, "remote-client");

            expect(view.state.doc.toString()).toBe("remote");
        });

        it("propagates remote delete to CodeMirror", () => {
            // Setup: insert content via CodeMirror
            view.dispatch({ changes: { from: 0, insert: "hello" } });

            // Remote delete (non-local origin)
            ydoc.transact(() => {
                ytext.delete(0, 2);
            }, "remote-client");

            expect(view.state.doc.toString()).toBe("llo");
        });

        it("propagates remote replace to CodeMirror", () => {
            view.dispatch({ changes: { from: 0, insert: "hello" } });

            ydoc.transact(() => {
                ytext.delete(1, 3);
                ytext.insert(1, "XY");
            }, "remote-client");

            expect(view.state.doc.toString()).toBe("hXYo");
        });

        it("marks Y.Text-originated transactions with yjsAnnotation", () => {
            let hasAnnotation = false;
            const updateListener = EditorView.updateListener.of((update) => {
                if (update.transactions.some((tr) => tr.annotation(yjsAnnotation))) {
                    hasAnnotation = true;
                }
            });

            // Reconfigure view with update listener
            view.dispatch({
                effects: StateEffect.reconfigure.of([createYjsBinding(ytext), updateListener]),
            });

            // Trigger remote change
            ydoc.transact(() => {
                ytext.insert(0, "x");
            }, "remote");

            expect(hasAnnotation).toBe(true);
        });

        it("hydrates CodeMirror from existing Y.Text when binding mounts after remote content arrives", async () => {
            view.destroy();
            ydoc.destroy();

            ydoc = new Y.Doc();
            ytext = ydoc.getText("document");
            ydoc.transact(() => {
                ytext.insert(0, "owner seeded text");
            }, "remote-before-bind");

            view = new EditorView({
                state: EditorState.create({
                    doc: "",
                    extensions: [createYjsBinding(ytext)],
                }),
                parent: document.body,
            });

            await Promise.resolve();

            expect(view.state.doc.toString()).toBe("owner seeded text");
            expect(ytext.toString()).toBe("owner seeded text");
        });

        it("skips Y.Text changes with 'local' origin (prevents feedback loop)", () => {
            // Changes with origin "local" are from CodeMirror, should be skipped by observer
            // This prevents infinite loops: CM -> Y.Text -> CM -> ...
            const dispatchSpy = vi.spyOn(view, "dispatch");
            const initialDispatchCount = dispatchSpy.mock.calls.length;

            // Simulate what happens when CM writes to Y.Text with "local" origin
            // The observer should NOT dispatch back to CM
            ydoc.transact(() => {
                ytext.insert(0, "local-origin");
            }, "local");

            // No new dispatches should have occurred (observer skipped it)
            expect(dispatchSpy.mock.calls.length).toBe(initialDispatchCount);
            // Y.Text has the content
            expect(ytext.toString()).toBe("local-origin");
            // But CM does not (observer skipped it, which is correct for local origin)
            expect(view.state.doc.toString()).toBe("");
        });

        it("does not auto-remove a revision annotation when remote Y.Text changes collapse its range", async () => {
            view.destroy();
            ydoc.destroy();

            ydoc = new Y.Doc();
            ytext = ydoc.getText("document");
            ydoc.transact(() => {
                ytext.insert(0, "hello world");
            }, "init");
            view = new EditorView({
                state: EditorState.create({
                    doc: "hello world",
                    extensions: [annotationExtensions(), createYjsBinding(ytext)],
                }),
                parent: document.body,
            });

            view.dispatch({
                effects: addAnnotation.of({
                    id: 0,
                    _type: "revision",
                    selection: EditorSelection.single(6, 11),
                    thread: [],
                    versions: [{ doc: "world" }, { doc: "" }],
                    activeVersionIndex: 0,
                }),
            });

            ydoc.transact(() => {
                ytext.delete(6, 5);
            }, "remote-client");
            await Promise.resolve();
            await Promise.resolve();

            const syncedAnnotations = Object.values(view.state.field(annotationField));
            expect(syncedAnnotations).toHaveLength(1);
            const revision = syncedAnnotations[0];
            if (!isAnnotationOfType(revision, "revision")) {
                expect.fail("Expected a revision annotation");
                return;
            }
            expect(view.state.doc.toString()).toBe("hello ");
            expect(revision.selection.main.empty).toBe(true);
        });
    });

    describe("destroy cleanup", () => {
        it("unobserves Y.Text on destroy", () => {
            const unobserveSpy = vi.spyOn(ytext, "unobserve");

            view.destroy();

            expect(unobserveSpy).toHaveBeenCalledTimes(1);
        });

        it("does not apply changes after destroy", () => {
            view.destroy();

            // This should not throw or cause errors
            ydoc.transact(() => {
                ytext.insert(0, "after-destroy");
            }, "remote-client");

            // Y.Text should have the content, but CM should not crash
            expect(ytext.toString()).toBe("after-destroy");
        });
    });
});
