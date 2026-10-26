import {
    type StructuredDictionaryData,
    structuredDictionaryDataSchema,
} from "$lib/ai/clientStreams";
import {
    DICTIONARY_MALFORMED_MESSAGE,
    DICTIONARY_MISSING_KEY_MESSAGE,
    dictionaryErrorMessage,
    dictionaryUnavailableMessage,
    extractDictionaryWord,
    normalizeDictionaryData,
} from "$lib/editor/dictionaryUtils";
import { APICallError, LoadAPIKeyError, NoObjectGeneratedError } from "ai";
import { describe, expect, it } from "vitest";

function makeData(overrides: Partial<StructuredDictionaryData> = {}): StructuredDictionaryData {
    return {
        phonetic: "/ˈhɛlp.fəl/",
        meanings: [
            {
                partOfSpeech: "adjective",
                definitions: [{ definition: "Giving aid; useful.", example: "a helpful note" }],
            },
        ],
        synonyms: ["useful"],
        antonyms: ["unhelpful"],
        ...overrides,
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

describe("structuredDictionaryDataSchema", () => {
    it("accepts a complete entry", () => {
        expect(structuredDictionaryDataSchema.safeParse(makeData()).success).toBe(true);
    });

    it("rejects output missing a required field", () => {
        const { antonyms: _antonyms, ...partial } = makeData();
        expect(structuredDictionaryDataSchema.safeParse(partial).success).toBe(false);
    });

    it("rejects a null example instead of an empty string", () => {
        const data = {
            ...makeData(),
            meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "x", example: null }] }],
        };
        expect(structuredDictionaryDataSchema.safeParse(data).success).toBe(false);
    });
});

describe("normalizeDictionaryData", () => {
    it("maps model output into a display entry", () => {
        expect(normalizeDictionaryData("helpful", makeData())).toEqual({
            word: "helpful",
            phonetic: "/ˈhɛlp.fəl/",
            meanings: [
                {
                    partOfSpeech: "adjective",
                    definitions: [{ definition: "Giving aid; useful.", example: "a helpful note" }],
                },
            ],
            synonyms: ["useful"],
            antonyms: ["unhelpful"],
        });
    });

    it("drops empty examples, definitions, and meanings", () => {
        const entry = normalizeDictionaryData(
            "bright",
            makeData({
                meanings: [
                    { partOfSpeech: "verb", definitions: [{ definition: "  ", example: "" }] },
                    {
                        partOfSpeech: " adjective ",
                        definitions: [{ definition: " Giving light. ", example: "  " }],
                    },
                ],
            }),
        );
        expect(entry?.meanings).toEqual([
            { partOfSpeech: "adjective", definitions: [{ definition: "Giving light." }] },
        ]);
    });

    it("caps meanings and definitions at two each", () => {
        const definitions = ["a", "b", "c"].map((definition) => ({ definition, example: "" }));
        const entry = normalizeDictionaryData(
            "set",
            makeData({
                meanings: ["noun", "verb", "adjective"].map((partOfSpeech) => ({
                    partOfSpeech,
                    definitions,
                })),
            }),
        );
        expect(entry?.meanings.map((meaning) => meaning.partOfSpeech)).toEqual(["noun", "verb"]);
        expect(entry?.meanings[0].definitions).toHaveLength(2);
    });

    it("deduplicates terms case-insensitively and omits the looked-up word", () => {
        const entry = normalizeDictionaryData(
            "happy",
            makeData({
                synonyms: ["Glad", "glad", " joyful ", "", "Happy"],
                antonyms: ["sad", "SAD"],
            }),
        );
        expect(entry?.synonyms).toEqual(["Glad", "joyful"]);
        expect(entry?.antonyms).toEqual(["sad"]);
    });

    it("limits synonyms to 10 and antonyms to 6", () => {
        const entry = normalizeDictionaryData(
            "test",
            makeData({
                synonyms: Array.from({ length: 15 }, (_, i) => `syn${i}`),
                antonyms: Array.from({ length: 10 }, (_, i) => `ant${i}`),
            }),
        );
        expect(entry?.synonyms).toHaveLength(10);
        expect(entry?.antonyms).toHaveLength(6);
    });

    it("keeps a thesaurus-only entry", () => {
        const entry = normalizeDictionaryData("okay", makeData({ meanings: [], antonyms: [] }));
        expect(entry?.synonyms).toEqual(["useful"]);
        expect(entry?.meanings).toEqual([]);
    });

    it("returns null when the model found nothing", () => {
        expect(
            normalizeDictionaryData(
                "xyzzy",
                makeData({ phonetic: "", meanings: [], synonyms: [], antonyms: [] }),
            ),
        ).toBeNull();
    });
});

// ── Error messages ──────────────────────────────────────────────

describe("dictionaryUnavailableMessage", () => {
    it("asks the writer to enable AI first", () => {
        expect(dictionaryUnavailableMessage(false, true)).toBe(
            "Enable AI in Settings to look up words.",
        );
    });

    it("asks the writer to connect a provider", () => {
        expect(dictionaryUnavailableMessage(true, false)).toBe(
            "Connect an AI provider in AI Settings to look up words.",
        );
    });

    it("returns null when AI is ready", () => {
        expect(dictionaryUnavailableMessage(true, true)).toBeNull();
    });
});

describe("dictionaryErrorMessage", () => {
    it("reports malformed structured output", () => {
        const error = new NoObjectGeneratedError({
            message: "No object generated: response did not match schema.",
            text: '{"phonetic":1}',
            response: { id: "r", timestamp: new Date(0), modelId: "m" },
            usage: {
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                inputTokenDetails: {
                    noCacheTokens: 1,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                },
                outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
            },
            finishReason: "stop",
        });
        expect(dictionaryErrorMessage(error, "openai")).toBe(DICTIONARY_MALFORMED_MESSAGE);
    });

    it("reports a credential that failed to load", () => {
        const error = new LoadAPIKeyError({ message: "OpenAI API key is missing." });
        expect(dictionaryErrorMessage(error, "openai")).toBe(DICTIONARY_MISSING_KEY_MESSAGE);
    });

    it("uses the shared provider messages for API failures", () => {
        const error = new APICallError({
            message: "Too Many Requests",
            url: "https://api.openai.com/v1/responses",
            requestBodyValues: {},
            statusCode: 429,
        });
        expect(dictionaryErrorMessage(error, "openai")).toBe(
            "The AI provider is rate limiting requests. Wait a moment and try again.",
        );
    });
});
