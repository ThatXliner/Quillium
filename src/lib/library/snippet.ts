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

/** Splits a snippet into plain/highlighted segments for safe rendering. */
export function snippetSegments(snippet: string): SnippetSegment[] {
    const segments: SnippetSegment[] = [];
    const parts = snippet.split(HL_START);
    for (const [i, part] of parts.entries()) {
        if (i === 0) {
            if (part) segments.push({ text: part, highlighted: false });
            continue;
        }
        const end = part.indexOf(HL_END);
        if (end === -1) {
            if (part) segments.push({ text: part, highlighted: false });
            continue;
        }
        const highlighted = part.slice(0, end);
        const rest = part.slice(end + 1);
        if (highlighted) segments.push({ text: highlighted, highlighted: true });
        if (rest) segments.push({ text: rest, highlighted: false });
    }
    return segments;
}
