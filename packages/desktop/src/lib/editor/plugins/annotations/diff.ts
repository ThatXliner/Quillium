/**
 * diff.ts — Inline diff widget for suggestion previews.
 *
 * The word-level diff itself lives in $lib/editor/diff (shared with the
 * version-history preview); this module keeps only the CodeMirror widget
 * that renders it inline.
 */

import { wordDiff } from "$lib/editor/diff";
import { WidgetType } from "@codemirror/view";

export class SuggestionDiffWidget extends WidgetType {
    constructor(
        readonly original: string,
        readonly replacement: string,
    ) {
        super();
    }
    eq(other: SuggestionDiffWidget) {
        return this.original === other.original && this.replacement === other.replacement;
    }
    toDOM() {
        const ops = wordDiff(this.original, this.replacement);
        const span = document.createElement("span");
        span.className = "cm-suggestion-diff";
        for (const op of ops) {
            if (op.type === "equal") {
                span.appendChild(document.createTextNode(op.text));
            } else if (op.type === "delete") {
                const del = document.createElement("span");
                del.className = "cm-suggestion-diff-del";
                del.textContent = op.text;
                span.appendChild(del);
            } else {
                const ins = document.createElement("span");
                ins.className = "cm-suggestion-diff-ins";
                ins.textContent = op.text;
                span.appendChild(ins);
            }
        }
        return span;
    }
    ignoreEvent() {
        return true;
    }
}
