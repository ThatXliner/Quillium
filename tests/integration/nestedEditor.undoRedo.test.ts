/**
 * Integration tests for undo/redo consistency when the nested revision editor
 * is involved. These cover scenarios where the parent doc, revision annotation
 * range, and stored version.doc can fall out of sync.
 *
 * Bug report: undo/redo sometimes gets out of sync when edits are made via
 * the nested revision editor — particularly when interleaving nested edits
 * with parent edits, performing multiple sequential undos/redos, or switching
 * versions and then editing.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import {
    annotationField,
    addAnnotation,
    nestedEditorEdit,
    _nestedEditRevision,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createView(doc = "hello") {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

/** Add a revision annotation and return its id. */
function addRevision(
    view: EditorView,
    from: number,
    to: number,
    versions: { doc: string }[],
    currentlySelected = 0,
): number {
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        currentlySelected,
        versions,
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

/**
 * Simulate a nested editor edit: dispatch to parent with nestedEditorEdit tag
 * at the correct absolute offset. `from`/`to` are positions within the
 * revision's content (relative to rev.selection.main.from).
 */
function simulateNestedEdit(
    view: EditorView,
    revisionId: number,
    from: number,
    to: number,
    insert: string,
) {
    const rev = view.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) {
        throw new Error(`No revision ${revisionId}`);
    }
    const offset = rev.selection.main.from;
    view.dispatch({
        changes: { from: offset + from, to: offset + to, insert },
        effects: [_nestedEditRevision.of(revisionId)],
        annotations: [
            nestedEditorEdit.of(revisionId),
            Transaction.addToHistory.of(true),
        ],
    });
}

/** Get the active version's text from the annotationField. */
function getVersionDoc(view: EditorView, revisionId: number): string {
    const rev = view.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) {
        throw new Error(`No revision ${revisionId}`);
    }
    return versionText(rev.versions[rev.currentlySelected]);
}

/** Get the text under the revision range in the parent doc. */
function getRevisionSlice(view: EditorView, revisionId: number): string {
    const rev = view.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) {
        throw new Error(`No revision ${revisionId}`);
    }
    return view.state.doc
        .slice(rev.selection.main.from, rev.selection.main.to)
        .toString();
}

// ── State ─────────────────────────────────────────────────────────────────────

let view: EditorView;

beforeEach(() => {
    view = createView("hello");
});

afterEach(() => {
    view.destroy();
});

// ── Scenario A: sequential nested edits, sequential undos ─────────────────────

describe("sequential nested edits followed by sequential undos", () => {
    it("version.doc matches doc slice at each undo step", () => {
        // State: "hello", revision at [0,5]
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Two nested edits: append " world", then append "!"
        simulateNestedEdit(view, revId, 5, 5, " world");
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello world");
        expect(getRevisionSlice(view, revId)).toBe("hello world");

        simulateNestedEdit(view, revId, 11, 11, "!");
        expect(view.state.doc.toString()).toBe("hello world!");
        expect(getVersionDoc(view, revId)).toBe("hello world!");
        expect(getRevisionSlice(view, revId)).toBe("hello world!");

        // Undo second edit
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        // version.doc must match what's in the doc — not the pre-undo value
        expect(getVersionDoc(view, revId)).toBe("hello world");
        expect(getRevisionSlice(view, revId)).toBe("hello world");

        // Undo first edit
        undo(view);
        expect(view.state.doc.toString()).toBe("hello");
        expect(getVersionDoc(view, revId)).toBe("hello");
        expect(getRevisionSlice(view, revId)).toBe("hello");
    });

    it("version.doc is correct after undo then redo", () => {
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        simulateNestedEdit(view, revId, 5, 5, " world");
        simulateNestedEdit(view, revId, 11, 11, "!");

        // Undo both
        undo(view);
        undo(view);
        expect(view.state.doc.toString()).toBe("hello");
        expect(getVersionDoc(view, revId)).toBe("hello");

        // Redo first edit
        redo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello world");
        expect(getRevisionSlice(view, revId)).toBe("hello world");

        // Redo second edit
        redo(view);
        expect(view.state.doc.toString()).toBe("hello world!");
        expect(getVersionDoc(view, revId)).toBe("hello world!");
        expect(getRevisionSlice(view, revId)).toBe("hello world!");
    });
});

// ── Scenario B: interleaved nested edit + parent edit + undo ──────────────────

