import { syntaxTree } from "@codemirror/language";
import type { EditorSelection, EditorState, Extension, Range } from "@codemirror/state";
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";

const hiddenMarkdownMark = Decoration.replace({});
const strongMark = Decoration.mark({ class: "cm-rich-markdown-strong" });
const emphasisMark = Decoration.mark({ class: "cm-rich-markdown-emphasis" });
const headingLineMarks = {
    ATXHeading1: Decoration.line({ class: "cm-rich-markdown-heading cm-rich-markdown-heading-1" }),
    ATXHeading2: Decoration.line({ class: "cm-rich-markdown-heading cm-rich-markdown-heading-2" }),
    ATXHeading3: Decoration.line({ class: "cm-rich-markdown-heading cm-rich-markdown-heading-3" }),
    ATXHeading4: Decoration.line({ class: "cm-rich-markdown-heading cm-rich-markdown-heading-4" }),
    ATXHeading5: Decoration.line({ class: "cm-rich-markdown-heading cm-rich-markdown-heading-5" }),
    ATXHeading6: Decoration.line({ class: "cm-rich-markdown-heading cm-rich-markdown-heading-6" }),
};

type HeadingName = keyof typeof headingLineMarks;

function selectionTouches(selection: EditorSelection, from: number, to: number) {
    return selection.ranges.some((range) =>
        range.empty ? range.from >= from && range.from <= to : range.from <= to && range.to >= from,
    );
}

function childMarks(node: SyntaxNode, name: string) {
    return node.getChildren(name);
}

function hideNodeMarks(ranges: Range<Decoration>[], node: SyntaxNodeRef, markName: string) {
    for (const mark of childMarks(node.node, markName)) {
        ranges.push(hiddenMarkdownMark.range(mark.from, mark.to));
    }
}

function hideHeadingMarks(
    ranges: Range<Decoration>[],
    node: SyntaxNodeRef,
    doc: EditorState["doc"],
) {
    for (const mark of childMarks(node.node, "HeaderMark")) {
        let to = mark.to;
        if (mark.from === node.from) {
            while (to < node.to && /\s/.test(doc.sliceString(to, to + 1))) to += 1;
        }
        ranges.push(hiddenMarkdownMark.range(mark.from, to));
    }
}

function markContentBetweenDelimiters(
    ranges: Range<Decoration>[],
    node: SyntaxNodeRef,
    decoration: Decoration,
) {
    const marks = childMarks(node.node, "EmphasisMark");
    if (marks.length >= 2) {
        const from = marks[0].to;
        const to = marks[marks.length - 1].from;
        if (from < to) ranges.push(decoration.range(from, to));
        return;
    }

    ranges.push(decoration.range(node.from, node.to));
}

export function _buildRichMarkdownDecorationsForTree(
    tree: Tree,
    state: Pick<EditorState, "selection" | "doc">,
): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const { selection, doc } = state;

    tree.iterate({
        enter(node) {
            if (node.name === "StrongEmphasis") {
                markContentBetweenDelimiters(ranges, node, strongMark);
                if (!selectionTouches(selection, node.from, node.to)) {
                    hideNodeMarks(ranges, node, "EmphasisMark");
                }
                return;
            }

            if (node.name === "Emphasis") {
                markContentBetweenDelimiters(ranges, node, emphasisMark);
                if (!selectionTouches(selection, node.from, node.to)) {
                    hideNodeMarks(ranges, node, "EmphasisMark");
                }
                return;
            }

            if (node.name in headingLineMarks) {
                const line = doc.lineAt(node.from);
                ranges.push(headingLineMarks[node.name as HeadingName].range(line.from));
                if (!selectionTouches(selection, node.from, node.to)) {
                    hideHeadingMarks(ranges, node, doc);
                }
            }
        },
    });

    return Decoration.set(ranges, true);
}

function buildRichMarkdownDecorations(view: EditorView): DecorationSet {
    return _buildRichMarkdownDecorationsForTree(syntaxTree(view.state), view.state);
}

const richMarkdownPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildRichMarkdownDecorations(view);
        }

        update(update: ViewUpdate) {
            if (
                update.docChanged ||
                update.selectionSet ||
                update.viewportChanged ||
                syntaxTree(update.startState) !== syntaxTree(update.state)
            ) {
                this.decorations = buildRichMarkdownDecorations(update.view);
            }
        }
    },
    {
        decorations: (plugin) => plugin.decorations,
    },
);

const richMarkdownTheme = EditorView.baseTheme({
    ".cm-rich-markdown-strong": {
        fontWeight: "700",
    },
    ".cm-rich-markdown-emphasis": {
        fontStyle: "italic",
    },
    ".cm-line.cm-rich-markdown-heading": {
        color: "rgba(0, 0, 0, 0.82)",
        fontWeight: "700",
        lineHeight: "1.25",
        textIndent: "0",
    },
    ".cm-line.cm-rich-markdown-heading-1": {
        fontSize: "1.55em",
        paddingBottom: "0.12em",
        paddingTop: "0.4em",
    },
    ".cm-line.cm-rich-markdown-heading-2": {
        fontSize: "1.3em",
        paddingBottom: "0.08em",
        paddingTop: "0.3em",
    },
    ".cm-line.cm-rich-markdown-heading-3": {
        fontSize: "1.15em",
        paddingBottom: "0.06em",
        paddingTop: "0.25em",
    },
    ".cm-line.cm-rich-markdown-heading-4": {
        fontSize: "1.05em",
        paddingBottom: "0.04em",
        paddingTop: "0.2em",
    },
    ".cm-line.cm-rich-markdown-heading-5": {
        fontSize: "1em",
        paddingBottom: "0.04em",
        paddingTop: "0.18em",
    },
    ".cm-line.cm-rich-markdown-heading-6": {
        color: "rgba(0, 0, 0, 0.6)",
        fontSize: "0.9em",
        paddingBottom: "0.04em",
        paddingTop: "0.16em",
    },
});

export function richMarkdownExtension(): Extension {
    return [richMarkdownPlugin, richMarkdownTheme];
}
