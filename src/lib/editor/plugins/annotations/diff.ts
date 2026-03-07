/**
 * diff.ts — Inline diff utilities for suggestion previews.
 *
 * Provides word-level LCS diff between original and replacement
 * text, used by SuggestionDiffWidget to render inline diffs.
 */

import { WidgetType } from "@codemirror/view";

// -------------------------------------------------------
// Inline diff helpers
//
// tokenize() splits text into word/whitespace tokens.
// diffTokens() computes an LCS-based diff producing
// equal/delete/insert operations.
// -------------------------------------------------------
export function tokenize(text: string): string[] {
    return text.match(/\S+|\s+/g) ?? [];
}

export type DiffOp = { type: "equal" | "delete" | "insert"; text: string };

export function diffTokens(aTokens: string[], bTokens: string[]): DiffOp[] {
    const m = aTokens.length;
    const n = bTokens.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
        new Array(n + 1).fill(0),
    );
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            if (aTokens[i] === bTokens[j]) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }
    const ops: DiffOp[] = [];
    let i = 0;
    let j = 0;
    while (i < m || j < n) {
        if (i < m && j < n && aTokens[i] === bTokens[j]) {
            ops.push({ type: "equal", text: aTokens[i] });
            i++;
            j++;
        } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
            ops.push({ type: "insert", text: bTokens[j] });
            j++;
        } else {
            ops.push({ type: "delete", text: aTokens[i] });
            i++;
        }
    }
    // Merge adjacent same-type ops
    const merged: DiffOp[] = [];
    for (const op of ops) {
        const last = merged[merged.length - 1];
        if (last && last.type === op.type) last.text += op.text;
        else merged.push({ ...op });
    }
    return merged;
}

export class SuggestionDiffWidget extends WidgetType {
    constructor(
        readonly original: string,
        readonly replacement: string,
    ) {
        super();
    }
    eq(other: SuggestionDiffWidget) {
        return (
            this.original === other.original &&
            this.replacement === other.replacement
        );
    }
    toDOM() {
        const ops = diffTokens(
            tokenize(this.original),
            tokenize(this.replacement),
        );
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
