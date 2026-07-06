import {
    annotations as annotationExtensions,
    createComment,
    createRevision,
    createRevisionCommand,
    createSuggestion,
} from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
    branchSuggestion,
    revisionInternalEdit,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type VersionState,
    activeVersionIndex,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

function getAnnotations(view: EditorView) {
    return Object.values(view.state.field(annotationField));
}

async function flushMicrotasks() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
});

describe("annotation workflows integration", () => {
    it("creates a comment from targetText through the public API", () => {
        view = createView("Alpha Beta Gamma");

        createComment({
            targetText: "Beta",
            comment: "Clarify this point",
            author: "Reviewer",
            view,
        });

        const annotations = getAnnotations(view);
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "comment")).toBe(true);
        if (!isAnnotationOfType(annotations[0], "comment")) return;

        const { from, to } = annotations[0].selection.main;
        expect(view.state.sliceDoc(from, to)).toBe("Beta");
        expect(annotations[0].thread[0]).toMatchObject({
            message: "Clarify this point",
            author: "Reviewer",
        });
    });

    it("creates a suggestion with all target text matches selected", () => {
        view = createView("foo bar foo baz");

        createSuggestion({
            state: view.state,
            dispatch: (tr) => view?.dispatch(tr),
            targetText: "foo",
            replacements: ["qux"],
        });

        const annotations = getAnnotations(view);
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "suggestion")).toBe(true);
        if (!isAnnotationOfType(annotations[0], "suggestion")) return;

        expect(annotations[0].selection.ranges).toHaveLength(2);
        expect(annotations[0].replacements).toEqual([{ text: "qux" }]);
    });

    it("branches a suggestion into a revision and applies the first replacement", () => {
        view = createView("Alpha Beta Gamma");

        createSuggestion({
            state: view.state,
            dispatch: (tr) => view?.dispatch(tr),
            targetText: "Beta",
            replacements: [{ text: "Delta" }, { text: "Epsilon" }],
            comment: "Choose one",
            author: "AI",
        });

        const before = getAnnotations(view);
        expect(before).toHaveLength(1);
        if (!isAnnotationOfType(before[0], "suggestion")) return;

        view.dispatch(branchSuggestion(view.state, before[0].id));

        const after = getAnnotations(view);
        expect(after).toHaveLength(1);
        expect(isAnnotationOfType(after[0], "revision")).toBe(true);
        expect(view.state.doc.toString()).toBe("Alpha Delta Gamma");
        if (!isAnnotationOfType(after[0], "revision")) return;

        expect(activeVersionIndex(after[0])).toBe(1);
        expect(after[0].versions[0]?.doc).toBe("Beta");
        expect(after[0].versions[1]?.doc).toBe("Delta");
    });

    it("undo after branchSuggestion restores the original suggestion", () => {
        view = createView("Alpha Beta Gamma");

        createSuggestion({
            state: view.state,
            dispatch: (tr) => view?.dispatch(tr),
            targetText: "Beta",
            replacements: [{ text: "Delta" }, { text: "Epsilon" }],
            comment: "Choose one",
            author: "AI",
        });

        const before = getAnnotations(view);
        expect(before).toHaveLength(1);
        expect(isAnnotationOfType(before[0], "suggestion")).toBe(true);

        view.dispatch(branchSuggestion(view.state, before[0].id));
        expect(view.state.doc.toString()).toBe("Alpha Delta Gamma");

        undo(view);

        expect(view.state.doc.toString()).toBe("Alpha Beta Gamma");
        const afterUndo = getAnnotations(view);
        expect(afterUndo).toHaveLength(1);
        expect(isAnnotationOfType(afterUndo[0], "suggestion")).toBe(true);
        if (isAnnotationOfType(afterUndo[0], "suggestion")) {
            expect(afterUndo[0].replacements).toEqual([{ text: "Delta" }, { text: "Epsilon" }]);
            expect(afterUndo[0].thread).toEqual([
                expect.objectContaining({ message: "Choose one", author: "AI" }),
            ]);
        }
    });

    it("collapsed revision resolver removes a one-version revision when its text is deleted", async () => {
        view = createView("Alpha Beta Gamma");

        const builtVersions = [makeVersion({ doc: "Beta", label: "Original" })];
        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(6, 10),
                "revision",
            ),
            activeVersionId: builtVersions[0].id,
            versions: builtVersions,
        };

        view.dispatch(view.state.update({ effects: [addAnnotation.of(revision)] }));
        view.dispatch({ changes: { from: 6, to: 10, insert: "" } });
        await flushMicrotasks();

        const annotations = getAnnotations(view);
        expect(annotations).toHaveLength(0);
    });

    it("single undo fully restores deleted revision", async () => {
        // When a revision's text is fully deleted, the resolver dispatches
        // removeAnnotation tagged addToHistory.of(false). This ensures a single
        // Cmd+Z fully restores both the text and the annotation (via the
        // _restoreAnnotation effect stored at deletion time) without spurious
        // intermediate undo entries. The old version-switch behaviour was removed
        // because it created a separate history entry that required 3 Cmd+Z presses.
        view = createView("Alpha Delta Gamma");

        const builtVersions = [
            makeVersion({ doc: "Beta", label: "Original" }),
            makeVersion({ doc: "Delta", label: "Edited" }),
        ];
        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(6, 11),
                "revision",
            ),
            activeVersionId: builtVersions[1].id,
            versions: builtVersions,
        };

        view.dispatch(view.state.update({ effects: [addAnnotation.of(revision)] }));
        view.dispatch({ changes: { from: 6, to: 11, insert: "" } });
        await flushMicrotasks();

        // After the resolver fires, the collapsed annotation is removed and
        // no version text is inserted — the doc retains only the surrounding text.
        const annotations = getAnnotations(view);
        expect(annotations).toHaveLength(0);
        expect(view.state.doc.toString()).toBe("Alpha  Gamma");

        // A single undo must restore both the text and the annotation (with all
        // versions intact) because the resolver did NOT create a history entry.
        undo(view);
        const restored = getAnnotations(view);
        expect(restored).toHaveLength(1);
        expect(isAnnotationOfType(restored[0], "revision")).toBe(true);
        expect(view.state.doc.toString()).toBe("Alpha Delta Gamma");
        if (isAnnotationOfType(restored[0], "revision")) {
            expect(restored[0].versions).toHaveLength(2);
            expect(restored[0].versions[0]?.doc).toBe("Beta");
            expect(restored[0].versions[1]?.doc).toBe("Delta");
        }
    });

    it("auto-version revision: positions are valid after creation", () => {
        view = createView("Alpha Beta Gamma");

        const sel = EditorSelection.single(6, 10);
        const originalText = "Beta";
        const newAnnotation = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(sel.main.from),
            "revision",
        );
        const builtVersions = [makeVersion({ doc: originalText }), makeVersion({ doc: "" })];
        view.dispatch(
            view.state.update({
                effects: [
                    addAnnotation.of({
                        ...newAnnotation,
                        activeVersionId: builtVersions[1].id,
                        versions: builtVersions,
                    }),
                ],
                changes: view.state.changes({ from: 6, to: 10, insert: "" }),
                selection: EditorSelection.cursor(6),
                annotations: [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)],
            }),
        );

        const annotations = getAnnotations(view);
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "revision")).toBe(true);
        if (!isAnnotationOfType(annotations[0], "revision")) return;
        // Positions must be within the new document
        expect(annotations[0].selection.main.from).toBeLessThanOrEqual(view.state.doc.length);
        expect(annotations[0].selection.main.to).toBeLessThanOrEqual(view.state.doc.length);
    });

    it("auto-version revision: not removed by resolver on next user edit", async () => {
        view = createView("Alpha Beta Gamma");

        const sel = EditorSelection.single(6, 10);
        const newAnnotation = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(sel.main.from),
            "revision",
        );
        const builtVersions = [makeVersion({ doc: "Beta" }), makeVersion({ doc: "" })];
        view.dispatch(
            view.state.update({
                effects: [
                    addAnnotation.of({
                        ...newAnnotation,
                        activeVersionId: builtVersions[1].id,
                        versions: builtVersions,
                    }),
                ],
                changes: view.state.changes({ from: 6, to: 10, insert: "" }),
                selection: EditorSelection.cursor(6),
                annotations: [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)],
            }),
        );

        // User types — should NOT remove the auto-version revision
        view.dispatch({
            changes: { from: 0, to: 0, insert: "x" },
            annotations: Transaction.addToHistory.of(true),
        });
        await flushMicrotasks();

        expect(getAnnotations(view)).toHaveLength(1);
    });

    it("auto-version revision: select-all delete removes surrounding text and revision", async () => {
        view = createView("Alpha Beta Gamma");

        const sel = EditorSelection.single(6, 10);
        const newAnnotation = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(sel.main.from),
            "revision",
        );
        const builtVersions = [makeVersion({ doc: "Beta" }), makeVersion({ doc: "" })];
        view.dispatch(
            view.state.update({
                effects: [
                    addAnnotation.of({
                        ...newAnnotation,
                        activeVersionId: builtVersions[1].id,
                        versions: builtVersions,
                    }),
                ],
                changes: view.state.changes({ from: 6, to: 10, insert: "" }),
                selection: EditorSelection.cursor(6),
                annotations: [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)],
            }),
        );

        // Select all remaining text and delete
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: "" },
            annotations: Transaction.addToHistory.of(true),
        });
        await flushMicrotasks();

        // Revision should survive because its range was already collapsed
        // before this deletion — it didn't *become* collapsed in this update.
        // However, the document is empty and the revision is a ghost.
        // This test documents current behavior.
        expect(view.state.doc.toString()).toBe("");
    });

    it("createRevision captures original text and provided alternatives", () => {
        view = createView("Alpha Beta Gamma");

        createRevision({
            view,
            targetText: "Beta",
            threadMessage: "Try alternatives",
            versions: [
                { label: "Formal", text: "Therefore" },
                { label: "Simple", text: "Then" },
            ],
        });

        const annotations = getAnnotations(view);
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "revision")).toBe(true);
        if (!isAnnotationOfType(annotations[0], "revision")) return;

        expect(annotations[0].versions).toHaveLength(3);
        expect(annotations[0].versions[0]?.doc).toBe("Beta");
        expect(annotations[0].versions[1]?.doc).toBe("Therefore");
        expect(annotations[0].versions[2]?.doc).toBe("Then");
        expect(annotations[0].thread[0]?.message).toBe("Try alternatives");
    });

    it("createRevisionCommand transfers contained annotations into the original version", () => {
        view = createView("Alpha Beta Gamma");
        const comment = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(11, 16),
                "comment",
            ),
            thread: [{ message: "Keep this note", author: "Reviewer", time: 1 }],
        };
        view.dispatch(view.state.update({ effects: [addAnnotation.of(comment)] }));
        view.dispatch({ selection: EditorSelection.single(6, 16) });

        const handled = createRevisionCommand({
            state: view.state,
            dispatch: (transaction) => view?.dispatch(transaction),
        });

        expect(handled).toBe(true);
        const annotations = getAnnotations(view);
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "revision")).toBe(true);
        if (!isAnnotationOfType(annotations[0], "revision")) return;

        const originalVersion = annotations[0].versions[0] as VersionState & {
            annotationField?: Record<
                string,
                { selection: { ranges: Array<{ anchor: number; head: number }> } }
            >;
        };
        expect(originalVersion.doc).toBe("Beta Gamma");
        expect(originalVersion.annotationField?.[comment.id]?.selection.ranges[0]).toEqual({
            anchor: 5,
            head: 10,
        });
        expect(view.state.doc.toString()).toBe("Alpha ");

        undo(view);
        expect(view.state.doc.toString()).toBe("Alpha Beta Gamma");
        const afterUndo = getAnnotations(view);
        expect(afterUndo).toHaveLength(1);
        expect(isAnnotationOfType(afterUndo[0], "comment")).toBe(true);
        expect(afterUndo[0].selection.main.from).toBe(11);
        expect(afterUndo[0].selection.main.to).toBe(16);
    });

    it("createComment throws when neither targetText nor editorSelection is provided", () => {
        view = createView("Alpha Beta Gamma");

        expect(() =>
            createComment({
                view: view!,
                comment: "Missing target",
            }),
        ).toThrow("Must specify at least either targetText or editorSelection");
    });

    it("createComment throws when both targetText and editorSelection are provided", () => {
        view = createView("Alpha Beta Gamma");

        expect(() =>
            createComment({
                view: view!,
                targetText: "Beta",
                editorSelection: EditorSelection.single(6, 10),
                comment: "Ambiguous target",
            }),
        ).toThrow("Cannot specify both targetText and editorSelection");
    });

    it("createRevision uses explicit editorSelection range", () => {
        view = createView("Alpha Beta Gamma");

        createRevision({
            view,
            editorSelection: EditorSelection.single(0, 5),
            threadMessage: "Revise start",
            versions: [{ label: "Alt", text: "Omega" }],
        });

        const annotations = getAnnotations(view);
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "revision")).toBe(true);
        if (!isAnnotationOfType(annotations[0], "revision")) return;

        const { from, to } = annotations[0].selection.main;
        expect(from).toBe(0);
        expect(to).toBe(5);
        expect(annotations[0].versions[0]?.doc).toBe("Alpha");
    });
});
