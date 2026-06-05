import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation } from "$lib/editor/plugins/annotations/models";
import {
    applyMarkdownFormat,
    formatMarkdownSelection,
    type MarkdownFormat,
} from "$lib/editor/markdownFormatting";

describe("applyMarkdownFormat", () => {
    it("wraps a selection in bold markers", () => {
        const result = applyMarkdownFormat("hello world", 0, 5, "bold");
        expect(result.text).toBe("**hello** world");
        expect(result.selection).toEqual({ from: 2, to: 7 });
    });

    it("unwraps bold markers around the selected text", () => {
        const result = applyMarkdownFormat("**hello** world", 2, 7, "bold");
        expect(result.text).toBe("hello world");
        expect(result.selection).toEqual({ from: 0, to: 5 });
    });

    it("unwraps italic markers around the selected text", () => {
        const result = applyMarkdownFormat("_hello_ world", 1, 6, "italic");
        expect(result.text).toBe("hello world");
        expect(result.selection).toEqual({ from: 0, to: 5 });
    });

    it("inserts paired italic markers at the cursor", () => {
        const result = applyMarkdownFormat("hello", 5, 5, "italic");
        expect(result.text).toBe("hello__");
        expect(result.selection).toEqual({ from: 6, to: 6 });
    });

    it("toggles heading prefixes on the active line", () => {
        const applied = applyMarkdownFormat("Title", 0, 0, "heading1");
        expect(applied.text).toBe("# Title");

        const removed = applyMarkdownFormat(applied.text, 0, applied.text.length, "heading1");
        expect(removed.text).toBe("Title");
    });

    it("toggles heading levels 1 through 6", () => {
        const cases: [MarkdownFormat, string][] = [
            ["heading1", "# Title"],
            ["heading2", "## Title"],
            ["heading3", "### Title"],
            ["heading4", "#### Title"],
            ["heading5", "##### Title"],
            ["heading6", "###### Title"],
        ];
        for (const [format, expected] of cases) {
            const applied = applyMarkdownFormat("Title", 0, 0, format);
            expect(applied.text, `${format} prefix`).toBe(expected);

            const removed = applyMarkdownFormat(applied.text, 0, applied.text.length, format);
            expect(removed.text, `${format} removal`).toBe("Title");
        }
    });

    it("switches between heading levels in place", () => {
        const h2 = applyMarkdownFormat("### Title", 0, 9, "heading2");
        expect(h2.text).toBe("## Title");
    });

    it("adds bullet list prefixes to multiple lines", () => {
        const result = applyMarkdownFormat("alpha\nbeta", 0, 10, "bulletList");
        expect(result.text).toBe("- alpha\n- beta");
    });

    it("adds numbered list prefixes sequentially", () => {
        const result = applyMarkdownFormat("alpha\nbeta", 0, 10, "numberedList");
        expect(result.text).toBe("1. alpha\n2. beta");
    });

    it("toggles block quotes off when every line is quoted", () => {
        const result = applyMarkdownFormat("> alpha\n> beta", 0, 14, "blockquote");
        expect(result.text).toBe("alpha\nbeta");
    });
});

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

function addComment(view: EditorView, from: number, to: number) {
    const comment = createNewAnnotation(
        view.state.field(annotationField),
        EditorSelection.single(from, to),
        "comment",
    );
    view.dispatch(view.state.update({ effects: [addAnnotation.of(comment)] }));
    return comment.id;
}

let view: EditorView | undefined;

// Text covered by an annotation's primary range, in the current document.
function span(annotation: { selection: EditorSelection }) {
    const { from, to } = annotation.selection.main;
    return view!.state.sliceDoc(from, to);
}

afterEach(() => {
    view?.destroy();
    view = undefined;
});

