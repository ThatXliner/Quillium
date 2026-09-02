import { streamChat, streamFeedback, streamRevise } from "$lib/ai/clientStreams";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    streamText: vi.fn(),
}));

vi.mock("$lib/ai/provider", () => ({
    createModel: vi.fn(() => ({ specificationVersion: "v2" })),
}));

vi.mock("ai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ai")>();
    return {
        ...actual,
        convertToModelMessages: vi.fn(async () => []),
        streamText: mocks.streamText,
    };
});

const baseOptions = {
    messages: [],
    documentContent: "The draft contains a deliberate fragment.",
    selectedText: "",
    documentContext: { freeform: "Keep the fragment if it supports the rhythm." },
    provider: "openai" as const,
    model: "test-model",
    apiKey: "test-key",
};

describe("editorial stream policy", () => {
    beforeEach(() => {
        mocks.streamText.mockReset();
        mocks.streamText.mockReturnValue({
            toUIMessageStream: () => new ReadableStream(),
        });
    });

    it("keeps Chat text-only and keeps the writer brief out of the system prompt", async () => {
        await streamChat(baseOptions);

        const request = mocks.streamText.mock.calls[0][0];
        expect(request.tools).toBeUndefined();
        expect(request.system).toContain("The writer owns the intent, voice, and final wording");
        expect(request.system).not.toContain("Keep the fragment");
        expect(request.messages[0].content).toContain("Keep the fragment");
    });

    it("allows only comments during broad feedback", async () => {
        await streamFeedback(baseOptions);

        const request = mocks.streamText.mock.calls[0][0];
        expect(Object.keys(request.tools)).toEqual(["createComment"]);
        expect(request.system).toContain("Do not create rewrites during a broad review");
    });

    it("allows comments, suggestions, and revisions during local rewrite", async () => {
        await streamRevise({
            ...baseOptions,
            selectedText: "a deliberate fragment",
            selectedTextRange: { from: 19, to: 40 },
        });

        const request = mocks.streamText.mock.calls[0][0];
        expect(Object.keys(request.tools)).toEqual([
            "createComment",
            "createSuggestion",
            "createRevision",
        ]);
        expect(request.system).toContain("Work only inside the selected passage");
    });

    it("uses a text-only reverse-outline recipe for a Chat turn", async () => {
        await streamChat({ ...baseOptions, editorialTask: "reverse-outline" });

        const request = mocks.streamText.mock.calls[0][0];
        expect(request.tools).toBeUndefined();
        expect(request.system).toContain("produce a reverse outline");
    });

    it("exposes only revision for exact compression", async () => {
        await streamRevise({
            ...baseOptions,
            selectedText: "The draft contains a deliberate fragment.",
            selectedTextRange: { from: 0, to: 41 },
            editorialTask: "exact-compression",
            exactWordCount: 5,
        });

        const request = mocks.streamText.mock.calls[0][0];
        expect(Object.keys(request.tools)).toEqual(["createRevision"]);
        expect(request.system).toContain("exactly 5 words");
    });

    it("falls back to text-only when a task belongs to another panel", async () => {
        await streamChat({ ...baseOptions, editorialTask: "local-rewrite" });

        const request = mocks.streamText.mock.calls[0][0];
        expect(request.tools).toBeUndefined();
        expect(request.system).toContain("discuss the writer's question");
    });
});
