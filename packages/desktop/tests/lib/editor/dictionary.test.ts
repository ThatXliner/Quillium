import {
    type DictEntry,
    type Meaning,
    collectAntonyms,
    collectSynonyms,
    extractDictionaryWord,
    getPhonetic,
} from "$lib/editor/dictionaryUtils";
/**
 * Unit tests for dictionary/thesaurus helpers.
 *
 * Covers:
 *   - extractDictionaryWord: selection validation & whitespace trimming
 *   - getPhonetic: phonetic extraction from DictEntry
 *   - collectSynonyms / collectAntonyms: deduplication, limits, nested collection
 */
import { describe, expect, it } from "vitest";

// ── Helpers ─────────────────────────────────────────────────────

function makeMeaning(
    partOfSpeech: string,
    opts: {
        synonyms?: string[];
        antonyms?: string[];
        defSynonyms?: string[];
        defAntonyms?: string[];
    } = {},
): Meaning {
    return {
        partOfSpeech,
        synonyms: opts.synonyms ?? [],
        antonyms: opts.antonyms ?? [],
        definitions: [
            {
                definition: "test",
                synonyms: opts.defSynonyms ?? [],
                antonyms: opts.defAntonyms ?? [],
            },
        ],
    };
}

function makeEntry(word: string, meanings: Meaning[], phonetic?: string): DictEntry {
    return {
        word,
        phonetic,
        phonetics: [],
        meanings,
    };
}

// ── extractDictionaryWord ───────────────────────────────────────

describe("extractDictionaryWord", () => {
    it("extracts a simple word", () => {
        const result = extractDictionaryWord("hello", 10);
        expect(result).toEqual({ word: "hello", selectionFrom: 10, selectionTo: 15 });
    });

    it("trims leading whitespace and adjusts selectionFrom", () => {
        const result = extractDictionaryWord("  hello", 10);
        expect(result).toEqual({ word: "hello", selectionFrom: 12, selectionTo: 17 });
    });

    it("trims trailing whitespace and adjusts selectionTo", () => {
        const result = extractDictionaryWord("hello  ", 10);
        expect(result).toEqual({ word: "hello", selectionFrom: 10, selectionTo: 15 });
    });

    it("trims both leading and trailing whitespace", () => {
        const result = extractDictionaryWord("  hello  ", 5);
        expect(result).toEqual({ word: "hello", selectionFrom: 7, selectionTo: 12 });
    });

    it("rejects empty string", () => {
        expect(extractDictionaryWord("", 0)).toBeNull();
    });

    it("rejects whitespace-only string", () => {
        expect(extractDictionaryWord("   ", 0)).toBeNull();
    });

    it("rejects multi-word selections", () => {
        expect(extractDictionaryWord("hello world", 0)).toBeNull();
    });

    it("rejects words with internal whitespace", () => {
        expect(extractDictionaryWord("hello\tworld", 0)).toBeNull();
    });

    it("rejects words longer than 60 characters", () => {
        const longWord = "a".repeat(61);
        expect(extractDictionaryWord(longWord, 0)).toBeNull();
    });

    it("accepts words exactly 60 characters", () => {
        const word = "a".repeat(60);
        const result = extractDictionaryWord(word, 0);
        expect(result).toEqual({ word, selectionFrom: 0, selectionTo: 60 });
    });

    it("handles selFrom offset correctly", () => {
        const result = extractDictionaryWord("test", 100);
        expect(result).toEqual({ word: "test", selectionFrom: 100, selectionTo: 104 });
    });
});

// ── getPhonetic ────────────────────────────────────────────────

describe("getPhonetic", () => {
    it("returns top-level phonetic when present", () => {
        const entry: DictEntry = {
            word: "test",
            phonetic: "/tɛst/",
            phonetics: [{ text: "/other/" }],
            meanings: [],
        };
        expect(getPhonetic(entry)).toBe("/tɛst/");
    });

    it("falls back to first phonetics entry with text", () => {
        const entry: DictEntry = {
            word: "test",
            phonetics: [{}, { text: "/tɛst/" }, { text: "/other/" }],
            meanings: [],
        };
        expect(getPhonetic(entry)).toBe("/tɛst/");
    });

    it("returns empty string when no phonetic data", () => {
        const entry: DictEntry = {
            word: "test",
            phonetics: [{}, {}],
            meanings: [],
        };
        expect(getPhonetic(entry)).toBe("");
    });

    it("returns empty string when phonetics array is empty", () => {
        const entry: DictEntry = {
            word: "test",
            phonetics: [],
            meanings: [],
        };
        expect(getPhonetic(entry)).toBe("");
    });
});

