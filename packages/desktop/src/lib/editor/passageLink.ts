// passageLink.ts — Bounded, local links from AI comments to captured prose.
//
// These links are intentionally fragments, not navigable URLs. The editor can
// parse the exact suffix and decide whether the referenced draft is still
// available before offering a local jump.

const PASSAGE_LABEL = "[Supporting passage](#quillium-passage=";
const MAX_ID_LENGTH = 200;
const MAX_QUOTE_LENGTH = 12_000;
const MAX_RANGE = 1_000_000;
const FINGERPRINT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{8}$/i;

export type PassageLink = {
    documentId: string;
    tabId: string;
    draftId: string;
    from: number;
    to: number;
    quote: string;
    fingerprint: string;
};

function validId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= MAX_ID_LENGTH &&
        value.trim() === value &&
        !/\s/u.test(value) &&
        [...value].every((character) => {
            const code = character.charCodeAt(0);
            return code >= 32 && code !== 127;
        })
    );
}

function validRange(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_RANGE;
}

function validPassageLink(value: unknown): value is PassageLink {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate).sort();
    if (
        keys.join("\u0000") !==
        ["documentId", "draftId", "fingerprint", "from", "quote", "tabId", "to"].join("\u0000")
    ) {
        return false;
    }
    if (
        !validId(candidate.documentId) ||
        !validId(candidate.tabId) ||
        !validId(candidate.draftId)
    ) {
        return false;
    }
    if (
        !validRange(candidate.from) ||
        !validRange(candidate.to) ||
        candidate.from >= candidate.to
    ) {
        return false;
    }
    if (
        typeof candidate.quote !== "string" ||
        candidate.quote.length === 0 ||
        candidate.quote.length > MAX_QUOTE_LENGTH ||
        candidate.quote.length !== candidate.to - candidate.from
    ) {
        return false;
    }
    return (
        typeof candidate.fingerprint === "string" && FINGERPRINT_PATTERN.test(candidate.fingerprint)
    );
}

function clonePassageLink(link: PassageLink): PassageLink {
    return {
        documentId: link.documentId,
        tabId: link.tabId,
        draftId: link.draftId,
        from: link.from,
        to: link.to,
        quote: link.quote,
        fingerprint: link.fingerprint,
    };
}

/** Serialize one validated passage reference as a local Markdown fragment. */
export function serializePassageLink(link: PassageLink): string {
    if (!validPassageLink(link)) throw new Error("Invalid supporting passage link.");
    const encoded = encodeURIComponent(JSON.stringify(clonePassageLink(link)))
        .replaceAll("(", "%28")
        .replaceAll(")", "%29");
    return `${PASSAGE_LABEL}${encoded})`;
}

/**
 * Remove and parse only a valid supporting-passage suffix. Malformed or
 * embedded fragments remain ordinary comment text so editing cannot discard it.
 */
export function parsePassageLink(message: string): { text: string; link: PassageLink | null } {
    const match = message.match(/\n\[Supporting passage\]\(#quillium-passage=([^\s)]*)\)$/u);
    if (!match || match.index === undefined) return { text: message, link: null };

    try {
        const parsed: unknown = JSON.parse(decodeURIComponent(match[1] ?? ""));
        if (!validPassageLink(parsed)) return { text: message, link: null };
        return {
            text: message.slice(0, match.index),
            link: clonePassageLink(parsed),
        };
    } catch {
        return { text: message, link: null };
    }
}
