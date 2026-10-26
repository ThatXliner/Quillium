/**
 * dictionaryUtils.ts — Pure helper functions for the dictionary/thesaurus feature.
 *
 * Extracted from DictionaryPopover.svelte so they can be unit-tested independently.
 */
import type { StructuredDictionaryData } from "$lib/ai/clientStreams";
import { aiErrorMessage } from "$lib/ai/errorMessage";
import type { Provider } from "$lib/ai/provider";
import { LoadAPIKeyError, NoObjectGeneratedError } from "ai";

// ── Types ──────────────────────────────────────────────────────

export interface DictionaryDefinition {
    definition: string;
    example?: string;
}

export interface DictionaryMeaning {
    partOfSpeech: string;
    definitions: DictionaryDefinition[];
}

export interface DictionaryEntry {
    word: string;
    phonetic: string;
    meanings: DictionaryMeaning[];
    synonyms: string[];
    antonyms: string[];
}

const MAX_MEANINGS = 2;
const MAX_DEFINITIONS = 2;
const MAX_SYNONYMS = 10;
const MAX_ANTONYMS = 6;

export const DICTIONARY_MALFORMED_MESSAGE =
    "The AI model returned an incomplete dictionary entry. Try again.";
export const DICTIONARY_MISSING_KEY_MESSAGE =
    "Quillium could not load your API key. Open AI Settings and check your key.";

// ── Helpers ────────────────────────────────────────────────────

function uniqueTerms(terms: string[], word: string, limit: number): string[] {
    const seen = new Set([word.toLocaleLowerCase()]);
    const result: string[] = [];
    for (const raw of terms) {
        const term = raw.trim();
        const key = term.toLocaleLowerCase();
        if (!term || seen.has(key)) continue;
        seen.add(key);
        result.push(term);
        if (result.length === limit) break;
    }
    return result;
}

export function normalizeDictionaryData(
    word: string,
    data: StructuredDictionaryData,
): DictionaryEntry | null {
    const meanings: DictionaryMeaning[] = [];
    for (const meaning of data.meanings) {
        const definitions = meaning.definitions
            .map(({ definition, example }) => ({
                definition: definition.trim(),
                example: example.trim() || undefined,
            }))
            .filter(({ definition }) => definition.length > 0)
            .slice(0, MAX_DEFINITIONS);
        if (definitions.length === 0) continue;
        meanings.push({ partOfSpeech: meaning.partOfSpeech.trim(), definitions });
        if (meanings.length === MAX_MEANINGS) break;
    }
    const synonyms = uniqueTerms(data.synonyms, word, MAX_SYNONYMS);
    const antonyms = uniqueTerms(data.antonyms, word, MAX_ANTONYMS);
    if (meanings.length === 0 && synonyms.length === 0 && antonyms.length === 0) return null;
    return { word, phonetic: data.phonetic.trim(), meanings, synonyms, antonyms };
}

export function dictionaryUnavailableMessage(
    aiEnabled: boolean,
    connected: boolean,
): string | null {
    if (!aiEnabled) return "Enable AI in Settings to look up words.";
    if (!connected) return "Connect an AI provider in AI Settings to look up words.";
    return null;
}

export function dictionaryErrorMessage(error: unknown, provider: Provider): string {
    if (NoObjectGeneratedError.isInstance(error)) return DICTIONARY_MALFORMED_MESSAGE;
    if (LoadAPIKeyError.isInstance(error)) return DICTIONARY_MISSING_KEY_MESSAGE;
    return aiErrorMessage(error, provider);
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
