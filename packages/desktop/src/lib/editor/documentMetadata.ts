// documentMetadata.ts — Library metadata shared by live edits and DEV scenarios.
export function documentMetadata(docText: string): { wordCount: number; previewText: string } {
    return {
        wordCount: docText.trim().split(/\s+/).filter(Boolean).length,
        previewText: docText.slice(0, 200),
    };
}

export function titleForDocument(title: string, docText: string): string {
    // Derive the title once, after Enter or four words. A chosen title stays user-owned.
    if (title !== "Untitled") return title;
    const firstLine = docText.split("\n")[0].trim();
    const firstLineWords = firstLine ? firstLine.split(/\s+/).length : 0;
    return firstLine && (docText.includes("\n") || firstLineWords >= 4)
        ? firstLine.slice(0, 40)
        : title;
}
