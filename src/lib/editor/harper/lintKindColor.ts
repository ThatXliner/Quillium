/**
 * Maps Harper lint kind strings to CSS class names.
 * Two categories: spelling (red squiggle) and grammar (blue squiggle).
 */
export function lintKindClass(kind: string): string {
    if (kind === "Spelling") return "harper-spelling";
    return "harper-grammar";
}