// ── collectSynonyms ────────────────────────────────────────────

describe("collectSynonyms", () => {
    it("collects meaning-level synonyms", () => {
        const entry = makeEntry("happy", [
            makeMeaning("adjective", { synonyms: ["glad", "joyful"] }),
        ]);
        expect(collectSynonyms([entry])).toEqual(["glad", "joyful"]);
    });

    it("collects definition-level synonyms", () => {
        const entry = makeEntry("happy", [
            makeMeaning("adjective", { defSynonyms: ["cheerful", "content"] }),
        ]);
        expect(collectSynonyms([entry])).toEqual(["cheerful", "content"]);
    });

    it("merges synonyms from both levels", () => {
        const entry = makeEntry("happy", [
            makeMeaning("adjective", { synonyms: ["glad"], defSynonyms: ["cheerful"] }),
        ]);
        const result = collectSynonyms([entry]);
        expect(result).toContain("glad");
        expect(result).toContain("cheerful");
    });

    it("deduplicates synonyms", () => {
        const entry = makeEntry("happy", [
            makeMeaning("adjective", { synonyms: ["glad"], defSynonyms: ["glad"] }),
        ]);
        expect(collectSynonyms([entry])).toEqual(["glad"]);
    });

    it("collects across multiple entries", () => {
        const entries = [
            makeEntry("happy", [makeMeaning("adjective", { synonyms: ["glad"] })]),
            makeEntry("happy", [makeMeaning("adjective", { synonyms: ["joyful"] })]),
        ];
        const result = collectSynonyms(entries);
        expect(result).toContain("glad");
        expect(result).toContain("joyful");
    });

    it("limits to 10 synonyms", () => {
        const syns = Array.from({ length: 15 }, (_, i) => `syn${i}`);
        const entry = makeEntry("test", [makeMeaning("noun", { synonyms: syns })]);
        expect(collectSynonyms([entry])).toHaveLength(10);
    });

    it("returns empty for entries with no synonyms", () => {
        const entry = makeEntry("test", [makeMeaning("noun")]);
        expect(collectSynonyms([entry])).toEqual([]);
    });
});

// ── collectAntonyms ────────────────────────────────────────────

describe("collectAntonyms", () => {
    it("collects meaning-level antonyms", () => {
        const entry = makeEntry("happy", [
            makeMeaning("adjective", { antonyms: ["sad", "unhappy"] }),
        ]);
        expect(collectAntonyms([entry])).toEqual(["sad", "unhappy"]);
    });

    it("collects definition-level antonyms", () => {
        const entry = makeEntry("happy", [
            makeMeaning("adjective", { defAntonyms: ["miserable", "gloomy"] }),
        ]);
        expect(collectAntonyms([entry])).toEqual(["miserable", "gloomy"]);
    });

    it("deduplicates antonyms", () => {
        const entry = makeEntry("happy", [
            makeMeaning("adjective", { antonyms: ["sad"], defAntonyms: ["sad"] }),
        ]);
        expect(collectAntonyms([entry])).toEqual(["sad"]);
    });

    it("limits to 6 antonyms", () => {
        const ants = Array.from({ length: 10 }, (_, i) => `ant${i}`);
        const entry = makeEntry("test", [makeMeaning("noun", { antonyms: ants })]);
        expect(collectAntonyms([entry])).toHaveLength(6);
    });

    it("returns empty for entries with no antonyms", () => {
        const entry = makeEntry("test", [makeMeaning("noun")]);
        expect(collectAntonyms([entry])).toEqual([]);
    });

    it("collects across multiple meanings", () => {
        const entry = makeEntry("test", [
            makeMeaning("noun", { antonyms: ["a"] }),
            makeMeaning("verb", { defAntonyms: ["b"] }),
        ]);
        const result = collectAntonyms([entry]);
        expect(result).toContain("a");
        expect(result).toContain("b");
    });
});
