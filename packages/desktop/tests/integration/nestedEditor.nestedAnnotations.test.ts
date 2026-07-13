/**
 * Integration tests for nested annotations inside revision modal editors.
 *
 * Covers:
 *   - syncFromParent minimal diff preserving nested annotation positions
 *   - Creating nested annotations and flushing to parent history (undoable)
 */

import { nestedSavedFields } from "$lib/editor/extensions";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    NestedEditorController,
    serializedNestedAnnotationSnapshot,
    transactionsHaveAnnotationMutationEffect,
} from "$lib/editor/plugins/annotations/NestedEditorController";
import {
    _nestedEditRevision,
    addAnnotation,
    annotationField,
    applySuggestion,
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
import { normalizeSerializedSelection } from "$lib/editor/plugins/annotations/nestedEditor";
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    version: string | { doc: string; label?: string; annotationField?: Record<string, unknown> },
): number {
    const built = makeVersion(typeof version === "string" ? { doc: version } : version);
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionId: built.id,
        versions: [built],
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
    return versionText(activeVersion(rev));
}

/** Resolve the stable version id at a positional index for an updateRevisionVersionState call. */
function versionIdAt(state: EditorState, revId: number, index: number): string {
    const rev = state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    return rev.versions[index].id;
}

// makeVersion mints an id and preserves extra keys at runtime, but a literal with
// an `annotationField` key trips TypeScript's excess-property check. Routing the
// blob through this helper (a parameter, not a literal) builds a VersionState that
// carries the nested annotation blob without that friction.
function makeVersionBlob(blob: {
    doc: string;
    label?: string;
    annotationField?: Record<string, unknown>;
}): VersionState {
    return makeVersion(blob);
}

function getRevisionSlice(view: EditorView, revId: number): string {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    return view.state.doc.slice(rev.selection.main.from, rev.selection.main.to).toString();
}

function rawSelection(from: number, to: number) {
    return { ranges: [{ anchor: from, head: to }], main: 0 };
}

function nestedComment(id: number, from: number, to: number) {
    return {
        _type: "comment",
        status: "active" as const,
        id,
        selection: rawSelection(from, to),
        thread: [],
    };
}

function nestedSuggestion(
    id: number,
    from: number,
    to: number,
    replacements: Array<{ text: string; rationale?: string }>,
) {
    return {
        _type: "suggestion",
        status: "active" as const,
        id,
        selection: rawSelection(from, to),
        thread: [],
        replacements,
    };
}

function getVersionAnnotationField(view: EditorView, revId: number): Record<string, unknown> {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    const version = activeVersion(rev) as {
        annotationField?: Record<string, unknown>;
    };
    return version.annotationField ?? {};
}

function getVersionAnnotation(view: EditorView, revId: number, annId: number): unknown {
    return getVersionAnnotationField(view, revId)[annId];
}

function getRawAnnotationRange(annotation: unknown): [number, number] {
    if (!annotation || typeof annotation !== "object") throw new Error("No annotation");
    const selection = (annotation as { selection?: unknown }).selection;
    if (!selection || typeof selection !== "object") throw new Error("No selection");

    const maybeCodeMirrorSelection = selection as { main?: { from: number; to: number } };
    if (typeof maybeCodeMirrorSelection.main === "object") {
        return [maybeCodeMirrorSelection.main.from, maybeCodeMirrorSelection.main.to];
    }

    const raw = selection as {
        ranges?: Array<{ anchor: number; head: number }>;
        main?: number;
    };
    const range = raw.ranges?.[raw.main ?? 0];
    if (!range) throw new Error("No range");
    return [Math.min(range.anchor, range.head), Math.max(range.anchor, range.head)];
}

