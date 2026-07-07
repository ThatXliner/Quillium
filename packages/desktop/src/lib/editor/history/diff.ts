/**
 * diff.ts — Snapshot-JSON helper for the version-history preview.
 *
 * The word-level diff itself lives in $lib/editor/diff (shared with the
 * suggestion previews); this module keeps only the history-specific helper
 * for extracting document text from a serialized EditorState.
 */

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
