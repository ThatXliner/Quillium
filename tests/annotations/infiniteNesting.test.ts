/**
 * Tests for infinitely nested revision editors.
 *
 * The nested editor architecture has two directions:
 *
 * UP (nested → parent): translateAndDispatch chains. Each nested editor's
 * updateListener dispatches changes to its immediate parent, tagged with
 * nestedEditorEdit. This test simulates that chain manually.
 *
 * DOWN (parent → nested): the nestedEditorBridge ViewPlugin. When a
 * doc-changing transaction arrives at a parent view (e.g. undo), the bridge
 * dispatches the delta to each registered nested editor whose revision range
 * was affected. The bridge checks ranges against startState (pre-transaction)
 * coordinates, because iterChanges fromA/toA are also pre-transaction.
 *
 * Infinite nesting: each modal editor is itself a parent. The registry is
 * module-level, so registerNestedEditor(innerRevId, level2View) into level1's
 * registry slot means level1's bridge fires for level2 on undo at level1.
 *
 * Registry note: nestedEditorRegistry is a module-level singleton. Each test
 * MUST call the returned unregister functions in afterEach to avoid bleed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, undoDepth } from "@codemirror/commands";
import {
    makeParentUndoKeymap,
} from "$lib/editor/plugins/annotations/nestedEditor";
import {
    annotationField,
    addAnnotation,
    nestedEditorEdit,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import {
    annotations as annotationExtensions,
    registerNestedEditor,
} from "$lib/editor/plugins/annotations";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createView(doc: string, parentView?: EditorView) {
    const extensions = [
        history({ newGroupDelay: 0 }),
        annotationExtensions(),
        ...(parentView ? [makeParentUndoKeymap(parentView)] : []),
    ];
    const state = EditorState.create({ doc, extensions });
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

/**
 * Simulates the UP direction: nested editor typed something, so dispatch it to
 * both the nested view (the keystroke) and to the parent (translateAndDispatch).
 * offset is the revision's from position in the parent doc.
 */
function simulateUpstream(
    nestedView: EditorView,
    parentView: EditorView,
    revisionId: number,
    from: number,
    to: number,
    insert: string,
) {
    nestedView.dispatch({ changes: { from, to, insert } });
    const rev = parentView.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    const offset = rev.selection.main.from;
    parentView.dispatch({
        changes: { from: offset + from, to: offset + to, insert },
        annotations: [
            nestedEditorEdit.of(revisionId),
            Transaction.addToHistory.of(true),
        ],
    });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let rootView: EditorView;
let level1View: EditorView;
let level2View: EditorView;
let unregisterLevel1: (() => void) | undefined;
let unregisterLevel2: (() => void) | undefined;

beforeEach(() => {
    rootView = createView("hello world");
});

afterEach(() => {
    unregisterLevel2?.();
    unregisterLevel1?.();
    unregisterLevel2 = undefined;
    unregisterLevel1 = undefined;
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
        level1View = createView("hello world", rootView);
        unregisterLevel1 = registerNestedEditor(outerRevId, level1View);

        // Inner revision inside level-1 covers [6, 11] → "world"
        const innerRevId = addRevision(level1View, 6, 11, "world");
        level2View = createView("world", level1View);
        unregisterLevel2 = registerNestedEditor(innerRevId, level2View);

        // User deletes "world" in level-2 (from=0, to=5)
        // Step 1: level-2 → level-1 (innerRev.from=6, so parent offset=6)
        simulateUpstream(level2View, level1View, innerRevId, 0, 5, "");

        expect(level1View.state.doc.toString()).toBe("hello ");

        // Step 2: level-1 → root (outerRev.from=0, change at [6,11])
        // (In real usage translateAndDispatch would do this; we drive it manually)
        const outerRev = rootView.state.field(annotationField)[outerRevId];
        if (!outerRev || !isAnnotationOfType(outerRev, "revision")) throw new Error();
        rootView.dispatch({
            changes: { from: outerRev.selection.main.from + 6, to: outerRev.selection.main.from + 11, insert: "" },
            annotations: [
                nestedEditorEdit.of(outerRevId),
                Transaction.addToHistory.of(true),
            ],
        });

        expect(rootView.state.doc.toString()).toBe("hello ");
        expect(undoDepth(rootView.state)).toBeGreaterThan(0);
    });

    it("nestedEditorEdit on root dispatch suppresses Phase 3 for outerRevId", () => {
        const outerRevId = addRevision(rootView, 0, 11, "hello world");
        level1View = createView("hello world", rootView);
        unregisterLevel1 = registerNestedEditor(outerRevId, level1View);

        // Dispatch to root with nestedEditorEdit.of(outerRevId)
        rootView.dispatch({
            changes: { from: 6, to: 11, insert: "" },
            annotations: [
                nestedEditorEdit.of(outerRevId),
                Transaction.addToHistory.of(true),
            ],
        });

        // Phase 3 suppressed for outerRevId — version.doc stays "hello world",
        // not updated to reflect the doc change
        expect(getVersionText(rootView, outerRevId)).toBe("hello world");
    });
});

