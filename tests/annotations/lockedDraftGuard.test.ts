import {
    annotations as annotationExtensions,
    createComment,
    createCommentCommand,
    createRevision,
    createRevisionCommand,
    createSuggestion,
} from "$lib/editor/plugins/annotations";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
/**
 * Locked drafts load with EditorState.readOnly — annotation creation must
 * refuse on such states (#160), across keyboard commands and the
 * programmatic/AI entry points.
 */
import { history } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

let view: EditorView | undefined;
let parent: HTMLDivElement | undefined;

function makeView(readOnly: boolean): EditorView {
    const state = EditorState.create({
        doc: "hello world",
        selection: EditorSelection.single(0, 5),
        extensions: [
            history(),
            annotationExtensions(),
            ...(readOnly ? [EditorState.readOnly.of(true)] : []),
        ],
    });
    parent = document.createElement("div");
    document.body.appendChild(parent);
    view = new EditorView({ state, parent });
    return view;
}

function annotationCount(v: EditorView): number {
    return Object.keys(v.state.field(annotationField)).length;
}

afterEach(() => {
    view?.destroy();
    parent?.remove();
    view = undefined;
    parent = undefined;
});

describe("annotation creation on locked (read-only) drafts", () => {
    it("createCommentCommand refuses", () => {
        const v = makeView(true);
        const handled = createCommentCommand({ state: v.state, dispatch: (tr) => v.dispatch(tr) });
        expect(handled).toBe(false);
        expect(annotationCount(v)).toBe(0);
    });

    it("createRevisionCommand refuses", () => {
        const v = makeView(true);
        const handled = createRevisionCommand({ state: v.state, dispatch: (tr) => v.dispatch(tr) });
        expect(handled).toBe(false);
        expect(annotationCount(v)).toBe(0);
    });

    it("createComment (AI/programmatic) refuses", () => {
        const v = makeView(true);
        const created = createComment({ targetText: "hello", comment: "note", view: v });
        expect(created).toBe(false);
        expect(annotationCount(v)).toBe(0);
    });

    it("createSuggestion (AI/programmatic) refuses", () => {
        const v = makeView(true);
        const created = createSuggestion({
            targetText: "hello",
            replacements: ["hi"],
            state: v.state,
            dispatch: (tr) => v.dispatch(tr),
        });
        expect(created).toBe(false);
        expect(annotationCount(v)).toBe(0);
    });

    it("createRevision (AI/programmatic) refuses", () => {
        const v = makeView(true);
        const created = createRevision({
            targetText: "hello",
            versions: [{ label: "v1", text: "hi" }],
            threadMessage: "try this",
            view: v,
        });
        expect(created).toBe(false);
        expect(annotationCount(v)).toBe(0);
    });

    it("editable drafts still accept annotations (guard is readOnly-scoped)", () => {
        const v = makeView(false);
        const created = createComment({ targetText: "hello", comment: "note", view: v });
        expect(created).toBe(true);
        expect(annotationCount(v)).toBe(1);
    });
});
