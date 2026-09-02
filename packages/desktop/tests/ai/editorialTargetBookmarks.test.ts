import {
    activateEditorialView,
    captureEditorialTarget,
    editorialTargetBookmarkField,
    editorialTargetViewTracker,
    getActiveEditorialView,
    getEditorialBranchPath,
    registerNestedEditorialView,
    releaseEditorialTarget,
    resolveEditorialTargetRange,
    resolveEditorialTargetView,
    unregisterEditorialView,
    validateEditorialActionTarget,
} from "$lib/ai/editorialTarget";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
});

function createView(doc = "Before selected words after") {
    view = new EditorView({
        doc,
        extensions: [editorialTargetBookmarkField, editorialTargetViewTracker],
    });
    return view;
}

describe("editorial target bookmarks", () => {
    it("maps a selected passage through edits before it", () => {
        const editor = createView();
        const snapshot = captureEditorialTarget({
            view: editor,
            documentId: "document-a",
            tabId: "tab-a",
            draftId: "draft-a",
            selectedText: "selected words",
            selectedTextRange: { from: 7, to: 21 },
        });

        editor.dispatch({ changes: { from: 0, insert: "New " } });
        const mappedRange = resolveEditorialTargetRange(editor, snapshot);

        expect(mappedRange).toEqual({ from: 11, to: 25 });
        expect(
            validateEditorialActionTarget({
                snapshot,
                current: {
                    documentId: "document-a",
                    tabId: "tab-a",
                    draftId: "draft-a",
                    documentText: editor.state.doc.toString(),
                    selectedTextRange: mappedRange,
                },
                targetText: "selected",
                action: "suggestion",
                allowedActions: ["suggestion"],
            }),
        ).toEqual({ ok: true });
    });

    it("rejects a response after an edit inside the selected source", () => {
        const editor = createView();
        const snapshot = captureEditorialTarget({
            view: editor,
            documentId: "document-a",
            tabId: "tab-a",
            draftId: "draft-a",
            selectedText: "selected words",
            selectedTextRange: { from: 7, to: 21 },
        });

        editor.dispatch({ changes: { from: 15, insert: "new " } });
        const mappedRange = resolveEditorialTargetRange(editor, snapshot);

        expect(mappedRange).toEqual({ from: 7, to: 25 });
        expect(
            validateEditorialActionTarget({
                snapshot,
                current: {
                    documentId: "document-a",
                    tabId: "tab-a",
                    draftId: "draft-a",
                    documentText: editor.state.doc.toString(),
                    selectedTextRange: mappedRange,
                },
                targetText: "selected",
                action: "suggestion",
                allowedActions: ["suggestion"],
            }),
        ).toEqual({ ok: false, reason: "selection-changed" });
    });

    it("keeps boundary insertions outside the selected passage", () => {
        const editor = createView();
        const snapshot = captureEditorialTarget({
            view: editor,
            documentId: "document-a",
            tabId: "tab-a",
            draftId: "draft-a",
            selectedText: "selected words",
            selectedTextRange: { from: 7, to: 21 },
        });

        editor.dispatch({
            changes: [
                { from: 7, insert: "prefix " },
                { from: 21, insert: " suffix" },
            ],
        });

        const mappedRange = resolveEditorialTargetRange(editor, snapshot);
        expect(mappedRange).toEqual({ from: 14, to: 28 });
        expect(editor.state.doc.sliceString(mappedRange!.from, mappedRange!.to)).toBe(
            "selected words",
        );
    });

    it("removes the transient bookmark when a request ends", () => {
        const editor = createView();
        const snapshot = captureEditorialTarget({
            view: editor,
            documentId: "document-a",
            tabId: "tab-a",
            draftId: "draft-a",
            selectedText: "selected words",
            selectedTextRange: { from: 7, to: 21 },
        });

        releaseEditorialTarget(editor, snapshot);

        expect(resolveEditorialTargetRange(editor, snapshot)).toBeUndefined();
        expect(editor.state.field(editorialTargetBookmarkField).size).toBe(0);
    });

    it("captures and validates the owning nested revision path", () => {
        const root = createView("Root draft");
        const nested = new EditorView({
            doc: "Nested draft",
            extensions: [editorialTargetBookmarkField, editorialTargetViewTracker],
        });
        let currentVersionId = "version-a";
        registerNestedEditorialView({
            view: nested,
            parentView: root,
            revisionId: 7,
            versionId: "version-a",
            isCurrent: () => currentVersionId === "version-a",
        });
        activateEditorialView(nested);

        const owner = getActiveEditorialView(root);
        const snapshot = captureEditorialTarget({
            view: owner,
            documentId: "document-a",
            tabId: "tab-a",
            draftId: "draft-a",
            selectedText: "",
        });

        expect(owner).toBe(nested);
        expect(snapshot.branchPath).toEqual([{ revisionId: 7, versionId: "version-a" }]);
        expect(resolveEditorialTargetView(root, snapshot)).toBe(nested);
        expect(
            validateEditorialActionTarget({
                snapshot,
                current: {
                    documentId: "document-a",
                    tabId: "tab-a",
                    draftId: "draft-a",
                    branchPath: getEditorialBranchPath(nested),
                },
                targetText: "Nested",
                action: "comment",
                allowedActions: ["comment"],
            }),
        ).toEqual({ ok: true });

        currentVersionId = "version-b";
        expect(resolveEditorialTargetView(root, snapshot)).toBeUndefined();
        unregisterEditorialView(nested);
        nested.destroy();
    });
});
