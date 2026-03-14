/**
 * Tests for revision version undo via syncVersionToParent.
 *
 * The inline revision card uses a <textarea>; undo/redo is handled
 * by forwarding Mod-z/Mod-y keydowns to undo(parentView)/redo(parentView)
 * directly — no second EditorView involved.
 *
 * The modal editor (RevisionModal.svelte) does use a second EditorView,
 * but it has its own history and does NOT delegate undo to the parent.
 *
 * What these tests verify: syncVersionToParent correctly writes the
 * version state into the parent's annotation field, and undo/redo on
 * the parent restores the previous VersionState blob.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo, undoDepth } from "@codemirror/commands";
import { nestedSavedFields } from "$lib/editor/extensions";
import {
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
 * Creates a minimal EditorView to simulate a modal editor that syncs
 * its state to the parent via syncVersionToParent. The modal has its
 * own history (unlike the old inline nested editor).
 */
function createNestedView(
    versionDoc: string,
    _parentView: EditorView,
): EditorView {
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

// ── Scenario 1: syncVersionToParent writes text into parent annotation ───────

describe("Scenario 1: syncVersionToParent stores version text in parent", () => {
    it("parent annotationField reflects the nested edit after sync", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        nestedView = createNestedView("hello", parentView);

        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });
        syncVersionToParent(nestedView, parentView, revId, 0);

        expect(getRevisionVersionText(parentView, revId)).toBe("hello world");
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