describe("interleaved nested edit and parent-doc edit", () => {
    it("undoing parent edit does not corrupt version.doc", () => {
        // Parent: "hello world", revision on "hello" [0,5]
        view.destroy();
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Nested edit: "hello" → "hello!"
        simulateNestedEdit(view, revId, 5, 5, "!");
        expect(view.state.doc.toString()).toBe("hello! world");
        expect(getVersionDoc(view, revId)).toBe("hello!");

        // Parent edit outside revision: delete " world"
        view.dispatch({ changes: { from: 6, to: 12 } });
        expect(view.state.doc.toString()).toBe("hello!");
        expect(getVersionDoc(view, revId)).toBe("hello!");

        // Undo parent edit (restores " world")
        undo(view);
        expect(view.state.doc.toString()).toBe("hello! world");
        // version.doc should still be "hello!" — the revision range is [0,6]
        expect(getVersionDoc(view, revId)).toBe("hello!");
        expect(getRevisionSlice(view, revId)).toBe("hello!");

        // Undo nested edit (removes "!")
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");
        expect(getRevisionSlice(view, revId)).toBe("hello");
    });

    it("redo after interleaved edits restores doc and version.doc correctly", () => {
        view.destroy();
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Nested edit
        simulateNestedEdit(view, revId, 5, 5, "!");
        // Parent edit outside revision
        view.dispatch({ changes: { from: 6, to: 12 } });

        // Undo both
        undo(view);
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");

        // Redo nested edit
        redo(view);
        expect(view.state.doc.toString()).toBe("hello! world");
        expect(getVersionDoc(view, revId)).toBe("hello!");
        expect(getRevisionSlice(view, revId)).toBe("hello!");

        // Redo parent edit
        redo(view);
        expect(view.state.doc.toString()).toBe("hello!");
        expect(getVersionDoc(view, revId)).toBe("hello!");
        expect(getRevisionSlice(view, revId)).toBe("hello!");
    });
});

// ── Scenario C: nested edit then parent edit BEFORE revision, then undo ───────

describe("parent edit before revision followed by undo", () => {
    it("revision range shifts correctly and version.doc stays in sync", () => {
        // "prefix hello" — revision on "hello" at [7, 12]
        view.destroy();
        view = createView("prefix hello");
        const revId = addRevision(view, 7, 12, [{ doc: "hello" }]);

        // Nested edit: "hello" → "hi"
        simulateNestedEdit(view, revId, 0, 5, "hi");
        expect(view.state.doc.toString()).toBe("prefix hi");
        expect(getVersionDoc(view, revId)).toBe("hi");
        expect(getRevisionSlice(view, revId)).toBe("hi");

        // Parent edit before revision: delete "prefix " [0, 7]
        view.dispatch({ changes: { from: 0, to: 7 } });
        expect(view.state.doc.toString()).toBe("hi");
        // revision now at [0, 2]
        const rev = view.state.field(annotationField)[revId];
        if (rev && isAnnotationOfType(rev, "revision")) {
            expect(rev.selection.main.from).toBe(0);
            expect(rev.selection.main.to).toBe(2);
        }
        expect(getVersionDoc(view, revId)).toBe("hi");

        // Undo parent deletion
        undo(view);
        expect(view.state.doc.toString()).toBe("prefix hi");
        const rev2 = view.state.field(annotationField)[revId];
        if (rev2 && isAnnotationOfType(rev2, "revision")) {
            expect(rev2.selection.main.from).toBe(7);
            expect(rev2.selection.main.to).toBe(9);
        }
        expect(getVersionDoc(view, revId)).toBe("hi");

        // Undo nested edit
        undo(view);
        expect(view.state.doc.toString()).toBe("prefix hello");
        const rev3 = view.state.field(annotationField)[revId];
        if (rev3 && isAnnotationOfType(rev3, "revision")) {
            expect(rev3.selection.main.from).toBe(7);
            expect(rev3.selection.main.to).toBe(12);
        }
        expect(getVersionDoc(view, revId)).toBe("hello");
    });
});

// ── Scenario D: multi-version revision — nested edit then version switch + undo

