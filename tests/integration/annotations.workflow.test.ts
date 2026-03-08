import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import {
    annotations as annotationExtensions,
    createComment,
    createRevision,
    createSuggestion,
} from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
    branchSuggestion,
} from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, isAnnotationOfType } from "$lib/editor/plugins/annotations/models";

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

        expect(after[0].currentlySelected).toBe(1);
        expect(after[0].versions[0]?.doc).toBe("Beta");
        expect(after[0].versions[1]?.doc).toBe("Delta");
    });

    it("collapsed revision resolver removes a one-version revision when its text is deleted", async () => {
        view = createView("Alpha Beta Gamma");

        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(6, 10),
                "revision",
            ),
            currentlySelected: 0,
            versions: [{ doc: "Beta", label: "Original" }],
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

        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(6, 11),
                "revision",
            ),
            currentlySelected: 1,
            versions: [
                { doc: "Beta", label: "Original" },
                { doc: "Delta", label: "Edited" },
            ],
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
