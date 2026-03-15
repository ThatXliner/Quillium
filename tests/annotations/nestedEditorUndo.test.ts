/**
 * Tests for nested editor direct-dispatch architecture.
 *
 * Nested revision editors are direct viewports onto the parent document's
 * revision range. Edits in the nested editor are translated to parent
 * coordinates and dispatched to the parent via translateAndDispatch(),
 * tagged with nestedEditorEdit; Phase 3 still runs to keep version.doc in sync.
 *
 * Undo/redo: the parent history records nested edits as plain doc changes.
 * Mod-z in the nested editor delegates to undo(parentView).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo, undoDepth } from "@codemirror/commands";
import { nestedSavedFields } from "$lib/editor/extensions";
import {
    makeParentUndoKeymap,
} from "$lib/editor/plugins/annotations/nestedEditor";
import {
    annotationField,
    addAnnotation,
    nestedEditorEdit,
    _nestedEditRevision,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createParentView(doc = "hello") {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

function createNestedView(versionDoc: string, parentView: EditorView, revisionId = 0): EditorView {
    const parentUndoKeymap = makeParentUndoKeymap(parentView, revisionId);
    const state = EditorState.create({
        doc: versionDoc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

function addRevision(
    parentView: EditorView,
    from: number,
    to: number,
    versions: { doc: string }[],
    currentlySelected = 0,
): number {
    const annotation = {
        ...createNewAnnotation(
            parentView.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        currentlySelected,
        versions,
    };
    parentView.dispatch(
        parentView.state.update({ effects: [addAnnotation.of(annotation)] }),
    );
    return annotation.id;
}

function getRevisionVersionText(parentView: EditorView, revisionId: number): string {
    const annotations = parentView.state.field(annotationField);
    const rev = annotations[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) {
        throw new Error(`No revision annotation with id ${revisionId}`);
    }
    return versionText(rev.versions[rev.currentlySelected]);
}

/**
 * Simulates translateAndDispatch by manually dispatching to the parent
 * at the correct offset, mirroring what the nested editor's updateListener does.
 */
function simulateNestedEdit(
    nestedView: EditorView,
    parentView: EditorView,
    revisionId: number,
    insert: string,
    at?: number,
) {
    const pos = at ?? nestedView.state.doc.length;
    // Dispatch to nested editor first (what the user types)
    nestedView.dispatch({ changes: { from: pos, insert } });

    // Now translate to parent coordinates and dispatch
    const rev = parentView.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    const offset = rev.selection.main.from;
    parentView.dispatch({
        changes: { from: offset + pos, insert },
        effects: [_nestedEditRevision.of(revisionId)],
        annotations: [
            nestedEditorEdit.of(revisionId),
            Transaction.addToHistory.of(true),
        ],
    });
}

// ── State ────────────────────────────────────────────────────────────────────

let parentView: EditorView;
let nestedView: EditorView;

beforeEach(() => {
    parentView = createParentView("hello");
});

afterEach(() => {
    nestedView?.destroy();
    parentView.destroy();
});

// ── Scenario 1: syncVersionToParent writes text into parent annotation ───────

describe("Scenario 1: nested editor has no independent undo stack", () => {
    it("undo returns false on the nested editor after typing", () => {
        nestedView = createNestedView("hello", parentView);

        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });

        const result = undo(nestedView);
        expect(result).toBe(false);
    });

    it("undoDepth is 0 on nested editor after typing", () => {
        nestedView = createNestedView("hello", parentView);

        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });
        syncVersionToParent(nestedView, parentView, revId, 0);

        expect(getRevisionVersionText(parentView, revId)).toBe("hello world");
    });
});

// ── Scenario 2: Parent records nested edits via direct dispatch ──────────────

describe("Scenario 2: parent records nested edits", () => {
    it("parent undoDepth > 0 after nested edit dispatched to parent", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView, revId);

        simulateNestedEdit(nestedView, parentView, revId, " world");

        expect(undoDepth(parentView.state)).toBeGreaterThan(0);
    });

    it("parent doc reflects nested edit at correct offset", () => {
        // Parent doc: "hello" with revision at [0,5]
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView, revId);

        simulateNestedEdit(nestedView, parentView, revId, " world");

        expect(parentView.state.doc.toString()).toBe("hello world");
    });
});

// ── Scenario 3: Undo in parent reverts the parent doc ───────────────────────

describe("Scenario 3: undo in parent reverts parent doc", () => {
    it("after undo, parent doc reverts to original", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView, revId);

        simulateNestedEdit(nestedView, parentView, revId, " world");
        expect(parentView.state.doc.toString()).toBe("hello world");

        undo(parentView);

        expect(parentView.state.doc.toString()).toBe("hello");
    });

    it("after undo, Phase 3 syncs version.doc back to original", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView, revId);

        simulateNestedEdit(nestedView, parentView, revId, " world");
        undo(parentView);

        // Phase 3 should have updated version.doc to match the reverted doc slice
        expect(getRevisionVersionText(parentView, revId)).toBe("hello");
    });
});

// ── Scenario 4: Undo reduces parent depth ───────────────────────────────────

describe("Scenario 4: parent undoDepth decreases on undo", () => {
    it("undo reduces undoDepth", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView, revId);

        simulateNestedEdit(nestedView, parentView, revId, " world");

        const depthBefore = undoDepth(parentView.state);
        expect(depthBefore).toBeGreaterThan(0);

        undo(parentView);

        expect(undoDepth(parentView.state)).toBeLessThan(depthBefore);
    });
});

// ── Scenario 5: nestedEditorEdit and Phase 3 ─────────────────────────────────

describe("Scenario 5: nestedEditorEdit runs Phase 3 to keep version.doc current", () => {
    it("nestedEditorEdit transactions update version.doc via Phase 3", () => {
        // Phase 3 intentionally runs for nestedEditorEdit transactions. It syncs
        // versions[currentlySelected].doc from the parent doc slice so that
        // version switching always shows up-to-date text. The nested editor's own
        // state is already correct; Phase 3 keeps the stored snapshot in sync.
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);

        const rev = parentView.state.field(annotationField)[revId];
        if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
        const offset = rev.selection.main.from;

        // Dispatch to parent with nestedEditorEdit tag
        parentView.dispatch({
            changes: { from: offset + 5, insert: " world" },
            effects: [_nestedEditRevision.of(revId)],
            annotations: [
                nestedEditorEdit.of(revId),
                Transaction.addToHistory.of(true),
            ],
        });

        // Phase 3 ran and updated version.doc to match the new parent doc slice
        const updatedRev = parentView.state.field(annotationField)[revId];
        if (!updatedRev || !isAnnotationOfType(updatedRev, "revision")) throw new Error();
        expect(versionText(updatedRev.versions[0])).toBe("hello world");
    });

    it("nestedSavedFields does not include historyField", () => {
        expect(nestedSavedFields).not.toHaveProperty("historyField");
        expect(nestedSavedFields).toHaveProperty("annotationField");
    });
});

// ── Scenario 6: Redo restores the newer parent doc ──────────────────────────

describe("Scenario 6: redo restores the newer doc state", () => {
    it("after undo then redo, parent doc returns to edited state", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView, revId);

        simulateNestedEdit(nestedView, parentView, revId, " world");
        expect(parentView.state.doc.toString()).toBe("hello world");

        undo(parentView);
        expect(parentView.state.doc.toString()).toBe("hello");

        redo(parentView);
        expect(parentView.state.doc.toString()).toBe("hello world");
    });
});
