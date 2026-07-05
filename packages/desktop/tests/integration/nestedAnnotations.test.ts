/**
 * Integration tests for nested annotations — annotations created inside
 * revision modal nested editors, including multi-level nesting, deletion,
 * undo/redo, and version switching interactions.
 *
 * These tests exercise scenarios that are hard to reach with unit tests
 * because they involve the interplay between parent/child annotation fields,
 * version management, and the nested editor dispatch pipeline.
 */

import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    _nestedEditRevision,
    addAnnotation,
    annotationField,
    createNewRevision,
    deleteRevisionVersion,
    nestedEditorEdit,
    removeAnnotation,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type Annotation as AnnotationType,
    activeVersion,
    activeVersionIndex,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

function addComment(view: EditorView, from: number, to: number, message = "note") {
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "comment",
        ),
        thread: [{ message, author: "User", time: 1 }],
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

function addRevision(
    view: EditorView,
    from: number,
    to: number,
    versions: { doc: string }[],
    activeIndex = 0,
) {
    const builtVersions = versions.map((v) => makeVersion(v));
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionId: builtVersions[activeIndex].id,
        versions: builtVersions,
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

function getAnnotations(view: EditorView) {
    return Object.values(view.state.field(annotationField));
}

function getRevision(view: EditorView, id: number) {
    const ann = view.state.field(annotationField)[id];
    if (!ann || !isAnnotationOfType(ann, "revision")) return undefined;
    return ann;
}

/** Resolve a positional version index to its stable version id for a revision. */
function versionIdAt(view: EditorView, revisionId: number, index: number): string {
    const rev = getRevision(view, revisionId);
    if (!rev) throw new Error(`No revision ${revisionId}`);
    return rev.versions[index].id;
}

function getVersionDoc(view: EditorView, revisionId: number): string {
    const rev = getRevision(view, revisionId);
    if (!rev) throw new Error(`No revision ${revisionId}`);
    return versionText(activeVersion(rev));
}

function getRevisionSlice(view: EditorView, revisionId: number): string {
    const rev = getRevision(view, revisionId);
    if (!rev) throw new Error(`No revision ${revisionId}`);
    return view.state.doc.slice(rev.selection.main.from, rev.selection.main.to).toString();
}

/**
 * Simulate a nested editor edit: dispatch to parent with nestedEditorEdit
 * at the correct absolute offset.
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
        annotations: [nestedEditorEdit.of(revisionId), Transaction.addToHistory.of(true)],
    });
}

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
});

// ── Nested annotation creation (annotations inside revision content) ─────────

describe("creating annotations inside a revision's nested editor", () => {
    it("nested editor has its own independent annotation field", () => {
        // Create a view with a revision, then create a separate "nested" view
        // simulating what the modal does. Each has its own annotationField.
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Create a separate view representing the nested editor
        const nestedView = createView("hello");
        const nestedCommentId = addComment(nestedView, 0, 3, "nested comment");

        // The nested editor has its own annotation
        expect(getAnnotations(nestedView)).toHaveLength(1);
        // The parent editor only has the revision
        expect(getAnnotations(view)).toHaveLength(1);
        expect(isAnnotationOfType(getAnnotations(view)[0], "revision")).toBe(true);

        nestedView.destroy();
    });

    it("annotation IDs in nested editors are independent from parent", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);
        // Parent has annotation with ID = revId (likely 0)

        // Nested editor starts fresh — its first annotation also gets ID 0
        const nestedView = createView("hello");
        const nestedRevId = addRevision(nestedView, 0, 3, [{ doc: "hel" }]);

        // Both can have ID 0 without conflict
        expect(revId).toBe(0);
        expect(nestedRevId).toBe(0);
        expect(getAnnotations(view)).toHaveLength(1);
        expect(getAnnotations(nestedView)).toHaveLength(1);

        nestedView.destroy();
    });

    it("creating multiple annotations in nested editor does not affect parent", () => {
        view = createView("The quick brown fox");
        addRevision(view, 4, 9, [{ doc: "quick" }]);

        const nestedView = createView("quick");
        addComment(nestedView, 0, 2, "first");
        addComment(nestedView, 3, 5, "second");

        expect(getAnnotations(nestedView)).toHaveLength(2);
        expect(getAnnotations(view)).toHaveLength(1); // only the revision

        nestedView.destroy();
    });
});

// ── Deletion of revision with nested annotations ────────────────────────────

describe("deleting a revision that contains nested annotations", () => {
    it("removing a revision removes it cleanly from parent", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        view.dispatch(
            view.state.update({
                effects: [removeAnnotation.of(view.state.field(annotationField)[revId])],
            }),
        );

        expect(getAnnotations(view)).toHaveLength(0);
        expect(view.state.doc.toString()).toBe("hello world");
    });

    it("deleting text under a revision collapses it, resolver cleans up", async () => {
        view = createView("aaa hello bbb");
        const revId = addRevision(view, 4, 9, [{ doc: "hello" }]);

        // Delete "hello"
        view.dispatch({ changes: { from: 4, to: 9 } });
        expect(view.state.doc.toString()).toBe("aaa  bbb");

        // Before microtask: revision is collapsed
        const collapsed = getAnnotations(view);
        expect(collapsed).toHaveLength(1);
        expect(collapsed[0].selection.main.empty).toBe(true);

        // After microtask: resolver removes the collapsed revision
        await Promise.resolve();
        expect(getAnnotations(view)).toHaveLength(0);
    });

    it("undo after deletion restores revision with all versions", async () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        view.dispatch({ changes: { from: 0, to: 5 } });
        await Promise.resolve();
        expect(getAnnotations(view)).toHaveLength(0);

        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        if (isAnnotationOfType(anns[0], "revision")) {
            expect(anns[0].versions).toHaveLength(2);
            expect(anns[0].versions[0]?.doc).toBe("hello");
            expect(anns[0].versions[1]?.doc).toBe("hi");
        }
    });
});

// ── Version switching with nested edits ─────────────────────────────────────

describe("version switching combined with nested edits", () => {
    it("switching version replaces document text under revision range", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(view.state.doc.toString()).toBe("hi world");
        expect(getVersionDoc(view, revId)).toBe("hi");
    });

    it("switching back to original version restores text", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(view.state.doc.toString()).toBe("hi world");

        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 0)));
        expect(view.state.doc.toString()).toBe("hello world");
    });

    it("undo of version switch restores previous version", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(view.state.doc.toString()).toBe("hi world");

        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");
    });

    it("nested edit then version switch then undo restores version, not the edit", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        // Edit version 0
        simulateNestedEdit(view, revId, 5, 5, "!");
        expect(view.state.doc.toString()).toBe("hello! world");

        // Switch to version 1
        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(view.state.doc.toString()).toBe("hi world");

        // Undo version switch → back to version 0 with the edit
        undo(view);
        expect(view.state.doc.toString()).toBe("hello! world");
        expect(getVersionDoc(view, revId)).toBe("hello!");

        // Undo the edit
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");
    });

    it("version switch does not corrupt other revision in same document", () => {
        view = createView("aaa bbb ccc");
        const rev1 = addRevision(view, 0, 3, [{ doc: "aaa" }, { doc: "AAA" }], 0);
        const rev2 = addRevision(view, 4, 7, [{ doc: "bbb" }]);

        view.dispatch(setActiveRevisionVersion(view.state, rev1, versionIdAt(view, rev1, 1)));
        expect(view.state.doc.toString()).toBe("AAA bbb ccc");
        expect(getVersionDoc(view, rev2)).toBe("bbb");
        expect(getRevisionSlice(view, rev2)).toBe("bbb");
    });
});

// ── Multi-version revision deletion and undo ────────────────────────────────

describe("deleting versions from a revision", () => {
    it("deleting a non-active version preserves the active one", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }, { doc: "hey" }], 0);

        view.dispatch(deleteRevisionVersion(view.state, revId, versionIdAt(view, revId, 2)));
        const rev = getRevision(view, revId);
        expect(rev?.versions).toHaveLength(2);
        expect(rev && activeVersionIndex(rev)).toBe(0);
        expect(getVersionDoc(view, revId)).toBe("hello");
    });

    it("deleting the active version switches to another", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 1);

        // Currently on version 1 ("hi"), delete version 1
        view.dispatch(deleteRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        const rev = getRevision(view, revId);
        expect(rev?.versions).toHaveLength(1);
        expect(rev && activeVersionIndex(rev)).toBe(0);
        // Document should now show version 0's text
        expect(getVersionDoc(view, revId)).toBe("hello");
    });

    it("undo of version deletion restores the version", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        view.dispatch(deleteRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(getRevision(view, revId)?.versions).toHaveLength(1);

        undo(view);
        const rev = getRevision(view, revId);
        expect(rev?.versions).toHaveLength(2);
        expect(rev?.versions[1]?.doc).toBe("hi");
    });
});

// ── Creating new versions ───────────────────────────────────────────────────

describe("creating new versions on a revision", () => {
    it("createNewRevision adds an empty version and switches to it", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        view.dispatch(createNewRevision(view.state, revId));
        const rev = getRevision(view, revId);
        expect(rev?.versions).toHaveLength(2);
        expect(rev && activeVersionIndex(rev)).toBe(1);
        // New version starts empty — the document text under the revision is replaced
        expect(view.state.doc.toString()).toBe(" world");
        expect(getVersionDoc(view, revId)).toBe("");
    });

    it("undo of createNewRevision removes the new version", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        view.dispatch(createNewRevision(view.state, revId));
        expect(getRevision(view, revId)?.versions).toHaveLength(2);

        undo(view);
        const rev = getRevision(view, revId);
        expect(rev?.versions).toHaveLength(1);
        expect(rev && activeVersionIndex(rev)).toBe(0);
    });

    it("create version, edit it, undo edit, undo creation restores original", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Create new version (starts empty, replaces "hello" with "")
        view.dispatch(createNewRevision(view.state, revId));
        const created = getRevision(view, revId);
        expect(created && activeVersionIndex(created)).toBe(1);
        expect(view.state.doc.toString()).toBe(" world");

        // Edit the new (empty) version via nested editor — type "hi"
        simulateNestedEdit(view, revId, 0, 0, "hi");
        expect(view.state.doc.toString()).toBe("hi world");
        expect(getVersionDoc(view, revId)).toBe("hi");

        // Undo the edit — doc goes back to " world" (revision collapsed)
        // Note: version.doc is NOT synced for collapsed revisions on non-nested
        // undos (Phase 3 skips them to preserve _restoreAnnotation data).
        undo(view);
        expect(view.state.doc.toString()).toBe(" world");

        // Undo the version creation — restores original version 0
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getRevision(view, revId)?.versions).toHaveLength(1);
        const restored = getRevision(view, revId);
        expect(restored && activeVersionIndex(restored)).toBe(0);
    });
});

// ── Adjacent and overlapping revision interactions ──────────────────────────

describe("adjacent revisions do not interfere", () => {
    it("editing one revision does not shift the other's version doc", () => {
        view = createView("aaa bbb");
        const rev1 = addRevision(view, 0, 3, [{ doc: "aaa" }]);
        const rev2 = addRevision(view, 4, 7, [{ doc: "bbb" }]);

        // Edit rev1: "aaa" → "AAAA" (insert one char)
        simulateNestedEdit(view, rev1, 0, 3, "AAAA");
        expect(view.state.doc.toString()).toBe("AAAA bbb");
        expect(getVersionDoc(view, rev1)).toBe("AAAA");
        expect(getVersionDoc(view, rev2)).toBe("bbb");
        expect(getRevisionSlice(view, rev2)).toBe("bbb");
    });

    it("deleting text between revisions does not corrupt either", () => {
        view = createView("aaa---bbb");
        const rev1 = addRevision(view, 0, 3, [{ doc: "aaa" }]);
        const rev2 = addRevision(view, 6, 9, [{ doc: "bbb" }]);

        // Delete "---" between revisions
        view.dispatch({ changes: { from: 3, to: 6 } });
        expect(view.state.doc.toString()).toBe("aaabbb");

        expect(getRevisionSlice(view, rev1)).toBe("aaa");
        expect(getRevisionSlice(view, rev2)).toBe("bbb");
        expect(getVersionDoc(view, rev1)).toBe("aaa");
        expect(getVersionDoc(view, rev2)).toBe("bbb");
    });

    it("undo after deleting text between revisions restores positions", () => {
        view = createView("aaa---bbb");
        const rev1 = addRevision(view, 0, 3, [{ doc: "aaa" }]);
        const rev2 = addRevision(view, 6, 9, [{ doc: "bbb" }]);

        view.dispatch({ changes: { from: 3, to: 6 } });
        undo(view);

        expect(view.state.doc.toString()).toBe("aaa---bbb");
        const r1 = getRevision(view, rev1);
        const r2 = getRevision(view, rev2);
        expect(r1?.selection.main.from).toBe(0);
        expect(r1?.selection.main.to).toBe(3);
        expect(r2?.selection.main.from).toBe(6);
        expect(r2?.selection.main.to).toBe(9);
    });
});

// ── Nested edits combined with parent-level text changes ────────────────────

describe("nested edits interleaved with parent document changes", () => {
    it("inserting text before revision then nested edit, undo both", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Insert ">>>" before the revision
        view.dispatch({ changes: { from: 0, insert: ">>>" } });
        expect(view.state.doc.toString()).toBe(">>>hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");

        // Nested edit inside the (now shifted) revision
        simulateNestedEdit(view, revId, 0, 5, "HELLO");
        expect(view.state.doc.toString()).toBe(">>>HELLO world");
        expect(getVersionDoc(view, revId)).toBe("HELLO");

        // Undo nested edit
        undo(view);
        expect(view.state.doc.toString()).toBe(">>>hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");

        // Undo parent insert
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");
    });

    it("inserting text after revision then nested edit, undo both", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Insert text after revision
        view.dispatch({ changes: { from: 5, insert: "!!!" } });
        expect(view.state.doc.toString()).toBe("hello!!! world");

        // Nested edit
        simulateNestedEdit(view, revId, 0, 5, "HI");
        expect(view.state.doc.toString()).toBe("HI!!! world");
        expect(getVersionDoc(view, revId)).toBe("HI");

        undo(view);
        expect(view.state.doc.toString()).toBe("hello!!! world");
        expect(getVersionDoc(view, revId)).toBe("hello");

        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
    });

    it("parent deletes text after revision, nested edit before, undo both", () => {
        view = createView("hello world suffix");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Delete " suffix" at end
        view.dispatch({ changes: { from: 11, to: 18 } });
        expect(view.state.doc.toString()).toBe("hello world");

        // Nested edit
        simulateNestedEdit(view, revId, 5, 5, "!");
        expect(view.state.doc.toString()).toBe("hello! world");
        expect(getVersionDoc(view, revId)).toBe("hello!");

        // Undo nested edit
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");

        // Undo parent delete
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world suffix");
    });
});

// ── Revision with empty version ─────────────────────────────────────────────

describe("revision with empty version content", () => {
    it("switching to empty version collapses revision range", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "" }], 0);

        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(view.state.doc.toString()).toBe(" world");
        const rev = getRevision(view, revId);
        expect(rev?.selection.main.from).toBe(0);
        expect(rev?.selection.main.to).toBe(0);
    });

    it("switching from empty version to non-empty expands range", () => {
        view = createView(" world");
        const revId = addRevision(view, 0, 0, [{ doc: "" }, { doc: "hello" }], 0);

        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(view.state.doc.toString()).toBe("hello world");
        const rev = getRevision(view, revId);
        expect(rev?.selection.main.from).toBe(0);
        expect(rev?.selection.main.to).toBe(5);
    });

    it("undo of switch to empty version restores text", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "" }], 0);

        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(view.state.doc.toString()).toBe(" world");

        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");
    });
});

// ── Nested edit empties revision, then undo ─────────────────────────────────

describe("nested edit deletes all revision content", () => {
    it("deleting all content via nested edit collapses revision", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        simulateNestedEdit(view, revId, 0, 5, "");
        expect(view.state.doc.toString()).toBe(" world");

        const rev = getRevision(view, revId);
        expect(rev).toBeDefined();
        expect(rev?.selection.main.empty).toBe(true);
    });

    it("undo of full delete via nested edit restores content", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        simulateNestedEdit(view, revId, 0, 5, "");
        expect(view.state.doc.toString()).toBe(" world");

        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");
        expect(getRevisionSlice(view, revId)).toBe("hello");
    });

    it("partial delete via nested edit, undo, redo cycle stays consistent", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Delete "llo" → "he"
        simulateNestedEdit(view, revId, 2, 5, "");
        expect(view.state.doc.toString()).toBe("he world");
        expect(getVersionDoc(view, revId)).toBe("he");

        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");

        redo(view);
        expect(view.state.doc.toString()).toBe("he world");
        expect(getVersionDoc(view, revId)).toBe("he");
    });
});

// ── Comment + revision interaction ──────────────────────────────────────────

describe("comments and revisions coexisting", () => {
    it("deleting text under a comment does not affect adjacent revision", () => {
        view = createView("aaa bbb ccc");
        const commentId = addComment(view, 0, 3, "note on aaa");
        const revId = addRevision(view, 4, 7, [{ doc: "bbb" }]);

        // Delete "aaa" — comment drops
        view.dispatch({ changes: { from: 0, to: 3 } });
        expect(view.state.doc.toString()).toBe(" bbb ccc");

        const anns = getAnnotations(view);
        // Comment is gone, revision survives
        expect(anns).toHaveLength(1);
        expect(isAnnotationOfType(anns[0], "revision")).toBe(true);
        expect(getRevisionSlice(view, revId)).toBe("bbb");
    });

    it("undo restores both comment and revision", async () => {
        view = createView("aaa bbb");
        const commentId = addComment(view, 0, 3, "note");
        const revId = addRevision(view, 4, 7, [{ doc: "bbb" }]);

        // Delete everything
        view.dispatch({ changes: { from: 0, to: 7 } });
        await Promise.resolve();

        undo(view);
        expect(view.state.doc.toString()).toBe("aaa bbb");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(2);
    });
});

// ── Undo depth consistency ──────────────────────────────────────────────────

describe("undo depth remains consistent with nested operations", () => {
    it("version switch adds exactly one undo entry", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        const depthBefore = undoDepth(view.state);
        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(undoDepth(view.state)).toBe(depthBefore + 1);
    });

    it("version creation adds exactly one undo entry", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        const depthBefore = undoDepth(view.state);
        view.dispatch(createNewRevision(view.state, revId));
        expect(undoDepth(view.state)).toBe(depthBefore + 1);
    });

    it("version deletion adds exactly one undo entry", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        const depthBefore = undoDepth(view.state);
        view.dispatch(deleteRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(undoDepth(view.state)).toBe(depthBefore + 1);
    });

    it("collapsed revision resolver does not add undo entry", async () => {
        view = createView("hello world");
        addRevision(view, 0, 5, [{ doc: "hello" }]);

        // Delete text (creates undo entry) + annotation creation entry = 2
        const depthAfterAnnotation = undoDepth(view.state);
        view.dispatch({ changes: { from: 0, to: 5 } });
        const depthAfterDelete = undoDepth(view.state);
        expect(depthAfterDelete).toBe(depthAfterAnnotation + 1);

        // Resolver fires — should NOT add an undo entry
        await Promise.resolve();
        expect(undoDepth(view.state)).toBe(depthAfterDelete);
    });
});

// ── Multi-revision deletion in single transaction ───────────────────────────

describe("deleting multiple revisions in one transaction", () => {
    it("single deletion spanning two revisions collapses both", () => {
        view = createView("aaa REV1 bbb REV2 ccc");
        const rev1 = addRevision(view, 4, 8, [{ doc: "REV1" }]);
        const rev2 = addRevision(view, 13, 17, [{ doc: "REV2" }]);

        // Delete everything
        view.dispatch({ changes: { from: 0, to: 21 } });
        expect(view.state.doc.toString()).toBe("");

        // Both survive as collapsed before resolver
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(2);
        expect(anns.every((a) => a.selection.main.empty)).toBe(true);
    });

    it("resolver cleans up all collapsed revisions", async () => {
        view = createView("aaa REV1 bbb REV2 ccc");
        addRevision(view, 4, 8, [{ doc: "REV1" }]);
        addRevision(view, 13, 17, [{ doc: "REV2" }]);

        view.dispatch({ changes: { from: 0, to: 21 } });
        await Promise.resolve();

        expect(getAnnotations(view)).toHaveLength(0);
    });

    it("single undo restores both revisions after resolver", async () => {
        view = createView("aaa REV1 bbb REV2 ccc");
        const rev1 = addRevision(view, 4, 8, [{ doc: "REV1" }]);
        const rev2 = addRevision(view, 13, 17, [{ doc: "REV2" }]);

        view.dispatch({ changes: { from: 0, to: 21 } });
        await Promise.resolve();

        undo(view);
        expect(view.state.doc.toString()).toBe("aaa REV1 bbb REV2 ccc");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(2);
        expect(anns.every((a) => !a.selection.main.empty)).toBe(true);
    });
});

// ── Edge cases: rapid operations ────────────────────────────────────────────

describe("rapid successive operations", () => {
    it("create revision, switch version, edit, switch back — all undoable", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }], 0);

        // Switch to v1
        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(view.state.doc.toString()).toBe("hi world");

        // Edit v1
        simulateNestedEdit(view, revId, 2, 2, "!");
        expect(view.state.doc.toString()).toBe("hi! world");

        // Switch back to v0
        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 0)));
        expect(view.state.doc.toString()).toBe("hello world");

        // Undo switch back → v1 with edit
        undo(view);
        expect(view.state.doc.toString()).toBe("hi! world");

        // Undo edit
        undo(view);
        expect(view.state.doc.toString()).toBe("hi world");

        // Undo switch to v1
        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getVersionDoc(view, revId)).toBe("hello");
    });

    it("multiple nested edits followed by version switch — undo restores each step", () => {
        view = createView("abc world");
        const revId = addRevision(view, 0, 3, [{ doc: "abc" }, { doc: "xyz" }], 0);

        // Three edits on v0
        simulateNestedEdit(view, revId, 3, 3, "1");
        simulateNestedEdit(view, revId, 4, 4, "2");
        simulateNestedEdit(view, revId, 5, 5, "3");
        expect(view.state.doc.toString()).toBe("abc123 world");

        // Switch to v1
        view.dispatch(setActiveRevisionVersion(view.state, revId, versionIdAt(view, revId, 1)));
        expect(view.state.doc.toString()).toBe("xyz world");

        // Undo: switch → edit3 → edit2 → edit1 → original
        undo(view);
        expect(view.state.doc.toString()).toBe("abc123 world");
        undo(view);
        expect(view.state.doc.toString()).toBe("abc12 world");
        undo(view);
        expect(view.state.doc.toString()).toBe("abc1 world");
        undo(view);
        expect(view.state.doc.toString()).toBe("abc world");
    });
});

// ── Boundary conditions ─────────────────────────────────────────────────────

describe("boundary conditions", () => {
    it("revision at start of document", () => {
        view = createView("hello world");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        simulateNestedEdit(view, revId, 0, 0, ">");
        expect(view.state.doc.toString()).toBe(">hello world");
        expect(getVersionDoc(view, revId)).toBe(">hello");

        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
    });

    it("revision at end of document", () => {
        view = createView("world hello");
        const revId = addRevision(view, 6, 11, [{ doc: "hello" }]);

        simulateNestedEdit(view, revId, 5, 5, "!");
        expect(view.state.doc.toString()).toBe("world hello!");
        expect(getVersionDoc(view, revId)).toBe("hello!");

        undo(view);
        expect(view.state.doc.toString()).toBe("world hello");
    });

    it("revision spanning entire document", () => {
        view = createView("hello");
        const revId = addRevision(view, 0, 5, [{ doc: "hello" }]);

        simulateNestedEdit(view, revId, 0, 5, "world");
        expect(view.state.doc.toString()).toBe("world");
        expect(getVersionDoc(view, revId)).toBe("world");

        undo(view);
        expect(view.state.doc.toString()).toBe("hello");
    });

    it("single-character revision", () => {
        view = createView("a");
        const revId = addRevision(view, 0, 1, [{ doc: "a" }]);

        simulateNestedEdit(view, revId, 0, 1, "b");
        expect(view.state.doc.toString()).toBe("b");
        expect(getVersionDoc(view, revId)).toBe("b");

        undo(view);
        expect(view.state.doc.toString()).toBe("a");
    });

    it("revision with very long content", () => {
        const longText = "a".repeat(10000);
        view = createView(longText);
        const revId = addRevision(view, 0, 10000, [{ doc: longText }]);

        simulateNestedEdit(view, revId, 5000, 5001, "B");
        expect(view.state.doc.toString().length).toBe(10000);
        expect(getVersionDoc(view, revId)[5000]).toBe("B");

        undo(view);
        expect(view.state.doc.toString()).toBe(longText);
    });
});
