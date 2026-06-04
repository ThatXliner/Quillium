export function parseTags(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((tag): tag is string => typeof tag === "string")
            .map(normalizeTag)
            .filter(Boolean);
    } catch {
        return [];
    }
}

export function normalizeTag(tag: string): string {
    return tag.trim().replace(/\s+/g, " ").slice(0, 32);
}

export function serializeTags(tags: string[]): string {
    const seen = new Set<string>();
    const normalized = tags
        .map(normalizeTag)
        .filter(Boolean)
        .filter((tag) => {
            const key = tag.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    return JSON.stringify(normalized);
}
