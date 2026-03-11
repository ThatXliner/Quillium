/**
 * Tests for nested editor undo delegation.
 *
 * Nested revision editors have no independent undo stack — undo/redo
 * is delegated to the parent editor. Every change in the nested editor
 * is synced to the parent via syncVersionToParent, which dispatches an
 * updateRevisionVersionState effect that lands in the parent's history.
 * Pressing Ctrl+Z in the parent restores the previous VersionState blob.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo, undoDepth } from "@codemirror/commands";
import { nestedSavedFields } from "$lib/editor/extensions";
import {
    makeParentUndoKeymap,
    syncVersionToParent,
} from "$lib/editor/plugins/annotations/nestedEditor";
import {
    annotationField,
    addAnnotation,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a parent EditorView using the same extension pattern as other
 * integration tests (history + annotations), avoiding getExtensions()
 * which pulls in listeners.ts and can trigger duplicate @codemirror/state
 * module issues via the $lib path aliasing.
 */
function createParentView(doc = "hello") {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

/**
 * Creates a nested EditorView with no history and with the parent undo
 * keymap installed, mirroring createVersionState() but using the same
 * import path as the test so module deduplication works correctly.
 */
function createNestedView(
    versionDoc: string,
    parentView: EditorView,
): EditorView {
    const parentUndoKeymap = makeParentUndoKeymap(parentView);
    // Mirrors createVersionState: annotations() without history(), plus the
    // parent undo keymap so Ctrl+Z delegates to the parent.
    const state = EditorState.create({
        doc: versionDoc,
        extensions: [annotationExtensions(), parentUndoKeymap],
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

function getRevisionVersionText(
    parentView: EditorView,
    revisionId: number,
): string {
    const annotations = parentView.state.field(annotationField);
    const rev = annotations[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) {
        throw new Error(`No revision annotation with id ${revisionId}`);
    }
    return versionText(rev.versions[rev.currentlySelected]);
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

// ── Scenario 1: Nested editor has no independent undo stack ──────────────────

describe("Scenario 1: nested editor has no independent undo stack", () => {
    it("undo returns false on the nested editor after typing", () => {
        nestedView = createNestedView("hello", parentView);

        // Simulate typing in the nested editor
        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });

        // The nested editor has no history, so undo should return false
        const result = undo(nestedView);
        expect(result).toBe(false);
    });

    it("undoDepth is 0 on nested editor after typing", () => {
        nestedView = createNestedView("hello", parentView);

        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });

        expect(undoDepth(nestedView.state)).toBe(0);
    });
});

// ── Scenario 2: Parent records nested edits ──────────────────────────────────

describe("Scenario 2: parent records nested edits", () => {
    it("parent undoDepth > 0 after syncVersionToParent", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView);

        // Simulate a nested edit
        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });
        syncVersionToParent(nestedView, parentView, revId, 0);

        expect(undoDepth(parentView.state)).toBeGreaterThan(0);
    });
});

// ── Scenario 3: Undo in parent restores previous version text ────────────────

describe("Scenario 3: undo in parent restores previous version text", () => {
    it("after undo, revision version text reverts to original", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView);

        // Simulate a nested edit: "hello" -> "hello world"
        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });
        syncVersionToParent(nestedView, parentView, revId, 0);

        // Verify the updated text is stored
        expect(getRevisionVersionText(parentView, revId)).toBe("hello world");

        // Undo in parent
        undo(parentView);

        // Version text should be restored to "hello"
        expect(getRevisionVersionText(parentView, revId)).toBe("hello");
    });
});

// ── Scenario 4: Undo reduces parent depth, never increases it ───────────────

describe("Scenario 4: parent undoDepth decreases on undo", () => {
    it("undo reduces undoDepth rather than increasing it", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView);

        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });
        syncVersionToParent(nestedView, parentView, revId, 0);

        const depthBefore = undoDepth(parentView.state);
        expect(depthBefore).toBeGreaterThan(0);

        undo(parentView);

        const depthAfter = undoDepth(parentView.state);
        expect(depthAfter).toBeLessThan(depthBefore);
    });
});

// ── Scenario 5: VersionState blobs do not contain historyField ──────────────

describe("Scenario 5: VersionState blobs have no historyField", () => {
    it("stored VersionState in parent annotationField has no historyField key", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView);

        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });
        syncVersionToParent(nestedView, parentView, revId, 0);

        const annotations = parentView.state.field(annotationField);
        const rev = annotations[revId];
        if (!rev || !isAnnotationOfType(rev, "revision")) {
            throw new Error("Expected revision annotation");
        }
        const versionBlob = rev.versions[rev.currentlySelected] as Record<
            string,
            unknown
        >;
        expect(versionBlob).not.toHaveProperty("historyField");
    });

    it("nestedSavedFields does not include historyField", () => {
        expect(nestedSavedFields).not.toHaveProperty("historyField");
        expect(nestedSavedFields).toHaveProperty("annotationField");
    });
});

// ── Scenario 6: Redo restores the newer version text ────────────────────────

describe("Scenario 6: redo restores the newer version text", () => {
    it("after undo then redo, version text returns to 'hello world'", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView);

        // Nested edit: "hello" -> "hello world"
        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });
        syncVersionToParent(nestedView, parentView, revId, 0);

        expect(getRevisionVersionText(parentView, revId)).toBe("hello world");

        // Undo
        undo(parentView);
        expect(getRevisionVersionText(parentView, revId)).toBe("hello");

        // Redo
        redo(parentView);
        expect(getRevisionVersionText(parentView, revId)).toBe("hello world");
    });
});
