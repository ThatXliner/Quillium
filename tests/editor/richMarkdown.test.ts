import { _buildRichMarkdownDecorationsForTree } from "$lib/editor/richMarkdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { parser } from "@lezer/markdown";
import { afterEach, describe, expect, it } from "vitest";

let view: EditorView | undefined;

function createView(doc: string, selection = EditorSelection.cursor(doc.length)) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const baseState = EditorState.create({ doc, selection });
    const decorations = _buildRichMarkdownDecorationsForTree(parser.parse(doc), baseState);
    const state = EditorState.create({
        doc,
        selection,
        extensions: [EditorView.decorations.of(decorations)],
    });
    view = new EditorView({ state, parent });
    return view;
}

afterEach(() => {
    const parent = view?.dom.parentElement;
    view?.destroy();
    parent?.remove();
    view = undefined;
});

describe("richMarkdownExtension", () => {
    it("hides emphasis markers and keeps rendered text styled when the cursor is outside", () => {
        const editor = createView("This is **bold** and _soft_.");

        expect(editor.dom.textContent).toBe("This is bold and soft.");
        expect(editor.dom.querySelector(".cm-rich-markdown-strong")?.textContent).toBe("bold");
        expect(editor.dom.querySelector(".cm-rich-markdown-emphasis")?.textContent).toBe("soft");
    });

    it("reveals markers for the formatted span under the cursor", () => {
        const editor = createView("This is **bold**.", EditorSelection.cursor(11));

        expect(editor.dom.textContent).toBe("This is **bold**.");
        expect(editor.dom.querySelector(".cm-rich-markdown-strong")?.textContent).toBe("bold");
    });

    it("renders heading lines and hides header marks outside the active heading", () => {
        const editor = createView("# Title\n\nBody");
        const heading = editor.dom.querySelector(".cm-rich-markdown-heading-1");

        expect(heading?.classList.contains("cm-rich-markdown-heading")).toBe(true);
        expect(heading?.textContent).toBe("Title");
        expect(editor.dom.textContent).toContain("Title");
    });

    it("renders all six heading levels with their level-specific class", () => {
        for (let level = 1; level <= 6; level++) {
            const editor = createView(`${"#".repeat(level)} Title\n\nBody`);
            const heading = editor.dom.querySelector(`.cm-rich-markdown-heading-${level}`);

            expect(heading?.classList.contains("cm-rich-markdown-heading"), `h${level} class`).toBe(
                true,
            );
            expect(heading?.textContent, `h${level} text`).toBe("Title");
        }
    });
});
