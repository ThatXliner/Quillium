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
    serializedNestedAnnotationSnapshot,
    transactionsHaveAnnotationMutationEffect,
} from "$lib/editor/plugins/annotations/NestedEditorController";
import {
    createNewAnnotation,
    isAnnotationOfType,
    versionText,
    type VersionState,
} from "$lib/editor/plugins/annotations/models";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { nestedSavedFields } from "$lib/editor/extensions";

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

function addRevision(view: EditorView, from: number, to: number, doc: string): number {
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionIndex: 0,
        versions: [{ doc }],
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

function addComment(view: EditorView, from: number, to: number): number {
    const annotation = createNewAnnotation(
        view.state.field(annotationField),
        EditorSelection.single(from, to),
        "comment",
    );
    view.dispatch(
        view.state.update({
            effects: [addAnnotation.of(annotation)],
            // Keep out of history to avoid the mapRange mutation-through-shared-
            // reference bug where Phase 1 remaps the annotation in place and
            // the history's stored effect sees already-mapped positions.
            annotations: Transaction.addToHistory.of(false),
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
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    const offset = rev.selection.main.from;
    view.dispatch({
        changes: { from: offset + from, to: offset + to, insert },
        effects: [_nestedEditRevision.of(revId)],
        annotations: [nestedEditorEdit.of(revId), Transaction.addToHistory.of(true)],
    });
}

function getVersionDoc(view: EditorView, revId: number): string {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    return versionText(rev.versions[rev.activeVersionIndex]);
}

function getRevisionSlice(view: EditorView, revId: number): string {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    return view.state.doc.slice(rev.selection.main.from, rev.selection.main.to).toString();
}

/**
 * Apply a minimal diff (common prefix/suffix matching) to an editor,
 * replicating the algorithm in syncFromParent.
 */
function applyMinimalDiff(editor: EditorView, newDoc: string, addToHistory = false): void {
    const current = editor.state.doc.toString();
    if (current === newDoc) return;

    const minLen = Math.min(current.length, newDoc.length);
    let prefix = 0;
    while (prefix < minLen && current.charCodeAt(prefix) === newDoc.charCodeAt(prefix)) {
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
        const width = ann.selection.main.to - ann.selection.main.from;
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
            updateRevisionVersionState(view.state, revId, 0, blobWithAnnotation as VersionState, {
                addToHistory: true,
            }),
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
            updateRevisionVersionState(view.state, revId, 0, blobWithAnnotation as VersionState, {
                addToHistory: true,
            }),
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
            updateRevisionVersionState(view.state, revId, 0, blobWithAnnotation as VersionState, {
                addToHistory: true,
            }),
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

    it("treats annotation-only nested revision version updates as flush-worthy", () => {
        const state = EditorState.create({
            doc: "hello world",
            extensions: [annotationField],
        });
        const nestedRevision = {
            ...createNewAnnotation(
                state.field(annotationField),
                EditorSelection.single(0, 5),
                "revision",
            ),
            activeVersionIndex: 0,
            versions: [{ doc: "hello" }, { doc: "draft" }],
        };
        let nextState = state.update({ effects: addAnnotation.of(nestedRevision) }).state;
        const update = updateRevisionVersionState(nextState, nestedRevision.id, 1, {
            doc: "draft edited",
        } as VersionState);
        nextState = update.state;

        expect(transactionsHaveAnnotationMutationEffect([update])).toBe(true);
        const updated = nextState.field(annotationField)[nestedRevision.id];
        if (!isAnnotationOfType(updated, "revision")) throw new Error("Expected revision");
        expect(versionText(updated.versions[1])).toBe("draft edited");
    });

    it("nested rebuild detection ignores doc-only version text changes", () => {
        const before = serializedNestedAnnotationSnapshot({
            doc: "hello",
            annotationField: {
                0: {
                    _type: "comment",
                    id: 0,
                    selection: { ranges: [{ anchor: 0, head: 5 }], main: 0 },
                    thread: [],
                },
            },
        } as VersionState);
        const after = serializedNestedAnnotationSnapshot({
            doc: "hello!",
            annotationField: {
                0: {
                    _type: "comment",
                    id: 0,
                    selection: { ranges: [{ anchor: 0, head: 5 }], main: 0 },
                    thread: [],
                },
            },
        } as VersionState);

        expect(after).toBe(before);
    });

    it("nested rebuild detection notices annotation blob changes", () => {
        const before = serializedNestedAnnotationSnapshot({
            doc: "hello",
        } as VersionState);
        const after = serializedNestedAnnotationSnapshot({
            doc: "hello",
            annotationField: {
                0: {
                    _type: "comment",
                    id: 0,
                    selection: { ranges: [{ anchor: 0, head: 5 }], main: 0 },
                    thread: [],
                },
            },
        } as VersionState);

        expect(after).not.toBe(before);
    });
});

// ── Undo cycles with nested annotations via minimal diff ─────────────────────

describe("undo/redo cycles preserve nested annotations via minimal diff", () => {
    it("comment survives nested edit → undo → redo cycle", () => {
        // Comment on "hello" [0,5], then simulate an edit+undo+redo
        const commentId = addComment(view, 0, 5);

        // Edit: append "!" at end
        view.dispatch({
            changes: { from: 11, to: 11, insert: "!" },
            annotations: Transaction.addToHistory.of(true),
        });
        expect(view.state.doc.toString()).toBe("hello world!");

        // Undo the edit — minimal diff path patches the editor
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");

        const ann = view.state.field(annotationField)[commentId];
        expect(ann).toBeDefined();
        expect(ann.selection.main.from).toBe(0);
        expect(ann.selection.main.to).toBe(5);

        // Redo the edit
        redo(view);
        expect(view.state.doc.toString()).toBe("hello world!");

        const annAfterRedo = view.state.field(annotationField)[commentId];
        expect(annAfterRedo).toBeDefined();
        expect(annAfterRedo.selection.main.from).toBe(0);
        expect(annAfterRedo.selection.main.to).toBe(5);
    });

    it("comment at end of doc survives prefix insertion via minimal diff", () => {
        // Comment on "world" [6,11], insert "hey " at start
        const commentId = addComment(view, 6, 11);

        applyMinimalDiff(view, "hey hello world");

        const ann = view.state.field(annotationField)[commentId];
        expect(ann).toBeDefined();
        // "world" shifted right by 4 chars
        expect(ann.selection.main.from).toBe(10);
        expect(ann.selection.main.to).toBe(15);
    });

    it("comment survives multiple sequential minimal diffs", () => {
        const commentId = addComment(view, 0, 5);

        // Three sequential diffs
        applyMinimalDiff(view, "hello world!");
        applyMinimalDiff(view, "hello world!!");
        applyMinimalDiff(view, "hello world!!!");

        const ann = view.state.field(annotationField)[commentId];
        expect(ann).toBeDefined();
        expect(ann.selection.main.from).toBe(0);
        expect(ann.selection.main.to).toBe(5);
    });

    it("multiple comments survive a single minimal diff", () => {
        const c1 = addComment(view, 0, 5); // "hello"
        const c2 = addComment(view, 6, 11); // "world"

        // Append "!" → only suffix changes
        applyMinimalDiff(view, "hello world!");

        const a1 = view.state.field(annotationField)[c1];
        const a2 = view.state.field(annotationField)[c2];
        expect(a1).toBeDefined();
        expect(a2).toBeDefined();
        expect(a1.selection.main.from).toBe(0);
        expect(a1.selection.main.to).toBe(5);
        expect(a2.selection.main.from).toBe(6);
        expect(a2.selection.main.to).toBe(11);
    });

    it("nested edit undo restores annotation positions via minimal diff", () => {
        // Create revision spanning entire doc, add a comment inside it
        const revId = addRevision(view, 0, 11, "hello world");
        const commentId = addComment(view, 0, 5);

        // Nested edit: insert "X" at position 5 → "helloX world"
        simulateNestedEdit(view, revId, 5, 5, "X");
        expect(view.state.doc.toString()).toBe("helloX world");

        // The comment should still be at [0,5] (insertion was at the boundary)
        const annBefore = view.state.field(annotationField)[commentId];
        expect(annBefore).toBeDefined();

        // Undo the nested edit
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");

        // Comment should survive the undo (minimal diff doesn't destroy it)
        const annAfter = view.state.field(annotationField)[commentId];
        expect(annAfter).toBeDefined();
        expect(annAfter.selection.main.from).toBe(0);
        expect(annAfter.selection.main.to).toBe(5);
    });
});

// ── Multiple flush + undo sequences ──────────────────────────────────────────

describe("multiple version state flushes are independently undoable", () => {
    it("two sequential flushes can be undone independently", () => {
        const revId = addRevision(view, 0, 11, "hello world");

        // First flush: add a comment annotation
        const blob1 = {
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
            updateRevisionVersionState(view.state, revId, 0, blob1 as VersionState, {
                addToHistory: true,
            }),
        );

        // Second flush: add another annotation
        const blob2 = {
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
                1: {
                    _type: "comment",
                    id: 1,
                    selection: {
                        ranges: [{ anchor: 6, head: 11 }],
                        main: 0,
                    },
                    thread: [],
                },
            },
        };
        view.dispatch(
            updateRevisionVersionState(view.state, revId, 0, blob2 as VersionState, {
                addToHistory: true,
            }),
        );

        // Verify both annotations in blob
        const rev2 = view.state.field(annotationField)[revId];
        if (isAnnotationOfType(rev2, "revision")) {
            const af = (rev2.versions[0] as { annotationField?: Record<string, unknown> })
                .annotationField;
            expect(af).toBeDefined();
            expect(Object.keys(af!).length).toBe(2);
        }

        // Undo second flush → back to 1 annotation
        undo(view);
        const rev1 = view.state.field(annotationField)[revId];
        if (isAnnotationOfType(rev1, "revision")) {
            const af = (rev1.versions[0] as { annotationField?: Record<string, unknown> })
                .annotationField;
            expect(af).toBeDefined();
            expect(Object.keys(af!).length).toBe(1);
        }

        // Undo first flush → back to no annotations
        undo(view);
        const rev0 = view.state.field(annotationField)[revId];
        if (isAnnotationOfType(rev0, "revision")) {
            const af = (rev0.versions[0] as { annotationField?: Record<string, unknown> })
                .annotationField;
            const count = af ? Object.keys(af).length : 0;
            expect(count).toBe(0);
        }
    });

    it("revision survives version state flush (doc text unchanged)", () => {
        const revId = addRevision(view, 0, 11, "hello world");

        // Flush should not change the doc text or revision range
        const blob = { doc: "hello world" };
        view.dispatch(
            updateRevisionVersionState(view.state, revId, 0, blob as VersionState, {
                addToHistory: true,
            }),
        );

        expect(view.state.doc.toString()).toBe("hello world");
        const rev = view.state.field(annotationField)[revId];
        expect(rev).toBeDefined();
        expect(rev.selection.main.from).toBe(0);
        expect(rev.selection.main.to).toBe(11);
    });
});

// ── Nested editor hydration from version blob ────────────────────────────────

describe("EditorState.fromJSON hydrates annotations from version blob", () => {
    it("annotationField is populated when blob contains annotations", () => {
        const blob = {
            doc: "hello world",
            selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            annotationField: {
                0: {
                    _type: "comment",
                    id: 0,
                    selection: {
                        ranges: [{ anchor: 0, head: 5 }],
                        main: 0,
                    },
                    thread: [{ message: "test", author: "user", time: 1 }],
                },
            },
        };

        const state = EditorState.fromJSON(
            blob,
            { extensions: [annotationExtensions()] },
            nestedSavedFields,
        );

        const anns = state.field(annotationField);
        const keys = Object.keys(anns);
        expect(keys.length).toBe(1);
        expect(anns[0]).toBeDefined();
        expect(anns[0].selection.main.from).toBe(0);
        expect(anns[0].selection.main.to).toBe(5);
    });

    it("annotationField is empty when blob has no annotationField key", () => {
        const blob = {
            doc: "hello world",
            selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
        };

        const state = EditorState.fromJSON(
            blob,
            { extensions: [annotationExtensions()] },
            nestedSavedFields,
        );

        const anns = state.field(annotationField);
        expect(Object.keys(anns).length).toBe(0);
    });

    it("multiple annotations round-trip through toJSON/fromJSON", () => {
        // Create a view with two comments, serialize, deserialize
        const tempView = createView("hello world");
        addComment(tempView, 0, 5);
        addComment(tempView, 6, 11);

        const serialized = tempView.state.toJSON(nestedSavedFields);
        tempView.destroy();

        // Verify the serialized blob has annotations
        const af = (serialized as { annotationField?: unknown }).annotationField;
        expect(af).toBeDefined();
        expect(Object.keys(af as object).length).toBe(2);

        // Reconstruct state from the blob
        const state = EditorState.fromJSON(
            serialized,
            { extensions: [annotationExtensions()] },
            nestedSavedFields,
        );

        const anns = state.field(annotationField);
        expect(Object.keys(anns).length).toBe(2);
    });
});