function mountNestedController(view: EditorView, revId: number) {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const controller = new NestedEditorController(view, revId, {}, "flush");
    const controllerInternals = controller as unknown as {
        _editor: EditorView | undefined;
        _mountedVersionIndex: number;
        _mountedVersionId: string | undefined;
        _lastDispatchedDoc: string;
        _editorVersionId: string;
        _lastMountedBlob: string | undefined;
        onNestedUpdate(update: ViewUpdate): void;
    };
    const version = activeVersion(rev);
    const hydratedVersion = { ...version, selection: rawSelection(0, 0) };
    const state = EditorState.fromJSON(
        hydratedVersion,
        {
            extensions: [
                annotationExtensions(),
                EditorView.updateListener.of((update) =>
                    controllerInternals.onNestedUpdate(update),
                ),
            ],
        },
        nestedSavedFields,
    );
    const editor = new EditorView({ state, parent: host });
    controllerInternals._editor = editor;
    controllerInternals._mountedVersionIndex = activeVersionIndex(rev);
    controllerInternals._mountedVersionId = version.id;
    controllerInternals._editorVersionId = version.id;
    controllerInternals._lastDispatchedDoc = editor.state.doc.toString();
    controllerInternals._lastMountedBlob = serializedNestedAnnotationSnapshot(version);

    return {
        controller,
        editor,
        destroy() {
            controller.destroy({ skipFlush: true });
            host.remove();
        },
    };
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
                    status: "active" as const,
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
                versionIdAt(view.state, revId, 0),
                makeVersion(blobWithAnnotation),
                {
                    addToHistory: true,
                },
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
                    status: "active" as const,
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
                versionIdAt(view.state, revId, 0),
                makeVersion(blobWithAnnotation),
                {
                    addToHistory: true,
                },
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
                    status: "active" as const,
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
                versionIdAt(view.state, revId, 0),
                makeVersion(blobWithAnnotation),
                {
                    addToHistory: true,
                },
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

    it("treats annotation-only nested revision version updates as flush-worthy", () => {
        const state = EditorState.create({
            doc: "hello world",
            extensions: [annotationField],
        });
        const versions = [makeVersion({ doc: "hello" }), makeVersion({ doc: "draft" })];
        const nestedRevision = {
            ...createNewAnnotation(
                state.field(annotationField),
                EditorSelection.single(0, 5),
                "revision",
            ),
            activeVersionId: versions[0].id,
            versions,
        };
        let nextState = state.update({ effects: addAnnotation.of(nestedRevision) }).state;
        const update = updateRevisionVersionState(
            nextState,
            nestedRevision.id,
            versions[1].id,
            makeVersion({ doc: "draft edited" }),
        );
        nextState = update.state;

        expect(transactionsHaveAnnotationMutationEffect([update])).toBe(true);
        const updated = nextState.field(annotationField)[nestedRevision.id];
        if (!isAnnotationOfType(updated, "revision")) throw new Error("Expected revision");
        expect(versionText(updated.versions[1])).toBe("draft edited");
    });

    it("nested rebuild detection ignores doc-only version text changes", () => {
        const before = serializedNestedAnnotationSnapshot(
            makeVersionBlob({
                doc: "hello",
                annotationField: {
                    0: {
                        _type: "comment",
                        status: "active" as const,
                        id: 0,
                        selection: { ranges: [{ anchor: 0, head: 5 }], main: 0 },
                        thread: [],
                    },
                },
            }),
        );
        const after = serializedNestedAnnotationSnapshot(
            makeVersionBlob({
                doc: "hello!",
                annotationField: {
                    0: {
                        _type: "comment",
                        status: "active" as const,
                        id: 0,
                        selection: { ranges: [{ anchor: 0, head: 5 }], main: 0 },
                        thread: [],
                    },
                },
            }),
        );

        expect(after).toBe(before);
    });

    it("nested rebuild detection notices annotation blob changes", () => {
        const before = serializedNestedAnnotationSnapshot(makeVersion({ doc: "hello" }));
        const after = serializedNestedAnnotationSnapshot(
            makeVersionBlob({
                doc: "hello",
                annotationField: {
                    0: {
                        _type: "comment",
                        status: "active" as const,
                        id: 0,
                        selection: { ranges: [{ anchor: 0, head: 5 }], main: 0 },
                        thread: [],
                    },
                },
            }),
        );

        expect(after).not.toBe(before);
    });
});