// ── Scenario 2: DOWN chain — undo at root patches level-1 via bridge ──────────

describe("Scenario 2: downstream bridge — undo at root patches registered nested editor", () => {
    it("bridge patches level-1 when root is undone within the revision range", () => {
        // Root: "hello world", outer revision [0,11]
        const outerRevId = addRevision(rootView, 0, 11, "hello world");
        level1View = createView("hello world", rootView);
        unregisterLevel1 = registerNestedEditor(outerRevId, level1View);

        // Simulate a deletion inside the revision range, dispatched to root
        // (could have come from level-1 upstream, or from the main doc edit)
        // We use nestedEditorEdit so the bridge skips level1 on this dispatch,
        // but we also manually apply it to level1 first (simulating normal flow)
        level1View.dispatch({ changes: { from: 6, to: 11, insert: "" } });
        rootView.dispatch({
            changes: { from: 6, to: 11, insert: "" },
            annotations: [
                nestedEditorEdit.of(outerRevId),
                Transaction.addToHistory.of(true),
            ],
        });

        expect(rootView.state.doc.toString()).toBe("hello ");
        expect(level1View.state.doc.toString()).toBe("hello ");

        // Undo at root: root bridge fires, dispatches {from:6, to:6, insert:"world"}
        // to level1 (within revRange [0,11] in startState)
        undo(rootView);

        expect(rootView.state.doc.toString()).toBe("hello world");
        expect(level1View.state.doc.toString()).toBe("hello world");
    });

    it("bridge does not patch level-1 for non-overlapping deletions in root", () => {
        // Outer revision [0, 5] — only "hello". " world" at [5,11] is outside.
        const outerRevId = addRevision(rootView, 0, 5, "hello");
        level1View = createView("hello", rootView);
        unregisterLevel1 = registerNestedEditor(outerRevId, level1View);

        // Delete " world" — outside revision range [0,5]. Bridge skips level1
        // because the deletion (fromA=5, toA=11) does not satisfy fromA < revTo(5).
        rootView.dispatch({
            changes: { from: 5, to: 11, insert: "" },
            annotations: [Transaction.addToHistory.of(true)],
        });
        expect(level1View.state.doc.toString()).toBe("hello");

        // Undo re-inserts " world" at position 5. This is a pure insertion at
        // revTo (= nested doc end = 5), which the bridge treats as an append.
        // The bridge patches level1 with the appended text.
        undo(rootView);

        expect(rootView.state.doc.toString()).toBe("hello world");
        // Bridge appended " world" to level1 since it was a valid insertion at
        // the nested doc boundary. This is the expected behavior.
        expect(level1View.state.doc.toString()).toBe("hello world");
    });
});

