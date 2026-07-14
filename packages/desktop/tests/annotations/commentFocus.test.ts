import Thread from "$lib/editor/plugins/annotations/Thread.svelte";
/**
 * commentFocus.test.ts — Selection restoration contracts for comment dismissal.
 */
import {
    captureCommentEditorPosition,
    restoreCommentEditorPosition,
} from "$lib/editor/plugins/annotations/commentFocus";
import { clearDraft, getDraft } from "$lib/editor/plugins/annotations/drafts.svelte";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

let views: EditorView[] = [];

function createView(doc: string, selection: EditorSelection): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
        state: EditorState.create({ doc, selection }) as unknown as EditorView["state"],
        parent,
    });
    views.push(view);
    return view;
}

afterEach(() => {
    cleanup();
    clearDraft(299);
    for (const view of views) view.destroy();
    views = [];
});

describe("comment editor position restoration", () => {
    it("restores the originating selection, focus, and scroll request", () => {
        const origin = EditorSelection.single(2, 6);
        const view = createView("abcdefgh", origin);
        const captured = captureCommentEditorPosition(view);
        view.dispatch({ selection: EditorSelection.cursor(8) });
        const dispatch = vi.spyOn(view, "dispatch");
        const focus = vi.spyOn(view, "focus");

        restoreCommentEditorPosition(view, captured);

        expect(view.state.selection.main.anchor).toBe(origin.main.anchor);
        expect(view.state.selection.main.head).toBe(origin.main.head);
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ scrollIntoView: true }));
        expect(focus).toHaveBeenCalledOnce();
    });

    it("keeps an unsent inline reply while restoring its owning editor", async () => {
        const origin = EditorSelection.single(1, 4);
        const view = createView("abcdefgh", origin);
        const { getByPlaceholderText } = render(Thread, {
            props: {
                thread: [{ message: "Existing comment", author: "Writer", time: 1 }],
                updateThread: vi.fn(),
                annotationId: 299,
                view,
            },
        });
        const textarea = getByPlaceholderText("Reply…") as HTMLTextAreaElement;

        await fireEvent.focus(textarea);
        await fireEvent.input(textarea, { target: { value: "Unsent reply" } });
        view.dispatch({ selection: EditorSelection.cursor(8) });
        await fireEvent.keyDown(textarea, { key: "Escape" });

        expect(getDraft(299)).toBe("Unsent reply");
        expect(view.state.selection.main.anchor).toBe(origin.main.anchor);
        expect(view.state.selection.main.head).toBe(origin.main.head);
        expect(document.activeElement).toBe(view.contentDOM);
    });

    it("clamps a saved selection when the document became shorter", () => {
        const view = createView("abcdefgh", EditorSelection.single(4, 8));
        const captured = captureCommentEditorPosition(view);
        view.dispatch({ changes: { from: 3, to: 8 } });

        restoreCommentEditorPosition(view, captured);

        expect(view.state.selection.main.anchor).toBe(3);
        expect(view.state.selection.main.head).toBe(3);
    });
});
