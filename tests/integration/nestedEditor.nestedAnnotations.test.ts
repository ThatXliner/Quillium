/**
 * Integration tests for nested annotations inside revision modal editors.
 *
 * Covers:
 *   - syncFromParent minimal diff preserving nested annotation positions
 *   - Creating nested annotations and flushing to parent history (undoable)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo } from "@codemirror/commands";
import {
    annotationField,
    addAnnotation,
    nestedEditorEdit,
    _nestedEditRevision,
    updateRevisionVersionState,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    versionText,
    type VersionState,
} from "$lib/editor/plugins/annotations/models";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

function addRevision(
    view: EditorView,
    from: number,
    to: number,
    doc: string,
): number {
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionIndex: 0,
        versions: [{ doc }],
    };
    view.dispatch(
        view.state.update({ effects: [addAnnotation.of(annotation)] }),
    );
    return annotation.id;
}

function addComment(
    view: EditorView,
    from: number,
    to: number,
): number {
    const annotation = createNewAnnotation(
        view.state.field(annotationField),
        EditorSelection.single(from, to),
        "comment",
    );
    view.dispatch(
        view.state.update({
            effects: [addAnnotation.of(annotation)],
        }),
    );
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
    if (!rev || !isAnnotationOfType(rev, "revision"))
        throw new Error("No revision");
    const offset = rev.selection.main.from;
    view.dispatch({
        changes: { from: offset + from, to: offset + to, insert },
        effects: [_nestedEditRevision.of(revId)],
        annotations: [
            nestedEditorEdit.of(revId),
            Transaction.addToHistory.of(true),
        ],
    });
}

function getVersionDoc(view: EditorView, revId: number): string {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision"))
        throw new Error("No revision");
    return versionText(rev.versions[rev.activeVersionIndex]);
}

function getRevisionSlice(view: EditorView, revId: number): string {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision"))
        throw new Error("No revision");
    return view.state.doc
        .slice(rev.selection.main.from, rev.selection.main.to)
        .toString();
}

/**
 * Apply a minimal diff (common prefix/suffix matching) to an editor,
 * replicating the algorithm in syncFromParent.
 */
function applyMinimalDiff(
    editor: EditorView,
    newDoc: string,
    addToHistory = false,
): void {
    const current = editor.state.doc.toString();
    if (current === newDoc) return;

    const minLen = Math.min(current.length, newDoc.length);
    let prefix = 0;
    while (
        prefix < minLen &&
        current.charCodeAt(prefix) === newDoc.charCodeAt(prefix)
    ) {
        prefix++;
    }
    let suffix = 0;
    while (
        suffix < minLen - prefix &&
        current.charCodeAt(current.length - 1 - suffix) ===
            newDoc.charCodeAt(newDoc.length - 1 - suffix)
    ) {
        suffix++;
    }

    editor.dispatch({
        changes: {
            from: prefix,
            to: current.length - suffix,
            insert: newDoc.slice(prefix, newDoc.length - suffix),
        },
        annotations: Transaction.addToHistory.of(addToHistory),
    });
}

// ── State ─────────────────────────────────────────────────────────────────────

let view: EditorView;

beforeEach(() => {
    view = createView("hello world");
});

afterEach(() => {
    view.destroy();
});

// ── Minimal diff preserves annotation positions ──────────────────────────────

describe("minimal diff (syncFromParent algorithm) preserves annotations", () => {
    it("comment survives suffix deletion via minimal diff", () => {
        // Comment on "hello" [0,5], then delete " world" via minimal diff
        const commentId = addComment(view, 0, 5);

        applyMinimalDiff(view, "hello");

        const ann = view.state.field(annotationField)[commentId];
        expect(ann).toBeDefined();
        expect(ann.selection.main.from).toBe(0);
        expect(ann.selection.main.to).toBe(5);
    });

    it("comment survives suffix restoration via minimal diff", () => {
        // Start with "hello", comment on "hello" [0,5], then restore to "hello world"
        view.destroy();
        view = createView("hello");
        const commentId = addComment(view, 0, 5);

        applyMinimalDiff(view, "hello world");

        const ann = view.state.field(annotationField)[commentId];
        expect(ann).toBeDefined();
        expect(ann.selection.main.from).toBe(0);
        expect(ann.selection.main.to).toBe(5);
    });

    it("comment survives append after its range via minimal diff", () => {
        // Comment on "hello" [0,5], append "!" at end → "hello world!"
        const commentId = addComment(view, 0, 5);

        applyMinimalDiff(view, "hello world!");

        const ann = view.state.field(annotationField)[commentId];
        expect(ann).toBeDefined();
        expect(ann.selection.main.from).toBe(0);
        expect(ann.selection.main.to).toBe(5);
    });

    it("contrast: full-doc replacement destroys mid-doc annotation", () => {
        // Full-doc swap [0, len) collapses all annotations since both
        // endpoints are inside the replaced region.
        const commentId = addComment(view, 6, 11);

        view.dispatch({
            changes: { from: 0, to: 11, insert: "hi world" },
            annotations: Transaction.addToHistory.of(false),
        });

        // Comment was destroyed by full-doc swap
        const ann = view.state.field(annotationField)[commentId];
        expect(ann).toBeUndefined();
    });

    it("minimal diff preserves annotation that full-doc swap destroys", () => {
        // Same change as above but via minimal diff.
        // The localized change only touches [1,5] → "i", so the
        // comment at [6,11] survives (shifted but present).
        const commentId = addComment(view, 6, 11);

        applyMinimalDiff(view, "hi world");

        const ann = view.state.field(annotationField)[commentId];
        expect(ann).toBeDefined();
        // The annotation survived and still has nonzero width
        const width =
            ann.selection.main.to - ann.selection.main.from;
        expect(width).toBeGreaterThan(0);
    });

    it("comment at unchanged end survives append via minimal diff", () => {
        // Comment on "world" [6,11], append "!" → "hello world!"
        const commentId = addComment(view, 6, 11);

        applyMinimalDiff(view, "hello world!");

        const ann = view.state.field(annotationField)[commentId];
        expect(ann).toBeDefined();
        expect(ann.selection.main.from).toBe(6);
        expect(ann.selection.main.to).toBe(11);
    });
});