// ── NestedEditorController sync gap regressions ─────────────────────────────

describe("NestedEditorController annotation flush regressions", () => {
    it("keeps nested annotation remaps atomic across repeated undo and redo", () => {
        const revId = addRevision(view, 0, 11, {
            doc: "hello world",
            annotationField: {
                0: nestedComment(0, 1, 2),
            },
        });
        const mounted = mountNestedController(view, revId);

        mounted.editor.dispatch({ changes: { from: 0, insert: "X" } });
        expect(view.state.doc.toString()).toBe("Xhello world");
        expect(getRawAnnotationRange(getVersionAnnotation(view, revId, 0))).toEqual([2, 3]);
        mounted.destroy();

        for (let cycle = 0; cycle < 3; cycle++) {
            undo(view);
            expect(view.state.doc.toString()).toBe("hello world");
            expect(getRawAnnotationRange(getVersionAnnotation(view, revId, 0))).toEqual([1, 2]);

            redo(view);
            expect(view.state.doc.toString()).toBe("Xhello world");
            expect(getRawAnnotationRange(getVersionAnnotation(view, revId, 0))).toEqual([2, 3]);
        }
    });

    it("flushes when a doc change removes the last nested annotation", () => {
        const revId = addRevision(view, 0, 11, {
            doc: "hello world",
            annotationField: {
                0: nestedComment(0, 0, 5),
            },
        });
        const mounted = mountNestedController(view, revId);

        try {
            mounted.editor.dispatch({ changes: { from: 0, to: 5 } });

            expect(getVersionDoc(view, revId)).toBe(" world");
            expect(Object.keys(getVersionAnnotationField(view, revId))).toHaveLength(0);
        } finally {
            mounted.destroy();
        }
    });

    it("treats nested applySuggestion as an undoable annotation mutation", () => {
        const revId = addRevision(view, 0, 11, {
            doc: "hello world",
            annotationField: {
                0: nestedSuggestion(0, 0, 5, [{ text: "hi" }]),
            },
        });
        const mounted = mountNestedController(view, revId);

        try {
            const transaction = applySuggestion(mounted.editor.state, 0, 0);
            expect(transactionsHaveAnnotationMutationEffect([transaction])).toBe(true);
            const depthBefore = undoDepth(view.state);

            mounted.editor.dispatch(transaction);
            expect(undoDepth(view.state)).toBe(depthBefore + 1);
            expect(view.state.doc.toString()).toBe("hi world");
            expect(getVersionAnnotation(view, revId, 0)).toBeUndefined();

            undo(view);
            expect(view.state.doc.toString()).toBe("hello world");
            expect(getVersionAnnotation(view, revId, 0)).toBeDefined();

            redo(view);
            expect(view.state.doc.toString()).toBe("hi world");
            expect(getVersionAnnotation(view, revId, 0)).toBeUndefined();
        } finally {
            mounted.destroy();
        }
    });

    it("flushes nested annotation remaps after parent sync transactions", () => {
        const revId = addRevision(view, 0, 11, {
            doc: "hello world",
            annotationField: {
                0: nestedComment(0, 6, 11),
            },
        });
        const mounted = mountNestedController(view, revId);

        try {
            view.dispatch({
                changes: { from: 1, to: 1, insert: "xx" },
                annotations: Transaction.addToHistory.of(false),
            });

            const externalDoc = getVersionDoc(view, revId);
            expect(externalDoc).toBe("hxxello world");

            mounted.controller.syncFromParent(externalDoc);

            expect(getRawAnnotationRange(getVersionAnnotation(view, revId, 0))).toEqual([8, 13]);
        } finally {
            mounted.destroy();
        }
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
                    status: "active" as const,
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
                versionIdAt(view.state, revId, 0),
                makeVersion(blob1),
                {
                    addToHistory: true,
                },
            ),
        );

        // Second flush: add another annotation
        const blob2 = {
            doc: "hello world",
            annotationField: {
                0: {
                    _type: "comment",
                    status: "active" as const,
                    id: 0,
                    selection: {
                        ranges: [{ anchor: 0, head: 5 }],
                        main: 0,
                    },
                    thread: [],
                },
                1: {
                    _type: "comment",
                    status: "active" as const,
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
            updateRevisionVersionState(
                view.state,
                revId,
                versionIdAt(view.state, revId, 0),
                makeVersion(blob2),
                {
                    addToHistory: true,
                },
            ),
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
            updateRevisionVersionState(
                view.state,
                revId,
                versionIdAt(view.state, revId, 0),
                makeVersion(blob),
                {
                    addToHistory: true,
                },
            ),
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
                    status: "active" as const,
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

    it("renders nested annotation decorations on first EditorView render", async () => {
        const blob = {
            doc: "hello world",
            selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            annotationField: {
                0: {
                    _type: "comment",
                    status: "active" as const,
                    id: 0,
                    selection: {
                        ranges: [{ anchor: 0, head: 5 }],
                        main: 0,
                    },
                    thread: [],
                },
            },
        };
        const state = EditorState.fromJSON(
            blob,
            { extensions: [annotationExtensions()] },
            nestedSavedFields,
        );
        const host = document.createElement("div");
        document.body.appendChild(host);
        const nestedView = new EditorView({ state, parent: host });

        try {
            await Promise.resolve();
            expect(nestedView.dom.querySelector(".cm-comment")).not.toBeNull();
        } finally {
            nestedView.destroy();
            host.remove();
        }
    });

    it("hydrates annotationField-only blobs with a quiet fallback selection", async () => {
        const blob = {
            doc: "hello world",
            annotationField: {
                0: {
                    _type: "comment",
                    status: "active" as const,
                    id: 0,
                    selection: {
                        ranges: [{ anchor: 0, head: 5 }],
                        main: 0,
                    },
                    thread: [],
                },
            },
        };
        const normalizedSelection = normalizeSerializedSelection(undefined, blob.doc.length);
        expect(normalizedSelection.shouldWarn).toBe(false);
        const host = document.createElement("div");
        document.body.appendChild(host);
        const state = EditorState.fromJSON(
            { ...blob, selection: normalizedSelection.selection },
            { extensions: [annotationExtensions()] },
            nestedSavedFields,
        );
        const nestedView = new EditorView({ state, parent: host });

        try {
            await Promise.resolve();
            expect(nestedView.dom.querySelector(".cm-comment")).not.toBeNull();
        } finally {
            nestedView.destroy();
            host.remove();
        }
    });

    it("renders nested annotation decorations after recreating an inline editor for a prior version", async () => {
        const versionWithAnnotation = {
            doc: "hello world",
            selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            annotationField: {
                0: {
                    _type: "comment",
                    status: "active" as const,
                    id: 0,
                    selection: {
                        ranges: [{ anchor: 6, head: 11 }],
                        main: 0,
                    },
                    thread: [],
                },
            },
        };
        const emptyVersion = {
            doc: "",
            selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
        };
        const host = document.createElement("div");
        document.body.appendChild(host);
        let nestedView = new EditorView({
            state: EditorState.fromJSON(
                versionWithAnnotation,
                { extensions: [annotationExtensions()] },
                nestedSavedFields,
            ),
            parent: host,
        });

        try {
            nestedView.destroy();
            nestedView = new EditorView({
                state: EditorState.fromJSON(
                    emptyVersion,
                    { extensions: [annotationExtensions()] },
                    nestedSavedFields,
                ),
                parent: host,
            });
            nestedView.destroy();
            nestedView = new EditorView({
                state: EditorState.fromJSON(
                    versionWithAnnotation,
                    { extensions: [annotationExtensions()] },
                    nestedSavedFields,
                ),
                parent: host,
            });

            await Promise.resolve();
            expect(nestedView.dom.querySelector(".cm-comment")).not.toBeNull();
        } finally {
            nestedView.destroy();
            host.remove();
        }
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
