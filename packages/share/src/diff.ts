/**
 * diff.ts — Pure word-level text diff shared by desktop and read-only surfaces.
 *
 * Word granularity keeps prose changes readable. Common prefix/suffix trimming
 * bounds the LCS work to the changed middle; wholesale rewrites fall back to a
 * coarse delete/insert pair instead of allocating an unbounded table.
 */

export type DiffOp = { type: "equal" | "delete" | "insert"; text: string };

/** Split text into non-whitespace and whitespace runs, preserving reconstruction. */
export function tokenize(text: string): string[] {
    return text.match(/\S+|\s+/g) ?? [];
}

/** Produce coalesced word-level operations describing `before` → `after`. */
export function wordDiff(before: string, after: string): DiffOp[] {
    const a = tokenize(before);
    const b = tokenize(after);

    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let end = 0;
    while (
        end < a.length - start &&
        end < b.length - start &&
        a[a.length - 1 - end] === b[b.length - 1 - end]
    ) {
        end++;
    }

    const raw: DiffOp[] = [];
    if (start > 0) raw.push({ type: "equal", text: a.slice(0, start).join("") });
    diffTokens(a.slice(start, a.length - end), b.slice(start, b.length - end), raw);
    if (end > 0) raw.push({ type: "equal", text: a.slice(a.length - end).join("") });

    const operations: DiffOp[] = [];
    for (const operation of raw) {
        const previous = operations.at(-1);
        if (previous?.type === operation.type) previous.text += operation.text;
        else operations.push({ ...operation });
    }
    return operations;
}

function diffTokens(a: string[], b: string[], operations: DiffOp[]): void {
    const n = a.length;
    const m = b.length;
    const maxCells = 1_000_000;

    if (n === 0 && m === 0) return;
    if (n * m > maxCells) {
        if (n > 0) operations.push({ type: "delete", text: a.join("") });
        if (m > 0) operations.push({ type: "insert", text: b.join("") });
        return;
    }

    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] =
                a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            operations.push({ type: "equal", text: a[i] });
            i++;
            j++;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            operations.push({ type: "delete", text: a[i++] });
        } else {
            operations.push({ type: "insert", text: b[j++] });
        }
    }
    while (i < n) operations.push({ type: "delete", text: a[i++] });
    while (j < m) operations.push({ type: "insert", text: b[j++] });
}
