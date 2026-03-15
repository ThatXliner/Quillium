/**
 * Tests that deleting all text in a nested editor (inline or modal)
 * correctly syncs the version.doc to empty, rather than leaving stale
 * content that gets pushed back by the external-sync effect.
 *
 * Bug: Phase 3 (syncRevisionDocsWithDocument) skipped syncing when a
 * revision's range collapsed to empty, preserving the old version.doc.
 * The external-sync effect then read the stale doc and overwrote the
 * nested editor's empty content with the old text.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
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

// ── Helpers ──────────────────────────────────────────────────────

function createView(doc = "hello") {
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

function simulateNestedEdit(
    view: EditorView,
    revisionId: number,
    from: number,
    to: number,
    insert: string,
) {
    const rev = view.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error(`No revision ${revisionId}`);
    const offset = rev.selection.main.from;
    view.dispatch({
        changes: { from: offset + from, to: offset + to, insert },
        effects: [_nestedEditRevision.of(revisionId)],
        annotations: [nestedEditorEdit.of(revisionId), Transaction.addToHistory.of(true)],
    });
}

function getVersionDoc(view: EditorView, revisionId: number): string {
    const rev = view.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error(`No revision ${revisionId}`);
    return versionText(rev.versions[rev.currentlySelected]);
}

function getRevisionRange(view: EditorView, revisionId: number) {
    const rev = view.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) throw new Error(`No revision ${revisionId}`);
    return rev.selection.main;
}

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
});

describe("nested editor empty version persistence", () => {
    it("version.doc syncs to empty when nested editor deletes all text", () => {
        view = createView("Alpha Beta Gamma");
        const revId = addRevision(view, 6, 10, [{ doc: "Beta" }]);

        // Delete all text via nested editor
        simulateNestedEdit(view, revId, 0, 4, "");

        // Range should be collapsed
        const range = getRevisionRange(view, revId);
        expect(range.from).toBe(range.to);

        // version.doc should be empty, not stale "Beta"
        expect(getVersionDoc(view, revId)).toBe("");
    });

    it("version.doc still syncs normally for partial nested edits", () => {
        view = createView("Alpha Beta Gamma");
        const revId = addRevision(view, 6, 10, [{ doc: "Beta" }]);

        // Partial edit via nested editor
        simulateNestedEdit(view, revId, 0, 2, "XX");

        expect(getVersionDoc(view, revId)).toBe("XXta");
    });

    it("non-nested deletion still preserves version.doc for undo", () => {
        view = createView("Alpha Beta Gamma");
        const revId = addRevision(view, 6, 10, [{ doc: "Beta" }]);

        // Delete the revision text from the main editor (not nested)
        view.dispatch({
            changes: { from: 6, to: 10, insert: "" },
            annotations: Transaction.addToHistory.of(true),
        });

        // For non-nested deletion, version.doc should be preserved
        // (undo relies on _restoreAnnotation, not version.doc, but the
        // skip guard keeps the original doc as a safety measure)
        const rev = view.state.field(annotationField)[revId];
        if (rev && isAnnotationOfType(rev, "revision")) {
            expect(versionText(rev.versions[rev.currentlySelected])).toBe("Beta");
        }
    });

    it("undo after nested empty-deletion restores content", () => {
        view = createView("Alpha Beta Gamma");
        const revId = addRevision(view, 6, 10, [{ doc: "Beta" }]);

        // Delete all text via nested editor
        simulateNestedEdit(view, revId, 0, 4, "");
        expect(getVersionDoc(view, revId)).toBe("");

        // Undo should restore
        undo(view);
        expect(view.state.doc.toString()).toBe("Alpha Beta Gamma");
        expect(getVersionDoc(view, revId)).toBe("Beta");
    });
});