describe("version switch after nested edit — undo restores correctly", () => {
    it("undo of version switch restores the previously edited version doc", () => {
        // revision with two versions; active = version 0 = "hello"
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        // Nested edit on version 0: "hello" → "hello!"
        simulateNestedEdit(view, revId, 5, 5, "!");
        expect(view.state.doc.toString()).toBe("hello!");
        expect(getVersionDoc(view, revId)).toBe("hello!");

        // Switch to version 1 ("hi")
        view.dispatch(setActiveRevisionVersion(view.state, revId, 1));
        expect(view.state.doc.toString()).toBe("hi");
        expect(getVersionDoc(view, revId)).toBe("hi");

        // Undo version switch — should go back to version 0 = "hello!"
        undo(view);
        expect(view.state.doc.toString()).toBe("hello!");
        expect(getVersionDoc(view, revId)).toBe("hello!");

        // Undo nested edit — should revert to "hello"
        undo(view);
        expect(view.state.doc.toString()).toBe("hello");
        expect(getVersionDoc(view, revId)).toBe("hello");
    });

    it("redo of version switch after full undo restores the switched version", () => {
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        // Edit version 0, then switch to version 1
        simulateNestedEdit(view, revId, 5, 5, "!");
        view.dispatch(setActiveRevisionVersion(view.state, revId, 1));

        // Undo both
        undo(view); // undo version switch
        undo(view); // undo nested edit

        expect(view.state.doc.toString()).toBe("hello");
        expect(getVersionDoc(view, revId)).toBe("hello");

        // Redo nested edit
        redo(view);
        expect(view.state.doc.toString()).toBe("hello!");
        expect(getVersionDoc(view, revId)).toBe("hello!");

        // Redo version switch
        redo(view);
        expect(view.state.doc.toString()).toBe("hi");
        expect(getVersionDoc(view, revId)).toBe("hi");
    });
});

// ── Scenario E: nested edit on the second of two revisions ───────────────────

describe("two revisions — edit one, undo, verify the other is unaffected", () => {
    it("undoing a nested edit on one revision does not corrupt the other", () => {
        // "aaa bbb" — rev1 on "aaa" [0,3], rev2 on "bbb" [4,7]
        view.destroy();
        view = createView("aaa bbb");
        const rev1Id = addRevision(view, 0, 3, [{ doc: "aaa" }]);
        const rev2Id = addRevision(view, 4, 7, [{ doc: "bbb" }]);

        // Edit rev2: "bbb" → "BBB"
        simulateNestedEdit(view, rev2Id, 0, 3, "BBB");
        expect(view.state.doc.toString()).toBe("aaa BBB");
        expect(getVersionDoc(view, rev2Id)).toBe("BBB");
        expect(getVersionDoc(view, rev1Id)).toBe("aaa");

        // Undo
        undo(view);
        expect(view.state.doc.toString()).toBe("aaa bbb");
        expect(getVersionDoc(view, rev2Id)).toBe("bbb");
        // rev1 should be completely unaffected
        expect(getVersionDoc(view, rev1Id)).toBe("aaa");
        expect(getRevisionSlice(view, rev1Id)).toBe("aaa");
    });
});

// ── Scenario F: nested edit after parent inserted text before revision ─────────

describe("insert before revision then nested edit then undo in order", () => {
    it("both undos restore correct state", () => {
        // "hello" — revision at [0,5]
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Parent inserts "PREFIX " before revision
        view.dispatch({ changes: { from: 0, insert: "PREFIX " } });
        // revision shifts to [7, 12]
        expect(view.state.doc.toString()).toBe("PREFIX hello");
        expect(getVersionDoc(view, revId)).toBe("hello");

        // Nested edit: "hello" → "HELLO" (replace all 5 chars)
        simulateNestedEdit(view, revId, 0, 5, "HELLO");
        expect(view.state.doc.toString()).toBe("PREFIX HELLO");
        expect(getVersionDoc(view, revId)).toBe("HELLO");

        // Undo nested edit
        undo(view);
        expect(view.state.doc.toString()).toBe("PREFIX hello");
        expect(getVersionDoc(view, revId)).toBe("hello");
        expect(getRevisionSlice(view, revId)).toBe("hello");

        // Undo parent insert
        undo(view);
        expect(view.state.doc.toString()).toBe("hello");
        expect(getVersionDoc(view, revId)).toBe("hello");
        expect(getRevisionSlice(view, revId)).toBe("hello");
    });
});

// ── Scenario G: undo depth consistency — no phantom history entries ────────────

