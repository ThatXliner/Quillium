import { generateDictionaryEntry, structuredDictionaryDataSchema } from "$lib/ai/clientStreams";
import { createModel } from "$lib/ai/provider";
import { logAppEvent } from "$lib/appLog";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    generateObject: vi.fn(),
}));

vi.mock("$lib/ai/provider", () => ({
    createModel: vi.fn(() => ({ specificationVersion: "v2" })),
}));

vi.mock("$lib/appLog", () => ({
    logAppEvent: vi.fn(async () => {}),
}));

vi.mock("ai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ai")>();
    return { ...actual, generateObject: mocks.generateObject };
});

const baseOptions = {
    word: "helpful",
    provider: "openai-compatible" as const,
    model: "local-model",
    apiKey: "",
    baseURL: "http://localhost:1234/v1",
};

const entry = {
    phonetic: "/ˈhɛlp.fəl/",
    meanings: [
        {
            partOfSpeech: "adjective",
            definitions: [{ definition: "Giving aid; useful.", example: "" }],
        },
    ],
    synonyms: ["useful"],
    antonyms: ["unhelpful"],
};

describe("generateDictionaryEntry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.generateObject.mockResolvedValue({ object: entry });
    });

    it("requests the structured dictionary schema from the configured model", async () => {
        const controller = new AbortController();

        await expect(
            generateDictionaryEntry({ ...baseOptions, abortSignal: controller.signal }),
        ).resolves.toEqual(entry);

        expect(createModel).toHaveBeenCalledWith(
            "openai-compatible",
            "",
            "local-model",
            "http://localhost:1234/v1",
        );
        const request = mocks.generateObject.mock.calls[0][0];
        expect(request.schema).toBe(structuredDictionaryDataSchema);
        expect(request.abortSignal).toBe(controller.signal);
        expect(request.prompt).toContain('{"term":"helpful"}');
    });

    it("logs and rethrows provider failures", async () => {
        const failure = new Error("provider down");
        mocks.generateObject.mockRejectedValue(failure);

        await expect(generateDictionaryEntry(baseOptions)).rejects.toBe(failure);

        expect(logAppEvent).toHaveBeenCalledWith(
            "error",
            "ai",
            "Dictionary lookup failed",
            expect.objectContaining({ provider: "openai-compatible", error: failure }),
        );
    });

    it("does not log a cancelled lookup", async () => {
        const controller = new AbortController();
        controller.abort();
        mocks.generateObject.mockRejectedValue(new DOMException("Aborted", "AbortError"));

        await expect(
            generateDictionaryEntry({ ...baseOptions, abortSignal: controller.signal }),
        ).rejects.toThrow();

        expect(logAppEvent).not.toHaveBeenCalled();
    });
});
