/**
 * diffDecorations.ts — Track-changes decorations for the history preview.
 *
 * Given the previous and current document text, produces a CodeMirror extension
 * that overlays track-changes highlighting on a read-only EditorView built from
 * the CURRENT document: added runs get a green mark; removed runs (absent from
 * the current doc) are injected as red strikethrough widgets at the position
 * they used to occupy. Because the editor itself renders the prose, the font,
 * spacing, width and theme match the real editor exactly.
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
        const span = document.createElement("span");
        span.className = "cm-history-diff-del";
        span.textContent = this.text;
        return span;
    }
    ignoreEvent() {
        return true;
    }
}

const addedMark = Decoration.mark({ class: "cm-history-diff-add" });

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
 * snapshot). When there is no previous version, pass "" — everything shows as
 * added, matching "this is all new."
 */
export function diffDecorations(previous: string, current: string): Extension {
    const segments = wordDiff(previous, current);
    return EditorView.decorations.of((view) => buildDecorations(segments, view.state.doc.length));
}

/** Theme for the track-changes marks/widgets, matching the suggestion-diff look. */
export const diffTheme = EditorView.baseTheme({
    ".cm-history-diff-add": {
        backgroundColor: "rgb(187 247 208)", // green-200
        borderRadius: "2px",
    },
    ".cm-history-diff-del": {
        backgroundColor: "rgb(254 202 202)", // red-200
        color: "rgba(0, 0, 0, 0.55)",
        textDecoration: "line-through",
        borderRadius: "2px",
    },
});