describe("formatMarkdownSelection annotation preservation", () => {
    // Regression: the Mod-i/Mod-b shortcuts used to dispatch a full-doc replace
    // (from:0,to:doc.length), which remapped every annotation range to the
    // boundary, collapsed them to zero-width, and wiped them. Dispatching a
    // change scoped to the edited region keeps untouched text stable so
    // annotation positions survive.
    it("keeps an annotation on text untouched by an italic format elsewhere", () => {
        view = createView("Alpha Beta Gamma");
        // Annotate "Gamma" (11..16).
        const id = addComment(view, 11, 16);

        // Italicize "Alpha" (0..5) — a region that does not overlap the comment.
        view.dispatch({ selection: { anchor: 0, head: 5 } });
        formatMarkdownSelection(view, "italic");

        expect(view.state.doc.toString()).toBe("_Alpha_ Beta Gamma");

        const annotation = view.state.field(annotationField)[id];
        expect(annotation).toBeDefined();
        // "Gamma" shifted right by 2 (the two `_` tokens inserted before it).
        expect(annotation.selection.main.from).toBe(13);
        expect(annotation.selection.main.to).toBe(18);
        expect(
            view.state.sliceDoc(annotation.selection.main.from, annotation.selection.main.to),
        ).toBe("Gamma");
    });

    it("preserves annotations across every markdown format", () => {
        const formats: MarkdownFormat[] = [
            "bold",
            "italic",
            "strikethrough",
            "code",
            "heading1",
            "heading2",
            "heading3",
            "heading4",
            "heading5",
            "heading6",
            "bulletList",
            "numberedList",
            "blockquote",
        ];

        for (const format of formats) {
            view = createView("Alpha Beta Gamma");
            // Annotate "Gamma" at the end so line-prefix formats (headings,
            // lists, blockquote) applied to the first selection never touch it.
            const id = addComment(view, 11, 16);

            view.dispatch({ selection: { anchor: 0, head: 5 } });
            formatMarkdownSelection(view, format);

            const annotation = view.state.field(annotationField)[id];
            expect(annotation, `annotation dropped by "${format}"`).toBeDefined();
            expect(
                view.state.sliceDoc(annotation.selection.main.from, annotation.selection.main.to),
                `annotation range corrupted by "${format}"`,
            ).toBe("Gamma");

            view.destroy();
            view = undefined;
        }
    });

    it("toggling italic off restores the original document and annotation", () => {
        view = createView("Alpha Beta Gamma");
        const id = addComment(view, 11, 16);

        view.dispatch({ selection: { anchor: 0, head: 5 } });
        formatMarkdownSelection(view, "italic"); // wrap → "_Alpha_ Beta Gamma"
        formatMarkdownSelection(view, "italic"); // unwrap → "Alpha Beta Gamma"

        expect(view.state.doc.toString()).toBe("Alpha Beta Gamma");
        const annotation = view.state.field(annotationField)[id];
        expect(annotation).toBeDefined();
        expect(annotation.selection.main.from).toBe(11);
        expect(annotation.selection.main.to).toBe(16);
    });

    it("leaves an annotation before the edit untouched", () => {
        view = createView("Alpha Beta Gamma");
        const id = addComment(view, 0, 5); // "Alpha"

        // Italicize "Gamma" (11..16), entirely after the annotation.
        view.dispatch({ selection: { anchor: 11, head: 16 } });
        formatMarkdownSelection(view, "italic");

        expect(view.state.doc.toString()).toBe("Alpha Beta _Gamma_");
        const annotation = view.state.field(annotationField)[id];
        expect(annotation.selection.main.from).toBe(0);
        expect(annotation.selection.main.to).toBe(5);
        expect(span(annotation)).toBe("Alpha");
    });

    it("keeps an annotation valid when its exact range is wrapped", () => {
        view = createView("Alpha Beta Gamma");
        const id = addComment(view, 6, 10); // "Beta"

        // Wrap the annotated text itself. The tokens insert at the boundaries;
        // the annotation must still cover "Beta", now sitting inside the markers.
        view.dispatch({ selection: { anchor: 6, head: 10 } });
        formatMarkdownSelection(view, "italic");

        expect(view.state.doc.toString()).toBe("Alpha _Beta_ Gamma");
        const annotation = view.state.field(annotationField)[id];
        expect(annotation).toBeDefined();
        expect(span(annotation)).toBe("Beta");
    });

    it("preserves two separate annotations when formatting between them", () => {
        view = createView("Alpha Beta Gamma");
        const a = addComment(view, 0, 5); // "Alpha"
        const b = addComment(view, 11, 16); // "Gamma"

        // Bold "Beta" (6..10), sitting between the two annotations.
        view.dispatch({ selection: { anchor: 6, head: 10 } });
        formatMarkdownSelection(view, "bold");

        expect(view.state.doc.toString()).toBe("Alpha **Beta** Gamma");
        const annA = view.state.field(annotationField)[a];
        const annB = view.state.field(annotationField)[b];
        expect(span(annA)).toBe("Alpha"); // before the edit — unmoved
        expect(annA.selection.main.from).toBe(0);
        expect(span(annB)).toBe("Gamma"); // after the edit — shifted by 4
        expect(annB.selection.main.from).toBe(15);
    });

    it("preserves an annotation on a later line when a heading is added to the first", () => {
        view = createView("Title\nBeta Gamma");
        const id = addComment(view, 6, 16); // "Beta Gamma" on line 2

        view.dispatch({ selection: { anchor: 0 } });
        formatMarkdownSelection(view, "heading1");

        expect(view.state.doc.toString()).toBe("# Title\nBeta Gamma");
        const annotation = view.state.field(annotationField)[id];
        expect(annotation).toBeDefined();
        expect(span(annotation)).toBe("Beta Gamma"); // shifted by 2 (the "# ")
        expect(annotation.selection.main.from).toBe(8);
    });

    it("preserves a mid-line annotation when a list prefixes every line (per-line diff path)", () => {
        // Exercises transformLines/diffLine: each line gets a "- " prefix, and
        // an annotation in the unchanged middle of line 2 must remain exact.
        view = createView("alpha\nbeta gamma delta");
        const id = addComment(view, 11, 16); // "gamma" on line 2

        view.dispatch({ selection: { anchor: 0, head: 21 } });
        formatMarkdownSelection(view, "bulletList");

        expect(view.state.doc.toString()).toBe("- alpha\n- beta gamma delta");
        const annotation = view.state.field(annotationField)[id];
        expect(annotation).toBeDefined();
        expect(span(annotation)).toBe("gamma"); // shifted by 4 (two "- " prefixes)
        expect(annotation.selection.main.from).toBe(15);
    });

    it("preserves a multi-line annotation across a list toggle", () => {
        view = createView("alpha\nbeta");
        const id = addComment(view, 0, 10); // spans both lines: "alpha\nbeta"

        view.dispatch({ selection: { anchor: 0, head: 10 } });
        formatMarkdownSelection(view, "bulletList");

        expect(view.state.doc.toString()).toBe("- alpha\n- beta");
        const annotation = view.state.field(annotationField)[id];
        expect(annotation).toBeDefined();
        // from shifts past the first "- "; the range still ends at doc end.
        expect(span(annotation)).toBe("alpha\n- beta");
    });
});