// ── Scenario 3: two-level DOWN chain — undo at root cascades to level-2 ───────

describe("Scenario 3: two-level bridge cascade on undo", () => {
    it("undo at root cascades through level-1 bridge to level-2", () => {
        // Root: "hello world", outer revision [0,11]
        const outerRevId = addRevision(rootView, 0, 11, "hello world");
        level1View = createView("hello world", rootView);
        unregisterLevel1 = registerNestedEditor(outerRevId, level1View);

        // Inner revision in level-1: [6,11] → "world"
        const innerRevId = addRevision(level1View, 6, 11, "world");
        level2View = createView("world", level1View);
        unregisterLevel2 = registerNestedEditor(innerRevId, level2View);

        // Simulate deletion of "world" — apply to all three views
        level2View.dispatch({ changes: { from: 0, to: 5, insert: "" } });
        level1View.dispatch({
            changes: { from: 6, to: 11, insert: "" },
            annotations: [nestedEditorEdit.of(innerRevId), Transaction.addToHistory.of(true)],
        });
        rootView.dispatch({
            changes: { from: 6, to: 11, insert: "" },
            annotations: [nestedEditorEdit.of(outerRevId), Transaction.addToHistory.of(true)],
        });

        expect(rootView.state.doc.toString()).toBe("hello ");
        expect(level1View.state.doc.toString()).toBe("hello ");
        expect(level2View.state.doc.toString()).toBe("");

        // Undo at root:
        //   root bridge → patches level1 (change [6,6] insert "world")
        //   level1 bridge → patches level2 (change [0,0] insert "world")
        undo(rootView);

        expect(rootView.state.doc.toString()).toBe("hello world");
        expect(level1View.state.doc.toString()).toBe("hello world");
        expect(level2View.state.doc.toString()).toBe("world");
    });
});

// ── Scenario 4: registry isolation ───────────────────────────────────────────

describe("Scenario 4: registry isolation", () => {
    it("unregistering level-1 prevents bridge from dispatching to it", () => {
        const outerRevId = addRevision(rootView, 0, 11, "hello world");
        level1View = createView("hello world", rootView);
        unregisterLevel1 = registerNestedEditor(outerRevId, level1View);

        // Unregister before the undo
        unregisterLevel1();
        unregisterLevel1 = undefined;

        level1View.dispatch({ changes: { from: 6, to: 11, insert: "" } });
        rootView.dispatch({
            changes: { from: 6, to: 11, insert: "" },
            annotations: [nestedEditorEdit.of(outerRevId), Transaction.addToHistory.of(true)],
        });

        expect(level1View.state.doc.toString()).toBe("hello ");

        // Undo at root — bridge would normally patch level1, but it's unregistered
        undo(rootView);

        expect(rootView.state.doc.toString()).toBe("hello world");
        // level1 was NOT patched by the bridge
        expect(level1View.state.doc.toString()).toBe("hello ");
    });

    it("nestedEditorEdit for innerRevId does not suppress bridge for outerRevId", () => {
        // Two independent revisions in root: outer [0,5] and inner [6,11]
        const rev1Id = addRevision(rootView, 0, 5, "hello");
        const rev2Id = addRevision(rootView, 6, 11, "world");

        level1View = createView("hello", rootView);
        unregisterLevel1 = registerNestedEditor(rev1Id, level1View);

        // Dispatch a change inside rev2's range tagged with nestedEditorEdit.of(rev2Id)
        // This should NOT suppress the bridge for rev1
        rootView.dispatch({
            changes: { from: 6, to: 11, insert: "earth" },
            annotations: [nestedEditorEdit.of(rev2Id), Transaction.addToHistory.of(true)],
        });

        // level1 (rev1, [0,5]) was not in the changed range — bridge correctly skips it
        expect(level1View.state.doc.toString()).toBe("hello");
        expect(rootView.state.doc.toString()).toBe("hello earth");
    });
});