describe("undo depth stays consistent across nested edits", () => {
    it("each nested edit adds exactly one undo entry", () => {
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        const depthAfterAnnotation = undoDepth(view.state);

        simulateNestedEdit(view, revId, 5, 5, " world");
        expect(undoDepth(view.state)).toBe(depthAfterAnnotation + 1);

        simulateNestedEdit(view, revId, 11, 11, "!");
        expect(undoDepth(view.state)).toBe(depthAfterAnnotation + 2);
    });

    it("undo reduces depth by exactly 1 per call", () => {
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);
        simulateNestedEdit(view, revId, 5, 5, " world");
        simulateNestedEdit(view, revId, 11, 11, "!");

        const depthBefore = undoDepth(view.state);

        undo(view);
        expect(undoDepth(view.state)).toBe(depthBefore - 1);

        undo(view);
        expect(undoDepth(view.state)).toBe(depthBefore - 2);
    });

    it("redo depth increases as we undo and decreases as we redo", () => {
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);
        simulateNestedEdit(view, revId, 5, 5, " world");
        simulateNestedEdit(view, revId, 11, 11, "!");

        expect(redoDepth(view.state)).toBe(0);

        undo(view);
        expect(redoDepth(view.state)).toBe(1);

        undo(view);
        expect(redoDepth(view.state)).toBe(2);

        redo(view);
        expect(redoDepth(view.state)).toBe(1);

        redo(view);
        expect(redoDepth(view.state)).toBe(0);
    });
});

// ── Scenario I: type then partially delete in nested editor, then undo ────────

describe("type then delete in nested editor, undo from parent", () => {
    it("undo of deletion restores deleted text in doc and version.doc", () => {
        // revision at [0,5] = "hello"
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Type " world" at end → "hello world"
        simulateNestedEdit(view, revId, 5, 5, " world");
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello world");

        // Delete "orld" (nested delete: positions 7-11 in nested = parent 7-11)
        simulateNestedEdit(view, revId, 7, 11, "");
        expect(view.state.doc.toString()).toBe("hello w");
        expect(getVersionDoc(view, revId)).toBe("hello w");
        expect(getRevisionSlice(view, revId)).toBe("hello w");

        // Undo the deletion — should restore "hello world"
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello world");
        expect(getRevisionSlice(view, revId)).toBe("hello world");
    });

    it("two undos after type-then-delete in nested editor restore original doc", () => {
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Type " world" then delete "orld"
        simulateNestedEdit(view, revId, 5, 5, " world");
        simulateNestedEdit(view, revId, 7, 11, "");
        expect(view.state.doc.toString()).toBe("hello w");

        // Undo deletion
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello world");

        // Undo the original typing
        undo(view);
        expect(view.state.doc.toString()).toBe("hello");
        expect(getVersionDoc(view, revId)).toBe("hello");
        expect(getRevisionSlice(view, revId)).toBe("hello");
    });

    it("full delete of nested editor text then undo restores the text", () => {
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Type " world" → "hello world"
        simulateNestedEdit(view, revId, 5, 5, " world");
        // Delete all nested content (0 to 11)
        simulateNestedEdit(view, revId, 0, 11, "");
        expect(view.state.doc.toString()).toBe("");
        // revision survives collapsed
        const revAfterDelete = view.state.field(annotationField)[revId];
        expect(revAfterDelete).toBeDefined();

        // Undo deletion — "hello world" restored
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello world");
        expect(getRevisionSlice(view, revId)).toBe("hello world");
    });

    it("redo after undo of nested deletion works correctly", () => {
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        simulateNestedEdit(view, revId, 5, 5, " world");
        simulateNestedEdit(view, revId, 7, 11, "");
        expect(view.state.doc.toString()).toBe("hello w");

        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");

        redo(view);
        expect(view.state.doc.toString()).toBe("hello w");
        expect(getVersionDoc(view, revId)).toBe("hello w");
        expect(getRevisionSlice(view, revId)).toBe("hello w");
    });
});

// ── Scenario H: replace operation in nested editor (from > to) ───────────────

describe("nested editor replace (delete + insert at same position)", () => {
    it("undo of replace restores original text", () => {
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Replace "hello" with "world" via nested edit
        simulateNestedEdit(view, revId, 0, 5, "world");
        expect(view.state.doc.toString()).toBe("world");
        expect(getVersionDoc(view, revId)).toBe("world");

        undo(view);
        expect(view.state.doc.toString()).toBe("hello");
        expect(getVersionDoc(view, revId)).toBe("hello");
    });

    it("redo of replace brings back the replaced text", () => {
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        simulateNestedEdit(view, revId, 0, 5, "world");
        undo(view);

        redo(view);
        expect(view.state.doc.toString()).toBe("world");
        expect(getVersionDoc(view, revId)).toBe("world");
    });
});
