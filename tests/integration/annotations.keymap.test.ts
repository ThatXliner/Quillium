import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { appSettings } from "$lib/settings.svelte";
import {
    annotationKeymap,
    annotations as annotationExtensions,
} from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
} from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import {
    annotationUiEvent,
} from "$lib/stores";

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

function runKey(view: EditorView, key: string) {
    const handlers = annotationKeymap.filter((binding) => binding.key === key);
    for (const handler of handlers) {
        const consumed = handler.run?.(view);
        if (consumed) return true;
    }
    return false;
}

function addRevision(view: EditorView, from: number, to: number) {
    const revision = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        currentlySelected: 0,
        versions: [{ doc: view.state.sliceDoc(from, to), label: "Original" }],
    };

    view.dispatch(view.state.update({ effects: [addAnnotation.of(revision)] }));
    return revision.id;
}

let view: EditorView | undefined;

beforeEach(() => {
    annotationUiEvent.set(null);
    appSettings.atomicRevisions = true;
});

afterEach(() => {
    view?.destroy();
    view = undefined;
});

describe("annotation keymap integration", () => {
    it("redirects Mod-Alt-k to nested editor when cursor is inside revision", () => {
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 8 } });
        const consumed = runKey(view, "Mod-Alt-k");

        expect(consumed).toBe(true);
        expect(get(annotationUiEvent)).toEqual(
            expect.objectContaining({
                type: "revision-open-nested-editor",
                command: {
                    revisionId,
                    type: "revision",
                    selectionFrom: 2,
                    selectionTo: 2,
                },
            }),
        );
    });

    it("redirects Mod-Alt-m to nested editor when cursor is inside revision", () => {
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 7 } });
        const consumed = runKey(view, "Mod-Alt-m");

        expect(consumed).toBe(true);
        expect(get(annotationUiEvent)).toEqual(
            expect.objectContaining({
                type: "revision-open-nested-editor",
                command: {
                    revisionId,
                    type: "comment",
                    selectionFrom: 1,
                    selectionTo: 1,
                },
            }),
        );
    });

    it("Backspace at revision start boundary fires nudge signal", () => {
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 6 } });
        const consumed = runKey(view, "Backspace");

        expect(consumed).toBe(false);
        expect(get(annotationUiEvent)).toEqual(
            expect.objectContaining({
                type: "revision-boundary-nudge",
                revisionId,
            }),
        );
    });

    it("Delete at revision end boundary fires nudge signal", () => {
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 10 } });
        const consumed = runKey(view, "Delete");

        expect(consumed).toBe(false);
        expect(get(annotationUiEvent)).toEqual(
            expect.objectContaining({
                type: "revision-boundary-nudge",
                revisionId,
            }),
        );
    });

    it("Backspace at revision end deletes adjacent revision range", () => {
        view = createView("Alpha Beta Gamma");
        addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 10 } });
        const consumed = runKey(view, "Backspace");

        expect(consumed).toBe(true);
        expect(view.state.doc.toString()).toBe("Alpha  Gamma");
        expect(Object.values(view.state.field(annotationField))).toHaveLength(0);
    });

    it("insert at revision boundary triggers boundaryInsertNudge plugin", () => {
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        view.dispatch({ changes: { from: 6, insert: "X" } });

        expect(get(annotationUiEvent)).toEqual(
            expect.objectContaining({
                type: "revision-boundary-nudge",
                revisionId,
            }),
        );
    });

    it("Mod-Alt-k creates revision when not inside any revision", () => {
        view = createView("Alpha Beta Gamma");

        view.dispatch({ selection: { anchor: 0, head: 5 } });
        const consumed = runKey(view, "Mod-Alt-k");

        expect(consumed).toBe(true);
        const annotations = Object.values(view.state.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "revision")).toBe(true);
    });
});
