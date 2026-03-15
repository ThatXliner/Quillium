/**
 * Tests for infinitely nested revision editors (slice editor architecture).
 *
 * Each nested editor is a stateless viewport onto the parent document's
 * revision range. The nested editor owns no history and no persistent state.
 *
 * UP (nested → parent): dispatchTransactions intercepts doc changes, translates
 * to parent coordinates, and dispatches to parentView as a plain change.
 * parentSyncPlugin then echoes the updated parent slice back to the nested editor.
 *
 * DOWN (parent → nested): parentSyncPlugin, a ViewPlugin inside each nested
 * editor, watches parentView.state. When the parent doc changes such that the
 * revision slice differs from the nested doc, it applies a full-replace
 * (tagged _sliceBridgeDispatch) to the nested editor.
 *
 * Infinite nesting: each nested editor is itself a parentView for its own
 * nested editors. The mechanism is self-contained per level — no global
 * registry or bridge.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, undoDepth } from "@codemirror/commands";
import {
    makeParentUndoKeymap,
    createSliceEditor,
    destroySliceEditor,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function createRootView(doc: string): EditorView {
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
        currentlySelected: 0,
        versions: [{ doc }],
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

function getVersionText(view: EditorView, revisionId: number): string {
    const rev = view.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) {
        throw new Error(`No revision ${revisionId}`);
    }
    return versionText(rev.versions[rev.currentlySelected]);
}

function getRevisionSlice(view: EditorView, revisionId: number): string {
    const rev = view.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error(`No revision ${revisionId}`);
    return view.state.doc.sliceString(rev.selection.main.from, rev.selection.main.to);
}

/**
 * Simulates a nested editor edit dispatched directly to the parent as a plain
 * change (the slice editor architecture — no special annotations).
 */
