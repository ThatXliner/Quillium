import { diffDecorations, diffTheme } from "$lib/editor/history/diffDecorations";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

function mount(previous: string, current: string) {
    const state = EditorState.create({
        doc: current,
        extensions: [diffTheme, diffDecorations(previous, current)],
    });
    // Constructing the view forces the decoration facet to evaluate.
    const view = new EditorView({ state });
    const html = view.dom.querySelector(".cm-content")?.innerHTML ?? "";
    view.destroy();
    return html;
}

describe("diffDecorations build", () => {
    it("renders adds and dels without throwing on a replacement", () => {
        const html = mount("hello world here", "hello there here");
        expect(html).toContain("cm-history-diff-add");
        expect(html).toContain("cm-history-diff-del");
    });
    it("handles all-added (no previous)", () => {
        expect(() => mount("", "brand new text")).not.toThrow();
    });
    it("handles identical text", () => {
        expect(() => mount("same text", "same text")).not.toThrow();
    });
});
