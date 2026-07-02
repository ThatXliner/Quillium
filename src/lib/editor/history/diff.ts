/**
 * diff.ts — Pure word-level text diff for the version-history preview.
 *
 * Renders track-changes ("Google Docs") highlighting: a coordinate's content vs.
 * the same draft's immediately-previous content. Word granularity (not char)
 * keeps the highlight readable for prose. No deps — a small LCS over tokens.
 */

/** One run of unchanged / added / removed text in a diff. */
export type DiffSegment = { type: "same" | "add" | "del"; text: string };

/**
 * Pulls the plain document text out of a serialized `EditorState`
 * (`EditorState.toJSON()`), whose `doc` is a string or an array of line
 * strings. Returns "" for empty/missing/unparseable input.
 */
export function docTextFromStateJson(json: string | null): string {
    if (!json || json === "{}") return "";
    try {
        const parsed = JSON.parse(json) as { doc?: string | string[] };
        const doc = parsed.doc;
        if (Array.isArray(doc)) return doc.join("\n");
        return typeof doc === "string" ? doc : "";
    } catch {
        return "";
    }
}

/**
 * Splits text into diff tokens, keeping whitespace as its own tokens so the
 * reconstructed output preserves spacing and newlines exactly.
 */
function tokenize(text: string): string[] {
    // Each token is either a run of whitespace or a run of non-whitespace.
    return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Word-level diff of `before` → `after`. Returns segments in order; adjacent
 * tokens of the same type are coalesced into one segment. An empty `before`
 * yields all-add; an empty `after` yields all-del.
 *
 * The common prefix and suffix are trimmed before the LCS dynamic-program
 * runs, so the O(n·m) table covers only the CHANGED middle — a small edit in
 * a long document stays cheap regardless of document length. If the changed
 * middle alone still exceeds the cap (a wholesale rewrite), the middle falls
 * back to one coarse del+add pair: still truthful ("all of this was
 * replaced"), unlike pretending nothing changed.
 */
export function wordDiff(before: string, after: string): DiffSegment[] {
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
    const raw: DiffSegment[] = [];
    if (start > 0) raw.push({ type: "same", text: a.slice(0, start).join("") });
    diffTokens(aMid, bMid, raw);
    if (end > 0) raw.push({ type: "same", text: a.slice(a.length - end).join("") });

    // Coalesce adjacent same-type runs so the renderer emits fewer nodes.
    const out: DiffSegment[] = [];
    for (const seg of raw) {
        const last = out[out.length - 1];
        if (last && last.type === seg.type) last.text += seg.text;
        else out.push({ ...seg });
    }
    return out;
}

/** LCS over the trimmed middle, appending same/del/add tokens to `raw`. */
function diffTokens(a: string[], b: string[], raw: DiffSegment[]): void {
    const n = a.length;
    const m = b.length;
    const maxCells = 1_000_000;

    if (n === 0 && m === 0) return;
    if (n * m > maxCells) {
        // Wholesale rewrite: one coarse replacement instead of an O(n·m)
        // table that would lock the renderer.
        if (n > 0) raw.push({ type: "del", text: a.join("") });
        if (m > 0) raw.push({ type: "add", text: b.join("") });
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

    // Walk the table, emitting same/del/add tokens.
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            raw.push({ type: "same", text: a[i] });
            i++;
            j++;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            raw.push({ type: "del", text: a[i] });
            i++;
        } else {
            raw.push({ type: "add", text: b[j] });
            j++;
        }
    }
    while (i < n) raw.push({ type: "del", text: a[i++] });
    while (j < m) raw.push({ type: "add", text: b[j++] });
}
