/**
 * dictionaryUtils.ts — Pure helper functions for the dictionary/thesaurus feature.
 *
 * Extracted from DictionaryPopover.svelte so they can be unit-tested independently.
 */

// ── Types ──────────────────────────────────────────────────────

export interface Definition {
    definition: string;
    example?: string;
    synonyms: string[];
    antonyms: string[];
}

export interface Meaning {
    partOfSpeech: string;
    definitions: Definition[];
    synonyms: string[];
    antonyms: string[];
}

export interface DictEntry {
    word: string;
    phonetic?: string;
    phonetics: { text?: string }[];
    meanings: Meaning[];
}

// ── Helpers ────────────────────────────────────────────────────

export function getPhonetic(entry: DictEntry): string {
    if (entry.phonetic) return entry.phonetic;
    return entry.phonetics.find((p) => p.text)?.text ?? "";
}

export function collectSynonyms(entries: DictEntry[]): string[] {
    const all = new Set<string>();
    for (const entry of entries) {
        for (const meaning of entry.meanings) {
            for (const s of meaning.synonyms) all.add(s);
            for (const def of meaning.definitions) {
                for (const s of def.synonyms) all.add(s);
            }
        }
    }
    return [...all].slice(0, 10);
}

export function collectAntonyms(entries: DictEntry[]): string[] {
    const all = new Set<string>();
    for (const entry of entries) {
        for (const meaning of entry.meanings) {
            for (const a of meaning.antonyms) all.add(a);
            for (const def of meaning.definitions) {
                for (const a of def.antonyms) all.add(a);
            }
        }
    }
    return [...all].slice(0, 6);
}

/**
 * Validates a selection and extracts dictionary trigger data.
 * Returns null if the selection is not suitable (empty, multi-word, too long).
 */
export function extractDictionaryWord(
    raw: string,
    selFrom: number,
): { word: string; selectionFrom: number; selectionTo: number } | null {
    const word = raw.trim();
    if (!word || /\s/.test(word) || word.length > 60) return null;

    const leadingWs = raw.length - raw.trimStart().length;
    const trailingWs = raw.length - raw.trimEnd().length;
    const selectionFrom = selFrom + leadingWs;
    const selectionTo = selFrom + raw.length - trailingWs;

    return { word, selectionFrom, selectionTo };
}