describe("change-spec shape", () => {
    // The editor dispatches `changes`, not `text` — assert the surgical specs
    // directly so a builder that emits wrong changes but right text is caught.
    it("wrapping a selection inserts tokens only at the boundaries", () => {
        const { changes } = applyMarkdownFormat("Alpha Beta", 0, 5, "bold");
        expect(changes).toEqual([
            { from: 0, to: 0, insert: "**" },
            { from: 5, to: 5, insert: "**" },
        ]);
    });

    it("an empty selection inserts a single paired token", () => {
        const { changes } = applyMarkdownFormat("Alpha", 5, 5, "italic");
        expect(changes).toEqual([{ from: 5, to: 5, insert: "__" }]);
    });

    it("unwrapping deletes the outer tokens without touching the text", () => {
        const { changes } = applyMarkdownFormat("_hello_ world", 1, 6, "italic");
        expect(changes).toEqual([
            { from: 0, to: 1, insert: "" },
            { from: 6, to: 7, insert: "" },
        ]);
    });

    it("a list format emits one minimal change per line, none for unchanged lines", () => {
        const { changes } = applyMarkdownFormat("alpha\nbeta", 0, 10, "bulletList");
        expect(changes).toEqual([
            { from: 0, to: 0, insert: "- " },
            { from: 6, to: 6, insert: "- " },
        ]);
    });
});
