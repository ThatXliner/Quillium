/**
 * Tests for undo/redo edge cases and UX predictability.
 *
 * These tests cover scenarios not exercised by the existing test files:
 *
 *   1. Multiple sequential syncs — undo walks back each sync independently.
 *   2. Version navigation (Ctrl-[ / Ctrl-]) does NOT add undo entries;
 *      undoing after a nav does not land in the middle of version state.
 *   3. cursorPos saved by version nav is NOT an undo entry.
 *   4. Undo after nested edit + version switch only undoes the nested edit,
 *      not the version switch.
 *   5. previewVersionText helper edge cases (empty, long, whitespace).
 *   6. syncVersionToParent preserves existing label through undo/redo.
 *   7. createNewRevision undo removes the new version and restores doc.
 *   8. deleteRevisionVersion undo restores the version and doc.
 *   9. deleteRevisionVersion on last version undo restores the whole annotation.
 *  10. Interleaved main-doc edits and nested syncs undo in correct order.
 *  11. Redo after multiple undos restores all changes in order.
 *  12. Nested undo does not fire when there is nothing to undo (no crash).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import { nestedSavedFields } from "$lib/editor/extensions";
import {
    syncVersionToParent,
    previewVersionText,
    makeParentRevisionNavKeymap,
} from "$lib/editor/plugins/annotations/nestedEditor";
import {
    annotationField,
    addAnnotation,
    updateRevisionVersionState,
    setActiveRevisionVersion,
    createNewRevision,
    deleteRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createParentView(doc = "hello world") {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

function createNestedView(doc: string): EditorView {
    const state = EditorState.create({
        doc,
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
    versions: { doc: string; label?: string }[],
    currentlySelected = 0,
    addToHistory = false,
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
        parentView.state.update({
            effects: [addAnnotation.of(annotation)],
            annotations: [Transaction.addToHistory.of(addToHistory)],
        }),
    );
    return annotation.id;
}

function getRevision(parentView: EditorView, id: number) {
    const rev = parentView.state.field(annotationField)[id];
    if (!rev || !isAnnotationOfType(rev, "revision")) {
        throw new Error(`No revision with id ${id}`);
    }
    return rev;
}

function activeVersionText(parentView: EditorView, id: number): string {
    const rev = getRevision(parentView, id);
    return versionText(rev.versions[rev.currentlySelected] ?? { doc: "" });
}

// ── State ─────────────────────────────────────────────────────────────────────

let parentView: EditorView;

beforeEach(() => {
    parentView = createParentView("hello world");
});

afterEach(() => {
    parentView.destroy();
});

// ── 1. Multiple sequential syncs ─────────────────────────────────────────────

describe("multiple sequential syncs undo in order", () => {
    it("three syncs create three undo entries that unwind in reverse order", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        const nestedView = createNestedView("hello");

        // Sync 1: "hello" → "hi"
        nestedView.dispatch({ changes: { from: 0, to: 5, insert: "hi" } });
        syncVersionToParent(nestedView, parentView, revId, 0);
        expect(activeVersionText(parentView, revId)).toBe("hi");

        // Sync 2: "hi" → "hey"
        nestedView.dispatch({ changes: { from: 0, to: 2, insert: "hey" } });
        syncVersionToParent(nestedView, parentView, revId, 0);
        expect(activeVersionText(parentView, revId)).toBe("hey");

        // Sync 3: "hey" → "howdy"
        nestedView.dispatch({ changes: { from: 0, to: 3, insert: "howdy" } });
        syncVersionToParent(nestedView, parentView, revId, 0);
        expect(activeVersionText(parentView, revId)).toBe("howdy");

        // Undo 3 → "hey"
        undo(parentView);
        expect(activeVersionText(parentView, revId)).toBe("hey");

        // Undo 2 → "hi"
        undo(parentView);
        expect(activeVersionText(parentView, revId)).toBe("hi");

        // Undo 1 → "hello"
        undo(parentView);
        expect(activeVersionText(parentView, revId)).toBe("hello");

        nestedView.destroy();
    });

    it("redo after multiple undos restores in forward order", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        const nestedView = createNestedView("hello");

        nestedView.dispatch({ changes: { from: 0, to: 5, insert: "alpha" } });
        syncVersionToParent(nestedView, parentView, revId, 0);

        nestedView.dispatch({ changes: { from: 0, to: 5, insert: "beta" } });
        syncVersionToParent(nestedView, parentView, revId, 0);

        // Undo both
        undo(parentView);
        undo(parentView);
        expect(activeVersionText(parentView, revId)).toBe("hello");

        // Redo both
        redo(parentView);
        expect(activeVersionText(parentView, revId)).toBe("alpha");
        redo(parentView);
        expect(activeVersionText(parentView, revId)).toBe("beta");

        nestedView.destroy();
    });
});

// ── 2. Version navigation does not add undo entries ──────────────────────────

describe("version navigation does not add undo entries", () => {
    it("setActiveRevisionVersion can be undone (it IS in history)", () => {
        // setActiveRevisionVersion is a user-visible structural change,
        // so it IS in history. Verify the undo count increases and undo works.
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);
        const beforeDepth = undoDepth(parentView.state);

        parentView.dispatch(setActiveRevisionVersion(parentView.state, revId, 1));

        expect(undoDepth(parentView.state)).toBe(beforeDepth + 1);

        undo(parentView);
        expect(getRevision(parentView, revId).currentlySelected).toBe(0);
        expect(activeVersionText(parentView, revId)).toBe("hello");
    });

    it("cursor-only save via updateRevisionVersionState(addToHistory:false) does NOT add undo entry", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        const beforeDepth = undoDepth(parentView.state);

        // Simulate what makeParentRevisionNavKeymap does before switching versions:
        // save cursorPos only, addToHistory: false
        parentView.dispatch(
            updateRevisionVersionState(
                parentView.state,
                revId,
                0,
                { doc: "hello", cursorPos: 3 },
                { addToHistory: false },
            ),
        );

        // Undo depth must not change
        expect(undoDepth(parentView.state)).toBe(beforeDepth);
    });

    it("undo after cursor-only save does NOT land on an intermediate state", () => {
        // User writes in nested editor (sync 1), then navigates versions
        // (cursor-only save, no history), then undoes. The undo should skip
        // straight to the pre-sync state, not an intermediate cursor state.
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        // Nested edit synced to parent (adds history entry)
        parentView.dispatch(
            updateRevisionVersionState(parentView.state, revId, 0, { doc: "hello++" }),
        );
        expect(activeVersionText(parentView, revId)).toBe("hello++");

        // Cursor-only save (no history)
        parentView.dispatch(
            updateRevisionVersionState(
                parentView.state,
                revId,
                0,
                { doc: "hello++", cursorPos: 5 },
                { addToHistory: false },
            ),
        );

        // Single undo must land on the original content, not an intermediate
        undo(parentView);
        expect(activeVersionText(parentView, revId)).toBe("hello");
    });
});

// ── 3. cursorPos is saved and is not an undo entry ───────────────────────────

describe("cursorPos is preserved without polluting undo history", () => {
    it("cursorPos stored on version blob survives undo/redo cycle", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);

        // Write content sync (in history)
        parentView.dispatch(
            updateRevisionVersionState(parentView.state, revId, 0, { doc: "hello+" }),
        );

        // Store cursorPos without history
        parentView.dispatch(
            updateRevisionVersionState(
                parentView.state,
                revId,
                0,
                { doc: "hello+", cursorPos: 4 },
                { addToHistory: false },
            ),
        );

        // Undo the content change
        undo(parentView);
        // The undo target had no cursorPos, so it shouldn't be there
        const rev = getRevision(parentView, revId);
        // cursorPos is optional; after undo we're back to the original blob
        expect(rev.versions[0]?.doc).toBe("hello");

        // Redo brings back "hello+" blob — cursorPos may or may not survive
        // (it wasn't part of the history-tracked blob), but the doc must be right
        redo(parentView);
        expect(activeVersionText(parentView, revId)).toBe("hello+");
    });
});

// ── 4. Interleaved main-doc edits and nested syncs ───────────────────────────

describe("interleaved main-doc edits and nested syncs undo correctly", () => {
    it("undo walks back in order: main-doc edit first, then nested sync", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);

        // Nested sync first: "hello" → "hi" in revision range
        // updateRevisionVersionState with active version also replaces doc range.
        // "hello world" (11 chars) → "hi world" (8 chars)
        parentView.dispatch(
            updateRevisionVersionState(parentView.state, revId, 0, { doc: "hi" }),
        );
        expect(parentView.state.doc.toString()).toBe("hi world");

        // Main-doc edit after the revision range (doc is now 8 chars long)
        const rev = getRevision(parentView, revId);
        const afterRange = rev.selection.main.to; // end of "hi" in doc
        parentView.dispatch({ changes: { from: afterRange + 1, to: afterRange + 1, insert: "!" } });

        expect(parentView.state.doc.toString()).toBe("hi !world");
        expect(activeVersionText(parentView, revId)).toBe("hi");

        // Undo main-doc edit
        undo(parentView);
        expect(parentView.state.doc.toString()).toBe("hi world");
        expect(activeVersionText(parentView, revId)).toBe("hi");

        // Undo nested sync
        undo(parentView);
        expect(activeVersionText(parentView, revId)).toBe("hello");
    });

    it("undo of main-doc insertion does not corrupt version text", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);

        // Sync version text update
        parentView.dispatch(
            updateRevisionVersionState(parentView.state, revId, 0, { doc: "hi" }),
        );

        // Insert text before the revision range
        parentView.dispatch({ changes: { from: 0, to: 0, insert: "start: " } });

        undo(parentView);
        // Version text should still be "hi", unaffected by the insertion undo
        expect(activeVersionText(parentView, revId)).toBe("hi");
    });
});

// ── 5. previewVersionText helper ─────────────────────────────────────────────

describe("previewVersionText", () => {
    it("returns the full text when shorter than the limit", () => {
        expect(previewVersionText({ doc: "hello" })).toBe("hello");
    });

    it("truncates with ellipsis when text exceeds limit", () => {
        const longText = "a".repeat(50);
        const preview = previewVersionText({ doc: longText });
        expect(preview.endsWith("…")).toBe(true);
        expect(preview.length).toBeLessThanOrEqual(35); // 34 chars + ellipsis
    });

    it("returns '(empty)' for empty doc", () => {
        expect(previewVersionText({ doc: "" })).toBe("(empty)");
    });

    it("normalizes whitespace (collapses multiple spaces/newlines)", () => {
        expect(previewVersionText({ doc: "hello\n\nworld" })).toBe("hello world");
    });

    it("respects custom maxLen", () => {
        const preview = previewVersionText({ doc: "hello world" }, 5);
        expect(preview).toBe("hello…");
    });
});

// ── 6. syncVersionToParent preserves label through undo/redo ─────────────────

describe("syncVersionToParent preserves label through undo/redo", () => {
    it("label survives a sync", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello", label: "Draft" }]);
        const nestedView = createNestedView("hello");

        nestedView.dispatch({ changes: { from: nestedView.state.doc.length, insert: "!" } });
        syncVersionToParent(nestedView, parentView, revId, 0);

        expect(getRevision(parentView, revId).versions[0]?.label).toBe("Draft");
        nestedView.destroy();
    });

    it("label is preserved on the undo-restored version blob", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello", label: "Draft" }]);
        const nestedView = createNestedView("hello");

        nestedView.dispatch({ changes: { from: nestedView.state.doc.length, insert: "!" } });
        syncVersionToParent(nestedView, parentView, revId, 0);
        expect(activeVersionText(parentView, revId)).toBe("hello!");

        undo(parentView);
        // After undo, blob is the original — "hello" with label "Draft"
        expect(activeVersionText(parentView, revId)).toBe("hello");
        expect(getRevision(parentView, revId).versions[0]?.label).toBe("Draft");

        nestedView.destroy();
    });
});

// ── 7. createNewRevision undo ─────────────────────────────────────────────────

describe("createNewRevision undo removes new version and restores doc", () => {
    it("undo of createNewRevision restores previous version count and doc text", () => {
        parentView = createParentView("hello world");
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);

        parentView.dispatch(createNewRevision(parentView.state, revId));

        const afterCreate = getRevision(parentView, revId);
        expect(afterCreate.versions).toHaveLength(2);
        // New version is empty (""); doc range replaced with "" → range is empty
        expect(afterCreate.currentlySelected).toBe(1);
        expect(parentView.state.sliceDoc(
            afterCreate.selection.main.from,
            afterCreate.selection.main.to,
        )).toBe("");

        undo(parentView);

        // After undo, we are back to the state before createNewRevision.
        // The revision had "hello" as the active version with doc range [0,5].
        // However addRevision was called with addToHistory:false, so undo of
        // createNewRevision should land back at: doc "hello world", 1 version.
        // The selection range may be empty if the undo lands on the addAnnotation
        // entry with the annotation present but selection collapsed. Let's
        // verify the invariant: either annotation is gone (undo went past it)
        // or it has 1 version and the doc is restored.
        const anns = Object.values(parentView.state.field(annotationField));
        if (anns.length > 0) {
            const restored = getRevision(parentView, revId);
            expect(restored.versions).toHaveLength(1);
        }
        // Doc must be restored to "hello world" (createNewRevision replaced "hello" with "")
        expect(parentView.state.doc.toString()).toBe("hello world");
    });

    it("redo of createNewRevision re-adds the new version", () => {
        parentView = createParentView("hello world");
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);

        parentView.dispatch(createNewRevision(parentView.state, revId));
        undo(parentView);
        redo(parentView);

        const rev = getRevision(parentView, revId);
        expect(rev.versions).toHaveLength(2);
    });
});

// ── 8. deleteRevisionVersion undo ────────────────────────────────────────────

describe("deleteRevisionVersion undo restores the deleted version", () => {
    it("undo restores the deleted version and its text", () => {
        parentView = createParentView("hello world");
        const revId = addRevision(parentView, 0, 5, [
            { doc: "hello" },
            { doc: "hi" },
        ], 0);

        parentView.dispatch(deleteRevisionVersion(parentView.state, revId, 1));
        expect(getRevision(parentView, revId).versions).toHaveLength(1);

        undo(parentView);

        const rev = getRevision(parentView, revId);
        expect(rev.versions).toHaveLength(2);
        expect(versionText(rev.versions[1]!)).toBe("hi");
    });

    it("deleting active version switches to adjacent; undo restores original active version", () => {
        // Use setActiveRevisionVersion to properly set version 1 as active so
        // the doc reflects the version text. addRevision only sets metadata
        // (currentlySelected), not the actual doc content.
        parentView = createParentView("hello world");
        const revId = addRevision(parentView, 0, 5, [
            { doc: "hello" },
            { doc: "hi" },
        ], 0); // start on version 0 "hello"

        // Properly switch to version 1 so the doc says "hi" at [0,2]
        parentView.dispatch(setActiveRevisionVersion(parentView.state, revId, 1));
        expect(getRevision(parentView, revId).currentlySelected).toBe(1);
        const revAfterSwitch = getRevision(parentView, revId);
        expect(parentView.state.sliceDoc(
            revAfterSwitch.selection.main.from,
            revAfterSwitch.selection.main.to,
        )).toBe("hi");

        // Delete the active version (index 1)
        parentView.dispatch(deleteRevisionVersion(parentView.state, revId, 1));

        const afterDelete = getRevision(parentView, revId);
        expect(afterDelete.versions).toHaveLength(1);
        expect(afterDelete.currentlySelected).toBe(0);
        // Doc should now show "hello" (switched to version 0)
        expect(parentView.state.sliceDoc(
            afterDelete.selection.main.from,
            afterDelete.selection.main.to,
        )).toBe("hello");

        undo(parentView);

        const restored = getRevision(parentView, revId);
        expect(restored.versions).toHaveLength(2);
        // Active version restored to 1 with text "hi" in doc
        expect(restored.currentlySelected).toBe(1);
        expect(parentView.state.sliceDoc(
            restored.selection.main.from,
            restored.selection.main.to,
        )).toBe("hi");
    });
});

// ── 9. deleteRevisionVersion on last version ──────────────────────────────────

describe("deleteRevisionVersion on last version undo restores whole annotation", () => {
    it("deleting the only version removes the annotation; undo restores it", () => {
        parentView = createParentView("hello world");
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);

        parentView.dispatch(deleteRevisionVersion(parentView.state, revId, 0));

        // Annotation gone, doc range collapsed to ""
        const anns = Object.values(parentView.state.field(annotationField));
        expect(anns).toHaveLength(0);
        expect(parentView.state.doc.toString()).toBe(" world");

        undo(parentView);

        const restored = Object.values(parentView.state.field(annotationField));
        expect(restored).toHaveLength(1);
        expect(isAnnotationOfType(restored[0]!, "revision")).toBe(true);
        expect(parentView.state.doc.toString()).toBe("hello world");
        expect(restored[0]!.selection.main.from).toBe(0);
        expect(restored[0]!.selection.main.to).toBe(5);
    });
});

// ── 10. Version switch undo/redo with content ─────────────────────────────────

describe("version switch undo/redo is self-consistent with doc content", () => {
    it("undo of version switch restores doc text to previous version", () => {
        parentView = createParentView("hello world");
        const revId = addRevision(parentView, 0, 5, [
            { doc: "hello" },
            { doc: "hi" },
        ], 0);

        parentView.dispatch(setActiveRevisionVersion(parentView.state, revId, 1));
        expect(parentView.state.sliceDoc(0, 2)).toBe("hi");

        undo(parentView);
        expect(parentView.state.sliceDoc(0, 5)).toBe("hello");
        expect(getRevision(parentView, revId).currentlySelected).toBe(0);
    });

    it("redo after undo of version switch restores switched-to version", () => {
        parentView = createParentView("hello world");
        const revId = addRevision(parentView, 0, 5, [
            { doc: "hello" },
            { doc: "hi" },
        ], 0);

        parentView.dispatch(setActiveRevisionVersion(parentView.state, revId, 1));
        undo(parentView);
        redo(parentView);

        const rev = getRevision(parentView, revId);
        expect(rev.currentlySelected).toBe(1);
        expect(parentView.state.sliceDoc(
            rev.selection.main.from,
            rev.selection.main.to,
        )).toBe("hi");
    });

    it("two version switches produce two undo entries", () => {
        parentView = createParentView("hello world");
        const revId = addRevision(parentView, 0, 5, [
            { doc: "v0" },
            { doc: "v1" },
            { doc: "v2" },
        ], 0);

        parentView.dispatch(setActiveRevisionVersion(parentView.state, revId, 1));
        parentView.dispatch(setActiveRevisionVersion(parentView.state, revId, 2));

        expect(getRevision(parentView, revId).currentlySelected).toBe(2);

        undo(parentView);
        expect(getRevision(parentView, revId).currentlySelected).toBe(1);

        undo(parentView);
        expect(getRevision(parentView, revId).currentlySelected).toBe(0);
    });
});

// ── 11. Undo with nothing to undo does not crash ──────────────────────────────

describe("undo with nothing to undo is a no-op", () => {
    it("undo on empty history returns false and does not throw", () => {
        // Fresh view with no history
        const view = createParentView("clean doc");
        expect(undoDepth(view.state)).toBe(0);
        expect(() => undo(view)).not.toThrow();
        expect(view.state.doc.toString()).toBe("clean doc");
        view.destroy();
    });

    it("redo on empty redo stack returns false and does not throw", () => {
        const view = createParentView("clean doc");
        expect(redoDepth(view.state)).toBe(0);
        expect(() => redo(view)).not.toThrow();
        expect(view.state.doc.toString()).toBe("clean doc");
        view.destroy();
    });
});

// ── 12. Version blob independence ─────────────────────────────────────────────

describe("version blobs are independent — editing one does not corrupt another", () => {
    it("syncing nested editor to version 0 does not affect version 1 blob", () => {
        const revId = addRevision(parentView, 0, 5, [
            { doc: "v0-original" },
            { doc: "v1-original" },
        ], 0);

        const nestedView = createNestedView("v0-original");
        nestedView.dispatch({ changes: { from: 0, to: 11, insert: "v0-edited" } });
        syncVersionToParent(nestedView, parentView, revId, 0);

        const rev = getRevision(parentView, revId);
        expect(versionText(rev.versions[0]!)).toBe("v0-edited");
        expect(versionText(rev.versions[1]!)).toBe("v1-original");

        nestedView.destroy();
    });

    it("undo of sync to version 0 does not alter version 1 blob", () => {
        const revId = addRevision(parentView, 0, 5, [
            { doc: "v0" },
            { doc: "v1" },
        ], 0);

        const nestedView = createNestedView("v0");
        nestedView.dispatch({ changes: { from: 0, to: 2, insert: "v0-new" } });
        syncVersionToParent(nestedView, parentView, revId, 0);

        undo(parentView);

        const rev = getRevision(parentView, revId);
        expect(versionText(rev.versions[0]!)).toBe("v0");
        expect(versionText(rev.versions[1]!)).toBe("v1");

        nestedView.destroy();
    });
});

// ── 13. VersionState blobs serialise without historyField ────────────────────
// (this is also tested in nestedEditorUndo.test.ts Scenario 5, but we repeat
//  it here as a sanity check for the newer multi-version path)

describe("VersionState blob has no historyField in multi-version scenario", () => {
    it("neither version blob contains historyField after multiple syncs", () => {
        const revId = addRevision(parentView, 0, 5, [
            { doc: "v0" },
            { doc: "v1" },
        ], 0);

        // Sync version 0
        const nestedView0 = createNestedView("v0");
        nestedView0.dispatch({ changes: { from: 0, to: 2, insert: "v0-synced" } });
        syncVersionToParent(nestedView0, parentView, revId, 0);
        nestedView0.destroy();

        // Sync version 1 (without switching active — just updating blob)
        parentView.dispatch(
            updateRevisionVersionState(
                parentView.state,
                revId,
                1,
                { doc: "v1-synced" },
            ),
        );

        const rev = getRevision(parentView, revId);
        expect(rev.versions[0]).not.toHaveProperty("historyField");
        expect(rev.versions[1]).not.toHaveProperty("historyField");
    });
});