// ── Nested annotation creation + undo via parent history ─────────────────────

describe("nested annotation creation enters parent undo history via version state flush", () => {
    it("flushing version state with annotationField blob is undoable", () => {
        const revId = addRevision(view, 0, 11, "hello world");

        // Simulate executePendingNestedCommand + flushAnnotationStateToParent:
        // dispatches _updateRevisionVersionState with addToHistory: true
        const blobWithAnnotation = {
            doc: "hello world",
            annotationField: {
                0: {
                    _type: "comment",
                    id: 0,
                    selection: {
                        ranges: [{ anchor: 0, head: 5 }],
                        main: 0,
                    },
                    thread: [],
                },
            },
        };

        view.dispatch(
            updateRevisionVersionState(
                view.state,
                revId,
                0,
                blobWithAnnotation as VersionState,
                { addToHistory: true },
            ),
        );

        // Verify the version state now has the annotation blob
        const rev = view.state.field(annotationField)[revId];
        if (isAnnotationOfType(rev, "revision")) {
            const vState = rev.versions[0] as {
                annotationField?: unknown;
            };
            expect(vState.annotationField).toBeDefined();
        }

        // Undo should remove the annotation blob
        undo(view);

        const revAfterUndo = view.state.field(annotationField)[revId];
        if (isAnnotationOfType(revAfterUndo, "revision")) {
            const vState = revAfterUndo.versions[0] as {
                annotationField?: unknown;
            };
            const hasAnnotations =
                vState.annotationField &&
                typeof vState.annotationField === "object" &&
                Object.keys(vState.annotationField as object).length > 0;
            expect(hasAnnotations).toBeFalsy();
        }
    });

    it("redo after undo of version state flush restores the blob", () => {
        const revId = addRevision(view, 0, 11, "hello world");

        const blobWithAnnotation = {
            doc: "hello world",
            annotationField: {
                0: {
                    _type: "comment",
                    id: 0,
                    selection: {
                        ranges: [{ anchor: 0, head: 5 }],
                        main: 0,
                    },
                    thread: [],
                },
            },
        };

        view.dispatch(
            updateRevisionVersionState(
                view.state,
                revId,
                0,
                blobWithAnnotation as VersionState,
                { addToHistory: true },
            ),
        );

        undo(view);
        redo(view);

        const rev = view.state.field(annotationField)[revId];
        if (isAnnotationOfType(rev, "revision")) {
            const vState = rev.versions[0] as {
                annotationField?: unknown;
            };
            expect(vState.annotationField).toBeDefined();
        }
    });

    it("nested edit + flush + undo sequence restores both doc and annotation state", () => {
        const revId = addRevision(view, 0, 11, "hello world");

        // Nested edit: append "!"
        simulateNestedEdit(view, revId, 11, 11, "!");
        expect(view.state.doc.toString()).toBe("hello world!");
        expect(getVersionDoc(view, revId)).toBe("hello world!");

        // Flush annotation state (simulating comment creation + flush)
        const blobWithAnnotation = {
            doc: "hello world!",
            annotationField: {
                0: {
                    _type: "comment",
                    id: 0,
                    selection: {
                        ranges: [{ anchor: 0, head: 5 }],
                        main: 0,
                    },
                    thread: [],
                },
            },
        };

        view.dispatch(
            updateRevisionVersionState(
                view.state,
                revId,
                0,
                blobWithAnnotation as VersionState,
                { addToHistory: true },
            ),
        );

        // Undo flush
        undo(view);
        // Doc should still be "hello world!" (flush doesn't change doc text)
        expect(view.state.doc.toString()).toBe("hello world!");

        // Undo nested edit
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello world");
        expect(getRevisionSlice(view, revId)).toBe("hello world");
    });
});
