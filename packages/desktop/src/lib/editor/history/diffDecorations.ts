/**
 * diffDecorations.ts — Track-changes decorations for the history preview.
 *
 * Given the previous and current document text, produces CodeMirror extensions
 * for both history layouts:
 *
 * - Inline: additions are marked in the current document and removals are
 *   injected as strikethrough widgets where they used to appear.
 * - Side by side: removals are marked in the previous document while additions
 *   are marked in the selected document.
 *
 * Because real editor views render both layouts, typography and Markdown
 * treatment stay faithful to the writing surface.
 */
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { type DiffOp, wordDiff } from "../diff";

/** Renders a removed run as inline red, struck-through text. */
class DeletionWidget extends WidgetType {
    constructor(readonly text: string) {
        super();
    }
    eq(other: DeletionWidget) {
        return other.text === this.text;
    }
    toDOM() {
        const deletion = document.createElement("del");
        deletion.className = "cm-history-diff-del";
        deletion.textContent = this.text;
        return deletion;
    }
    ignoreEvent() {
        return true;
    }
}

const addedMark = Decoration.mark({ tagName: "ins", class: "cm-history-diff-add" });
const removedMark = Decoration.mark({ tagName: "del", class: "cm-history-diff-del" });

export type SideBySideDiffPane = "previous" | "selected";

/**
 * Builds the decoration set from the word diff. Offsets track position in the
 * CURRENT document (`insert`/`equal` advance it; `delete` injects a widget
 * there). The document the decorations apply to must equal the diff's "after"
 * text — i.e. the current snapshot's text — for the offsets to line up.
 */
function buildDecorations(segments: DiffOp[], docLength: number): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    let pos = 0;
    for (const seg of segments) {
        if (seg.type === "equal") {
            pos += seg.text.length;
        } else if (seg.type === "insert") {
            const end = Math.min(pos + seg.text.length, docLength);
            if (end > pos) builder.add(pos, end, addedMark);
            pos = end;
        } else {
            // Deletion: not present in the current doc — inject at `pos`.
            builder.add(
                Math.min(pos, docLength),
                Math.min(pos, docLength),
                Decoration.widget({ widget: new DeletionWidget(seg.text), side: -1 }),
            );
        }
    }
    return builder.finish();
}

/**
 * A CodeMirror extension that paints track-changes for `current` vs `previous`.
 * The view it's added to MUST hold the `current` text (build it from the current
 * snapshot). Callers with no comparable previous version should omit this
 * extension; an empty string is still a valid, comparable prior document.
 */
export function diffDecorations(previous: string, current: string): Extension {
    const segments = wordDiff(previous, current);
    return EditorView.decorations.of((view) => buildDecorations(segments, view.state.doc.length));
}

/**
 * Paints only the operations that belong in one side-by-side pane. Positions
 * advance through the text rendered by that pane: equal + delete for the
 * previous version, equal + insert for the selected version.
 */
function buildSideBySideDecorations(
    segments: DiffOp[],
    pane: SideBySideDiffPane,
    docLength: number,
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    let pos = 0;

    for (const segment of segments) {
        if (segment.type === "equal") {
            pos += segment.text.length;
            continue;
        }

        const belongsInPane =
            (pane === "previous" && segment.type === "delete") ||
            (pane === "selected" && segment.type === "insert");
        if (!belongsInPane) continue;

        const end = Math.min(pos + segment.text.length, docLength);
        if (end > pos) {
            builder.add(pos, end, pane === "previous" ? removedMark : addedMark);
        }
        pos = end;
    }

    return builder.finish();
}

/** Marks removals in the previous pane or additions in the selected pane. */
export function sideBySideDiffDecorations(
    previous: string,
    current: string,
    pane: SideBySideDiffPane,
): Extension {
    const segments = wordDiff(previous, current);
    return EditorView.decorations.of((view) =>
        buildSideBySideDecorations(segments, pane, view.state.doc.length),
    );
}

/** Theme for the track-changes marks/widgets, matching the suggestion-diff look. */
export const diffTheme = EditorView.baseTheme({
    ".cm-history-diff-add": {
        backgroundColor: "rgb(187 247 208)", // green-200
        borderRadius: "2px",
        textDecoration: "underline",
        textDecorationColor: "rgb(22 163 74)", // green-600
        textDecorationThickness: "2px",
        textUnderlineOffset: "2px",
    },
    ".cm-history-diff-del": {
        backgroundColor: "rgb(254 202 202)", // red-200
        color: "rgba(0, 0, 0, 0.55)",
        textDecoration: "line-through",
        borderRadius: "2px",
    },
});
