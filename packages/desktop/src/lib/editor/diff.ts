/**
 * diff.ts — Pure word-level text diff shared across the editor.
 *
 * Single implementation used by suggestion previews (SuggestionDiffWidget,
 * Suggestion.svelte, DiffModal.svelte) and the version-history track-changes
 * preview (history/diffDecorations.ts). Word granularity (not char) keeps the
 * highlight readable for prose. No deps — a small LCS over tokens.
 */

/** One run of unchanged / removed / added text in a diff. */
export type DiffOp = { type: "equal" | "delete" | "insert"; text: string };

/**
 * Splits text into diff tokens, keeping whitespace as its own tokens so the
 * reconstructed output preserves spacing and newlines exactly.
 */
export function tokenize(text: string): string[] {
    // Each token is either a run of whitespace or a run of non-whitespace.
    return text.match(/\S+|\s+/g) ?? [];
}

/**
 * Word-level diff of `before` → `after`. Returns ops in order; adjacent
 * tokens of the same type are coalesced into one op. An empty `before`
 * yields all-insert; an empty `after` yields all-delete.
 *
 * The common prefix and suffix are trimmed before the LCS dynamic-program
 * runs, so the O(n·m) table covers only the CHANGED middle — a small edit in
 * a long document stays cheap regardless of document length. If the changed
 * middle alone still exceeds the cap (a wholesale rewrite), the middle falls
 * back to one coarse delete+insert pair: still truthful ("all of this was
 * replaced"), unlike pretending nothing changed.
 */
export function wordDiff(before: string, after: string): DiffOp[] {
    const a = tokenize(before);
    const b = tokenize(after);

    // Trim the common prefix/suffix; only the middle needs the LCS. The
    // suffix scan is bounded so it never overlaps the prefix.
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let end = 0;
    while (
        end < a.length - start &&
        end < b.length - start &&
        a[a.length - 1 - end] === b[b.length - 1 - end]
    )
        end++;

    const aMid = a.slice(start, a.length - end);
    const bMid = b.slice(start, b.length - end);
    const raw: DiffOp[] = [];
    if (start > 0) raw.push({ type: "equal", text: a.slice(0, start).join("") });
    diffTokens(aMid, bMid, raw);
    if (end > 0) raw.push({ type: "equal", text: a.slice(a.length - end).join("") });

    // Coalesce adjacent same-type runs so the renderer emits fewer nodes.
    const out: DiffOp[] = [];
    for (const op of raw) {
        const last = out[out.length - 1];
        if (last && last.type === op.type) last.text += op.text;
        else out.push({ ...op });
    }
    return out;
}

/** LCS over the trimmed middle, appending equal/delete/insert ops to `raw`. */
function diffTokens(a: string[], b: string[], raw: DiffOp[]): void {
    const n = a.length;
    const m = b.length;
    const maxCells = 1_000_000;

    if (n === 0 && m === 0) return;
    if (n * m > maxCells) {
        // Wholesale rewrite: one coarse replacement instead of an O(n·m)
        // table that would lock the renderer.
        if (n > 0) raw.push({ type: "delete", text: a.join("") });
        if (m > 0) raw.push({ type: "insert", text: b.join("") });
        return;
    }

    // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] =
                a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }

    // Walk the table, emitting equal/delete/insert tokens.
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            raw.push({ type: "equal", text: a[i] });
            i++;
            j++;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            raw.push({ type: "delete", text: a[i] });
            i++;
        } else {
            raw.push({ type: "insert", text: b[j] });
            j++;
        }
    }
    while (i < n) raw.push({ type: "delete", text: a[i++] });
    while (j < m) raw.push({ type: "insert", text: b[j++] });
}