function simulateNestedEdit(
    parentView: EditorView,
    revisionId: number,
    from: number,
    to: number,
    insert: string,
) {
    const rev = parentView.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    const offset = rev.selection.main.from;
    parentView.dispatch({
        changes: { from: offset + from, to: offset + to, insert },
        annotations: [Transaction.addToHistory.of(true)],
    });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let rootView: EditorView;
let level1View: EditorView;
let level2View: EditorView;

beforeEach(() => {
    rootView = createRootView("hello world");
});

afterEach(() => {
    level2View?.destroy();
    level1View?.destroy();
    rootView.destroy();
});

// ── Scenario 1: UP chain — edit propagates from level-2 to root ───────────────

describe("Scenario 1: upstream chain — level-2 edit reaches root", () => {
    it("root doc reflects the deletion dispatched from level-2 via level-1", () => {
        // Root doc: "hello world" (11 chars)
        // Outer revision covers [0, 11] with version text "hello world"
        const outerRevId = addRevision(rootView, 0, 11, "hello world");
        const el1 = document.createElement("div");
        document.body.appendChild(el1);
        level1View = createSliceEditor(outerRevId, rootView, { doc: "hello world" }, el1, () => {});

        // Inner revision inside level-1 covers [6, 11] → "world"
        const innerRevId = addRevision(level1View, 6, 11, "world");
        const el2 = document.createElement("div");
        document.body.appendChild(el2);
        level2View = createSliceEditor(innerRevId, level1View, { doc: "world" }, el2, () => {});

        // User deletes "world" in level-2
        // Step 1: level-2's dispatchTransactions forwards to level-1 (innerRev.from=6)
        // Step 2: level-1's dispatchTransactions forwards to root (outerRev.from=0)
        // We simulate this two-level dispatch manually
        simulateNestedEdit(level1View, innerRevId, 0, 5, "");

        // level1View now has "hello " at [0,6], and its edit got forwarded to root
        expect(level1View.state.doc.toString()).toBe("hello ");

        // Dispatch to root as well (simulates level-1's dispatchTransactions)
        simulateNestedEdit(rootView, outerRevId, 6, 11, "");

        expect(rootView.state.doc.toString()).toBe("hello ");
        expect(undoDepth(rootView.state)).toBeGreaterThan(0);
    });

    it("plain nested edit dispatched to root runs Phase 3 and updates version.doc", () => {
        const outerRevId = addRevision(rootView, 0, 11, "hello world");

        // Dispatch to root directly (slice editor style — no special tags)
        simulateNestedEdit(rootView, outerRevId, 6, 11, "");

        // Phase 3 runs for all doc changes — version.doc is synced from parent slice
        expect(getVersionText(rootView, outerRevId)).toBe("hello ");
    });
});

// ── Scenario 2: DOWN chain — undo at root patches level-1 via parentSyncPlugin ─

describe("Scenario 2: downstream sync — undo at root patches registered nested editor", () => {
    it("parentSyncPlugin patches level-1 when root is undone within the revision range", () => {
        // Root: "hello world", outer revision [0,11]
        const outerRevId = addRevision(rootView, 0, 11, "hello world");
        const el1 = document.createElement("div");
        document.body.appendChild(el1);
        level1View = createSliceEditor(outerRevId, rootView, { doc: "hello world" }, el1, () => {});

        // Simulate a deletion inside the revision range dispatched to root
        simulateNestedEdit(rootView, outerRevId, 6, 11, "");

        expect(rootView.state.doc.toString()).toBe("hello ");
        // parentSyncPlugin inside level1View should have synced
        expect(level1View.state.doc.toString()).toBe("hello ");

        // Undo at root: parentSyncPlugin inside level1View detects parent changed
        // and re-syncs level1 to the new parent slice
        undo(rootView);

        expect(rootView.state.doc.toString()).toBe("hello world");
        expect(level1View.state.doc.toString()).toBe("hello world");
    });

    it("parentSyncPlugin does not patch level-1 for changes outside the revision range", () => {
        // Outer revision [0, 5] — only "hello". " world" at [5,11] is outside.
        const outerRevId = addRevision(rootView, 0, 5, "hello");
        const el1 = document.createElement("div");
        document.body.appendChild(el1);
        level1View = createSliceEditor(outerRevId, rootView, { doc: "hello" }, el1, () => {});

        // Delete " world" — outside revision range [0,5]
        rootView.dispatch({
            changes: { from: 5, to: 11, insert: "" },
            annotations: [Transaction.addToHistory.of(true)],
        });

        // parentSyncPlugin compares parent slice [0,5] against nested doc "hello"
        // — they're identical, so no patch is applied
        expect(level1View.state.doc.toString()).toBe("hello");

        // Undo re-inserts " world" at position 5 — still outside revision range
        undo(rootView);

        expect(rootView.state.doc.toString()).toBe("hello world");
        // Parent slice for revision [0,5] is still "hello" — level1 unchanged
        expect(level1View.state.doc.toString()).toBe("hello");
    });
});

// ── Scenario 3: two-level DOWN chain — undo at root cascades to level-2 ───────

describe("Scenario 3: two-level sync cascade on undo", () => {
    it("undo at root cascades through level-1 parentSyncPlugin to level-2", () => {
        // Root: "hello world", outer revision [0,11]
        const outerRevId = addRevision(rootView, 0, 11, "hello world");
        const el1 = document.createElement("div");
        document.body.appendChild(el1);
        level1View = createSliceEditor(outerRevId, rootView, { doc: "hello world" }, el1, () => {});

        // Inner revision in level-1: [6,11] → "world"
        const innerRevId = addRevision(level1View, 6, 11, "world");
        const el2 = document.createElement("div");
        document.body.appendChild(el2);
        level2View = createSliceEditor(innerRevId, level1View, { doc: "world" }, el2, () => {});

        // Simulate deletion of "world" — dispatched to root (level-1 parentSyncPlugin
        // will propagate the updated slice to level-1; level-2 parentSyncPlugin will
        // then propagate further)
        simulateNestedEdit(rootView, outerRevId, 6, 11, "");

        expect(rootView.state.doc.toString()).toBe("hello ");
        expect(level1View.state.doc.toString()).toBe("hello ");
        // level2 shows empty (level1 no longer has "world" at [6,11])
        expect(level2View.state.doc.toString()).toBe("");

        // Undo at root:
        //   root reverts to "hello world"
        //   level1 parentSyncPlugin detects parent slice changed → patches level1
        //   level2 parentSyncPlugin detects level1 (its parent) changed → patches level2
        undo(rootView);

        expect(rootView.state.doc.toString()).toBe("hello world");
        expect(level1View.state.doc.toString()).toBe("hello world");
        expect(level2View.state.doc.toString()).toBe("world");
    });
});

// ── Scenario 4: destroying level-1 isolates it from further parent changes ────

describe("Scenario 4: destroy isolates nested editor", () => {
    it("destroyed level-1 is not updated after undo", () => {
        const outerRevId = addRevision(rootView, 0, 11, "hello world");
        const el1 = document.createElement("div");
        document.body.appendChild(el1);
        level1View = createSliceEditor(outerRevId, rootView, { doc: "hello world" }, el1, () => {});

        simulateNestedEdit(rootView, outerRevId, 6, 11, "");

        expect(level1View.state.doc.toString()).toBe("hello ");

        // Destroy level1 — parentSyncPlugin stops running
        destroySliceEditor(level1View, rootView, outerRevId);
        level1View = undefined as unknown as EditorView; // prevent afterEach double-destroy

        // Undo at root — level1 is destroyed so no crash, just root changes
        undo(rootView);
        expect(rootView.state.doc.toString()).toBe("hello world");
    });

    it("nestedEditorEdit for a different revision does not affect unrelated nested editor", () => {
        // Two independent revisions in root: rev1 [0,5] and rev2 [6,11]
        const rev1Id = addRevision(rootView, 0, 5, "hello");
        const rev2Id = addRevision(rootView, 6, 11, "world");

        const el1 = document.createElement("div");
        document.body.appendChild(el1);
        level1View = createSliceEditor(rev1Id, rootView, { doc: "hello" }, el1, () => {});

        // Dispatch a change inside rev2's range — should not affect level1
        rootView.dispatch({
            changes: { from: 6, to: 11, insert: "earth" },
            annotations: [Transaction.addToHistory.of(true)],
        });

        // level1 parentSyncPlugin checks slice [0,5] = "hello" — unchanged
        expect(level1View.state.doc.toString()).toBe("hello");
        expect(rootView.state.doc.toString()).toBe("hello earth");
    });
});

// ── Scenario 5: no echo loop from parentSyncPlugin back to root ───────────────

describe("Scenario 5: parentSyncPlugin does not echo back to parent", () => {
    it("undo at root patches level-1 exactly once (no echo back to parent)", () => {
        const outerRevId = addRevision(rootView, 0, 11, "hello world");
        const el1 = document.createElement("div");
        document.body.appendChild(el1);
        level1View = createSliceEditor(outerRevId, rootView, { doc: "hello world" }, el1, () => {});

        simulateNestedEdit(rootView, outerRevId, 6, 11, "");

        const depthBeforeUndo = undoDepth(rootView.state);

        // Undo: root doc reverts. parentSyncPlugin applies _sliceBridgeDispatch
        // to nested editor (tagged, so dispatchTransactions applies locally only).
        // No echo back to parent.
        undo(rootView);

        // Depth must decrease by exactly 1 — no extra entries from echo loop
        expect(undoDepth(rootView.state)).toBe(depthBeforeUndo - 1);
        expect(rootView.state.doc.toString()).toBe("hello world");
        expect(level1View.state.doc.toString()).toBe("hello world");
    });

    it("typing in level-1 creates exactly one root history entry per dispatch", () => {
        const outerRevId = addRevision(rootView, 0, 11, "hello world");
        const el1 = document.createElement("div");
        document.body.appendChild(el1);
        level1View = createSliceEditor(outerRevId, rootView, { doc: "hello world" }, el1, () => {});

        const depthBefore = undoDepth(rootView.state);

        // Simulate three nested edits dispatched to root
        for (const ch of ["!", "?", "."]) {
            simulateNestedEdit(rootView, outerRevId, 11, 11, ch);
            // Keep outerRevId's to-position consistent with the now-updated parent
        }

        // Should be exactly 3 new entries — one per dispatch, not 6
        expect(undoDepth(rootView.state)).toBe(depthBefore + 3);
    });
});
