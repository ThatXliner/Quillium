import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, historyField, redo, undo } from "@codemirror/commands";
import {
    annotationField,
    addAnnotation,
} from "$lib/editor/plugins/annotations/annotationField";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { createNewAnnotation, isAnnotationOfType } from "$lib/editor/plugins/annotations/models";

const roundtripFields = { historyField, annotationField };

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history(), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

let view: EditorView | undefined;
let restoredView: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    restoredView?.destroy();
    view = undefined;
    restoredView = undefined;
});

describe("persistence round-trip integration", () => {
    it("restores document text, annotations, and undo/redo history", () => {
        view = createView("Hello world");

        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(6, 11),
                "revision",
            ),
            currentlySelected: 0,
            versions: [{ doc: "world", label: "Original" }],
        };

        view.dispatch(view.state.update({ effects: [addAnnotation.of(revision)] }));
        view.dispatch({ changes: { from: 0, insert: "Draft: " } });

        expect(view.state.doc.toString()).toBe("Draft: Hello world");

        const saved = view.state.toJSON(roundtripFields);
        const restored = EditorState.fromJSON(
            saved,
            { extensions: [history(), annotationExtensions()] },
            roundtripFields,
        );

        const parent = document.createElement("div");
        document.body.appendChild(parent);
        restoredView = new EditorView({ state: restored, parent });

        expect(restoredView.state.doc.toString()).toBe("Draft: Hello world");
        const annotations = Object.values(restoredView.state.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "revision")).toBe(true);
        if (!isAnnotationOfType(annotations[0], "revision")) return;
        expect(annotations[0].versions[0]?.doc).toBe("world");

        expect(undo(restoredView)).toBe(true);
        expect(restoredView.state.doc.toString()).toBe("Hello world");

        expect(redo(restoredView)).toBe(true);
        expect(restoredView.state.doc.toString()).toBe("Draft: Hello world");
    });

    it("preserves comment annotation selections across serialize/deserialize", () => {
        view = createView("Alpha Beta Gamma");

        const comment = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(6, 10),
                "comment",
            ),
            thread: [{ message: "Check wording", author: "Reviewer", time: 1 }],
        };

        view.dispatch(view.state.update({ effects: [addAnnotation.of(comment)] }));

        const saved = view.state.toJSON(roundtripFields);
        const restored = EditorState.fromJSON(
            saved,
            { extensions: [history(), annotationExtensions()] },
            roundtripFields,
        );

        const annotations = Object.values(restored.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "comment")).toBe(true);
        if (!isAnnotationOfType(annotations[0], "comment")) return;

        const { from, to } = annotations[0].selection.main;
        expect(restored.sliceDoc(from, to)).toBe("Beta");
        expect(annotations[0].thread[0]?.message).toBe("Check wording");
    });
});
