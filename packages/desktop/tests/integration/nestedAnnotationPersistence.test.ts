/**
 * Tests for nested annotation persistence through the modal editor's
 * serialize/deserialize cycle.
 *
 * The modal editor's destroyEditor() flushes nested state via
 * editor.state.toJSON(nestedSavedFields) + updateRevisionVersionState.
 * createNestedEditorState then restores from the serialized blob via
 * EditorState.fromJSON. These tests verify that nested annotations
 * (comments/revisions created inside a revision's modal editor) survive
 * the round-trip.
 *
 * Also tests that the external doc sync guard (syncingFromParent)
 * prevents feedback loops when patching the nested editor from parent
 * changes.
 */

import { nestedSavedFields } from "$lib/editor/extensions";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    _nestedEditRevision,
    addAnnotation,
    annotationField,
    nestedEditorEdit,
    updateRevisionVersionState,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type VersionState,
    activeVersion,
    activeVersionIndex,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { translateAndDispatch } from "$lib/editor/plugins/annotations/nestedEditor";
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createParentView(doc: string, newGroupDelay = 0) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay }), annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

/** Create a nested editor view with annotations but no local history. */
function createNestedView(doc: string, updateListener?: (update: ViewUpdate) => void) {
    const state = EditorState.create({
        doc,
        extensions: [
            annotationExtensions(),
            ...(updateListener ? [EditorView.updateListener.of(updateListener)] : []),
        ],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

/** Restore a nested editor from a serialized blob (as fromJSON does). */
function restoreNestedView(blob: VersionState) {
    const state = EditorState.fromJSON(
        blob,
        {
            extensions: [annotationExtensions()],
        },
        nestedSavedFields,
    );
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

function addRevision(
    view: EditorView,
    from: number,
    to: number,
    doc: string,
    provenance: "human" | "ai" | "mixed" = "human",
): number {
    const builtVersions = [makeVersion({ doc, provenance })];
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionId: builtVersions[0].id,
        versions: builtVersions,
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

function simulateNestedEdit(
    view: EditorView,
    revId: number,
    from: number,
    to: number,
    insert: string,
) {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    const offset = rev.selection.main.from;
    view.dispatch({
        changes: { from: offset + from, to: offset + to, insert },
        effects: [_nestedEditRevision.of(revId)],
        annotations: [nestedEditorEdit.of(revId), Transaction.addToHistory.of(true)],
    });
}

// ── State ─────────────────────────────────────────────────────────────────────

let parentView: EditorView;

beforeEach(() => {
    parentView = createParentView("hello world");
});

afterEach(() => {
    parentView.destroy();
});

// ── Nested annotation persistence (RevisionModal.svelte:388) ─────────────────

describe("nested annotation persistence through modal flush", () => {
    it("nested comment annotations survive toJSON/fromJSON round-trip", () => {
        // Create a nested editor with doc "hello"
        const nestedEditor = createNestedView("hello");

        // Add a comment annotation inside the nested editor
        const nestedAnnotations = nestedEditor.state.field(annotationField);
        const nestedComment = createNewAnnotation(
            nestedAnnotations,
            EditorSelection.single(0, 3), // comment on "hel"
            "comment",
        );
        nestedEditor.dispatch(
            nestedEditor.state.update({
                effects: [
                    addAnnotation.of({
                        ...nestedComment,
                        thread: [{ message: "test comment", author: "user", time: 1 }],
                    }),
                ],
            }),
        );

        // Verify annotation exists
        const beforeFlush = nestedEditor.state.field(annotationField);
        expect(Object.keys(beforeFlush).length).toBe(1);

        // Serialize (like destroyEditor does)
        const blob = nestedEditor.state.toJSON(nestedSavedFields) as VersionState;
        nestedEditor.destroy();

        // Verify blob contains annotationField data
        expect((blob as Record<string, unknown>).annotationField).toBeDefined();

        // Restore (like createEditor does via fromJSON)
        const restoredEditor = restoreNestedView(blob);
        const restoredAnnotations = restoredEditor.state.field(annotationField);

        // Comment should survive the round-trip
        expect(Object.keys(restoredAnnotations).length).toBe(1);
        expect(restoredAnnotations[nestedComment.id]).toBeDefined();
        expect(restoredAnnotations[nestedComment.id].thread[0].message).toBe("test comment");
        expect(restoredAnnotations[nestedComment.id].selection.main.from).toBe(0);
        expect(restoredAnnotations[nestedComment.id].selection.main.to).toBe(3);

        restoredEditor.destroy();
    });

    it("nested revision annotations with versions survive round-trip", () => {
        const nestedEditor = createNestedView("hello");

        // Add a sub-revision inside the nested editor
        const nestedAnnotations = nestedEditor.state.field(annotationField);
        const subVersions = [makeVersion({ doc: "hello" }), makeVersion({ doc: "hi" })];
        const subRevision = {
            ...createNewAnnotation(nestedAnnotations, EditorSelection.single(0, 5), "revision"),
            activeVersionId: subVersions[0].id,
            versions: subVersions,
        };
        nestedEditor.dispatch(
            nestedEditor.state.update({
                effects: [addAnnotation.of(subRevision)],
            }),
        );

        // Serialize and restore
        const blob = nestedEditor.state.toJSON(nestedSavedFields) as VersionState;
        nestedEditor.destroy();
        const restoredEditor = restoreNestedView(blob);
        const restoredAnnotations = restoredEditor.state.field(annotationField);

        // Sub-revision should survive with both versions
        const restoredRev = restoredAnnotations[subRevision.id];
        expect(restoredRev).toBeDefined();
        expect(isAnnotationOfType(restoredRev, "revision")).toBe(true);
        if (isAnnotationOfType(restoredRev, "revision")) {
            expect(restoredRev.versions.length).toBe(2);
            expect(versionText(restoredRev.versions[0])).toBe("hello");
            expect(versionText(restoredRev.versions[1])).toBe("hi");
            expect(activeVersionIndex(restoredRev)).toBe(0);
        }

        restoredEditor.destroy();
    });

    it("flush via updateRevisionVersionState persists blob in parent", () => {
        const revId = addRevision(parentView, 0, 5, "hello");
        const nestedEditor = createNestedView("hello");

        // Add a nested comment
        const nestedAnnotations = nestedEditor.state.field(annotationField);
        const nestedComment = createNewAnnotation(
            nestedAnnotations,
            EditorSelection.single(1, 4),
            "comment",
        );
        nestedEditor.dispatch(
            nestedEditor.state.update({
                effects: [
                    addAnnotation.of({
                        ...nestedComment,
                        thread: [{ message: "nested!", author: "user", time: 1 }],
                    }),
                ],
            }),
        );

        // Flush: serialize and dispatch to parent (like destroyEditor does)
        const blob = nestedEditor.state.toJSON(nestedSavedFields) as VersionState;
        const rev = parentView.state.field(annotationField)[revId];
        if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error();
        parentView.dispatch(
            updateRevisionVersionState(parentView.state, revId, activeVersion(rev).id, blob, {
                addToHistory: false,
            }),
        );
        nestedEditor.destroy();

        // Parent's version blob should contain the annotationField data
        const parentRev = parentView.state.field(annotationField)[revId];
        if (!parentRev || !isAnnotationOfType(parentRev, "revision")) throw new Error();
        const storedBlob = activeVersion(parentRev) as Record<string, unknown>;
        expect(storedBlob.annotationField).toBeDefined();

        // Recreate nested editor from stored blob — annotations should be there
        const restoredEditor = restoreNestedView(activeVersion(parentRev));
        const restoredAnnotations = restoredEditor.state.field(annotationField);
        expect(Object.keys(restoredAnnotations).length).toBe(1);
        expect(restoredAnnotations[nestedComment.id].thread[0].message).toBe("nested!");

        restoredEditor.destroy();
    });
});

// ── External doc sync guard (Revision.svelte:347) ────────────────────────────

describe("syncingFromParent guard prevents feedback loop", () => {
    it("translateAndDispatch skipped when syncingFromParent is true", () => {
        const revId = addRevision(parentView, 0, 5, "hello");

        let translateCalled = false;
        let syncingFromParent = false;

        const nestedEditor = createNestedView("hello", (update: ViewUpdate) => {
            // Mirror the real updateListener guard from Revision.svelte
            if (!syncingFromParent && translateAndDispatch(update, parentView, revId)) {
                translateCalled = true;
            }
        });

        // Simulate external doc sync with guard active
        syncingFromParent = true;
        nestedEditor.dispatch({
            changes: { from: 0, to: 5, insert: "world" },
            annotations: Transaction.addToHistory.of(false),
        });
        syncingFromParent = false;

        // translateAndDispatch should NOT have been called
        expect(translateCalled).toBe(false);
        // Parent doc should be unchanged (no feedback loop)
        expect(parentView.state.doc.toString()).toBe("hello world");

        nestedEditor.destroy();
    });

    it("translateAndDispatch fires normally when syncingFromParent is false", () => {
        const revId = addRevision(parentView, 0, 5, "hello", "ai");

        let translateCalled = false;
        const syncingFromParent = false;

        const nestedEditor = createNestedView("hello", (update: ViewUpdate) => {
            if (!syncingFromParent && translateAndDispatch(update, parentView, revId)) {
                translateCalled = true;
            }
        });

        // Normal user typing (not syncing from parent)
        nestedEditor.dispatch({
            changes: { from: 5, insert: "!" },
        });

        // translateAndDispatch SHOULD have been called
        expect(translateCalled).toBe(true);
        // Parent should reflect the change
        expect(parentView.state.doc.toString()).toBe("hello! world");
        const revision = parentView.state.field(annotationField)[revId];
        expect(isAnnotationOfType(revision, "revision")).toBe(true);
        if (isAnnotationOfType(revision, "revision")) {
            expect(revision.versions[0].provenance).toBe("mixed");
        }

        expect(undo(parentView)).toBe(true);
        const undone = parentView.state.field(annotationField)[revId];
        expect(isAnnotationOfType(undone, "revision") && undone.versions[0].provenance).toBe("ai");

        expect(redo(parentView)).toBe(true);
        const redone = parentView.state.field(annotationField)[revId];
        expect(isAnnotationOfType(redone, "revision") && redone.versions[0].provenance).toBe(
            "mixed",
        );

        nestedEditor.destroy();
    });

    it("external doc sync after undo does not corrupt parent", () => {
        const revId = addRevision(parentView, 0, 5, "hello");

        let syncingFromParent = false;

        const nestedEditor = createNestedView("hello", (update: ViewUpdate) => {
            if (!syncingFromParent) {
                translateAndDispatch(update, parentView, revId);
            }
        });

        // Nested edit: "hello" → "hello!"
        nestedEditor.dispatch({ changes: { from: 5, insert: "!" } });
        expect(parentView.state.doc.toString()).toBe("hello! world");

        // Undo from parent
        undo(parentView);
        expect(parentView.state.doc.toString()).toBe("hello world");

        // External doc sync: parent undid → patch nested editor with guard
        const externalDoc = "hello";
        const current = nestedEditor.state.doc.toString();
        if (current !== externalDoc) {
            syncingFromParent = true;
            nestedEditor.dispatch({
                changes: { from: 0, to: current.length, insert: externalDoc },
                annotations: Transaction.addToHistory.of(false),
            });
            syncingFromParent = false;
        }

        // Parent doc should NOT be corrupted by feedback
        expect(parentView.state.doc.toString()).toBe("hello world");
        // Nested editor should show the reverted text
        expect(nestedEditor.state.doc.toString()).toBe("hello");

        nestedEditor.destroy();
    });

    it("groups repeated nested deletions into one parent undo step", () => {
        parentView.destroy();
        parentView = createParentView("hello my b world", 500);
        const revId = addRevision(parentView, 0, parentView.state.doc.length, "hello my b world");

        const nestedEditor = createNestedView("hello my b world", (update: ViewUpdate) => {
            translateAndDispatch(update, parentView, revId);
        });
        const depthBeforeDeletion = undoDepth(parentView.state);

        for (let index = 0; index < 5; index++) {
            const cursor = 10 - index;
            nestedEditor.dispatch({
                changes: { from: cursor - 1, to: cursor },
                annotations: Transaction.userEvent.of("delete.backward"),
            });
        }

        expect(parentView.state.doc.toString()).toBe("hello world");
        expect(undoDepth(parentView.state)).toBe(depthBeforeDeletion + 1);

        expect(undo(parentView)).toBe(true);
        expect(parentView.state.doc.toString()).toBe("hello my b world");
        const revision = parentView.state.field(annotationField)[revId];
        expect(
            isAnnotationOfType(revision, "revision") && versionText(activeVersion(revision)),
        ).toBe("hello my b world");

        nestedEditor.destroy();
    });
});
