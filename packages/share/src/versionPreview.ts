/**
 * versionPreview.ts — Canonical formatting for revision-version preview labels.
 *
 * Both writable desktop editors and read-only share surfaces use this helper so
 * whitespace, truncation, and empty-version labels cannot drift.
 */

export const VERSION_PREVIEW_MAX_LENGTH = 34;

export function formatVersionPreviewText(
    text: string | undefined,
    maxLength = VERSION_PREVIEW_MAX_LENGTH,
): string {
    const flattened = (text ?? "").replace(/\s+/g, " ").trim();
    if (!flattened) return "(empty)";
    return flattened.length > maxLength ? `${flattened.slice(0, maxLength)}…` : flattened;
}
