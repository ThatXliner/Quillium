/**
 * snippet.ts — Parsing for search-result snippets.
 *
 * The Rust search command (src-tauri/src/db/search.rs) wraps keyword matches
 * in U+E000/U+E001 private-use sentinels — characters that can't appear in
 * real document text — so highlighting never requires HTML in the payload.
 */

export const HL_START = "\uE000";
export const HL_END = "\uE001";

export type SnippetSegment = { text: string; highlighted: boolean };

// FTS5's '…' truncation can slice a snippet mid-highlight, leaving an
// unbalanced sentinel (e.g. a closing U+E001 with no opener). Strip any
// stray sentinels from plain text so they never render as invisible PUA
// gremlins.
function pushPlain(segments: SnippetSegment[], text: string): void {
    const clean = text.replaceAll(HL_START, "").replaceAll(HL_END, "");
    if (clean) segments.push({ text: clean, highlighted: false });
}

/** Splits a snippet into plain/highlighted segments for safe rendering. */
export function snippetSegments(snippet: string): SnippetSegment[] {
    const segments: SnippetSegment[] = [];
    const parts = snippet.split(HL_START);
    for (const [i, part] of parts.entries()) {
        if (i === 0) {
            pushPlain(segments, part);
            continue;
        }
        const end = part.indexOf(HL_END);
        if (end === -1) {
            pushPlain(segments, part);
            continue;
        }
        const highlighted = part.slice(0, end);
        const rest = part.slice(end + 1);
        if (highlighted) segments.push({ text: highlighted, highlighted: true });
        pushPlain(segments, rest);
    }
    return segments;
}
