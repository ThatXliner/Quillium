/**
 * Integration tests for the specific bug:
 *   1. Edit in nested editor (add text, then delete some of it)
 *   2. Flush nested editor state to parent (simulate cursor leaving revision)
 *   3. Undo from main editor
 *
 * Bug: after flush, version.doc or the parent state diverges from what undo expects.
 */

import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    _nestedEditRevision,
    addAnnotation,
    annotationField,
    nestedEditorEdit,
    updateRevisionVersionState,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    activeVersion,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
    versionText,
} from "$lib/editor/plugins/annotations/models";
import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createParentView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

function addRevision(view: EditorView, from: number, to: number, doc: string): number {
    const versions = [makeVersion({ doc })];
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionId: versions[0].id,
        versions,
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

function getVersionDoc(view: EditorView, revId: number): string {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    return versionText(activeVersion(rev));
}

function getRevisionSlice(view: EditorView, revId: number): string {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    return view.state.doc.slice(rev.selection.main.from, rev.selection.main.to).toString();
}

/** Simulate a nested editor edit dispatched to the parent with proper tags. */
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

/**
 * Simulate the modal editor's destroyEditor flush: serialize the nested
 * editor state and write it back via updateRevisionVersionState.
 * The nested editor doc text is passed explicitly (since we don't have a
 * real EditorView for the nested editor in this test).
 */
function simulateFlush(view: EditorView, revId: number, nestedDocText: string) {
    const rev = view.state.field(annotationField)[revId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error("No revision");
    const targetVersionId = rev.versions[0].id;
    const existingLabel = rev.versions[0]?.label;
    const newVersionState = makeVersion({
        id: targetVersionId,
        doc: nestedDocText,
        ...(existingLabel !== undefined ? { label: existingLabel } : {}),
    });
    view.dispatch(
        updateRevisionVersionState(view.state, revId, targetVersionId, newVersionState, {
            addToHistory: false,
        }),
    );
}

// ── State ─────────────────────────────────────────────────────────────────────

let view: EditorView;

beforeEach(() => {
    view = createParentView("world");
});

afterEach(() => {
    view.destroy();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("no-flush destroy then undo (inline editor behavior)", () => {
    it("undo restores deletion at correct position without flush", () => {
        // Simulates: user deletes inside nested editor, clicks away
        // (editor destroyed without flush), then presses Cmd+Z.
        const revId = addRevision(view, 0, 5, "world");

        // Delete "wor" at [0,3] → "ld"
        simulateNestedEdit(view, revId, 0, 3, "");
        expect(view.state.doc.toString()).toBe("ld");
        expect(getVersionDoc(view, revId)).toBe("ld");

        // Destroy nested editor without flushing (inline editor behavior)
        // — no simulateFlush call —

        // Undo — "wor" should be restored at position 0, not appended
        undo(view);
        expect(view.state.doc.toString()).toBe("world");
        expect(getRevisionSlice(view, revId)).toBe("world");
    });

    it("undo restores mid-word deletion at correct offset", () => {
        // "hello world" with revision over full text
        view.destroy();
        view = createParentView("hello world");
        const revId = addRevision(view, 0, 11, "hello world");

        // Delete " world" at [5,11] → "hello"
        simulateNestedEdit(view, revId, 5, 11, "");
        expect(view.state.doc.toString()).toBe("hello");

        // No flush (inline editor closes)

        undo(view);
        expect(view.state.doc.toString()).toBe("hello world");
        expect(getRevisionSlice(view, revId)).toBe("hello world");
    });

    it("undo after insertion then deletion without flush", () => {
        const revId = addRevision(view, 0, 5, "world");

        // Insert "EXTRA " at start → "EXTRA world"
        simulateNestedEdit(view, revId, 0, 0, "EXTRA ");
        expect(view.state.doc.toString()).toBe("EXTRA world");

        // Delete "EXTRA " → "world"
        simulateNestedEdit(view, revId, 0, 6, "");
        expect(view.state.doc.toString()).toBe("world");

        // No flush — just undo
        undo(view);
        expect(view.state.doc.toString()).toBe("EXTRA world");
        expect(getVersionDoc(view, revId)).toBe("EXTRA world");
        expect(getRevisionSlice(view, revId)).toBe("EXTRA world");
    });
});

describe("flush then undo", () => {
    it("undo of nested deletion after flush restores correct text", () => {
        // Revision over "world" at [0,5]
        const revId = addRevision(view, 0, 5, "world");

        // Type "EXTRA " at start → "EXTRA world"
        simulateNestedEdit(view, revId, 0, 0, "EXTRA ");
        expect(view.state.doc.toString()).toBe("EXTRA world");
        expect(getVersionDoc(view, revId)).toBe("EXTRA world");

        // Delete "EXTRA " → "world"
        simulateNestedEdit(view, revId, 0, 6, "");
        expect(view.state.doc.toString()).toBe("world");
        expect(getVersionDoc(view, revId)).toBe("world");

        // Simulate modal destroyEditor flush (cursor leaving revision)
        simulateFlush(view, revId, "world");
        // After flush, version.doc should still be "world"
        expect(getVersionDoc(view, revId)).toBe("world");

        // Undo — should restore "EXTRA world"
        undo(view);
        expect(view.state.doc.toString()).toBe("EXTRA world");
        expect(getVersionDoc(view, revId)).toBe("EXTRA world");
        expect(getRevisionSlice(view, revId)).toBe("EXTRA world");
    });

    it("two undos after flush restore both states", () => {
        const revId = addRevision(view, 0, 5, "world");

        simulateNestedEdit(view, revId, 0, 0, "EXTRA ");
        expect(getVersionDoc(view, revId)).toBe("EXTRA world");

        simulateNestedEdit(view, revId, 0, 6, "");
        expect(getVersionDoc(view, revId)).toBe("world");

        simulateFlush(view, revId, "world");

        // First undo: restore "EXTRA world"
        undo(view);
        expect(view.state.doc.toString()).toBe("EXTRA world");
        expect(getVersionDoc(view, revId)).toBe("EXTRA world");

        // Second undo: restore original "world"
        undo(view);
        expect(view.state.doc.toString()).toBe("world");
        expect(getVersionDoc(view, revId)).toBe("world");
    });

    it("flush preserves version.doc correctly", () => {
        const revId = addRevision(view, 0, 5, "world");

        simulateNestedEdit(view, revId, 0, 0, "EXTRA ");
        simulateNestedEdit(view, revId, 0, 6, "");

        const docBeforeFlush = getVersionDoc(view, revId);
        simulateFlush(view, revId, "world");
        const docAfterFlush = getVersionDoc(view, revId);

        expect(docBeforeFlush).toBe("world");
        expect(docAfterFlush).toBe("world");
    });

    it("version.doc matches parent slice after undo and flush", () => {
        const revId = addRevision(view, 0, 5, "world");

        simulateNestedEdit(view, revId, 0, 0, "EXTRA ");
        simulateNestedEdit(view, revId, 0, 6, "");
        simulateFlush(view, revId, "world");

        undo(view);

        const vDoc = getVersionDoc(view, revId);
        const slice = getRevisionSlice(view, revId);
        expect(vDoc).toBe(slice);
        expect(vDoc).toBe("EXTRA world");
    });
});
