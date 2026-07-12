import {
    type SideBySideDiffPane,
    diffDecorations,
    diffTheme,
    sideBySideDiffDecorations,
} from "$lib/editor/history/diffDecorations";
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

function mountSide(previous: string, current: string, pane: SideBySideDiffPane) {
    const doc = pane === "previous" ? previous : current;
    const state = EditorState.create({
        doc,
        extensions: [diffTheme, sideBySideDiffDecorations(previous, current, pane)],
    });
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

describe("sideBySideDiffDecorations", () => {
    it("marks removed text only in the previous pane", () => {
        const previous = mountSide("hello old world", "hello new world", "previous");
        const selected = mountSide("hello old world", "hello new world", "selected");

        expect(previous).toContain("cm-history-diff-del");
        expect(previous).not.toContain("cm-history-diff-add");
        expect(selected).toContain("cm-history-diff-add");
        expect(selected).not.toContain("cm-history-diff-del");
    });

    it("keeps the exact pane text for insertions and deletions", () => {
        const previous = mountSide("alpha beta", "alpha beta gamma", "previous");
        const selected = mountSide("alpha beta", "alpha beta gamma", "selected");

        expect(previous.replace(/<[^>]+>/g, "")).toBe("alpha beta");
        expect(selected.replace(/<[^>]+>/g, "")).toBe("alpha beta gamma");
    });

    it("adds no marks when the versions are identical", () => {
        const previous = mountSide("same text", "same text", "previous");
        const selected = mountSide("same text", "same text", "selected");

        expect(previous).not.toContain("cm-history-diff-");
        expect(selected).not.toContain("cm-history-diff-");
    });
});
