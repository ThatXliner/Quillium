import { streamChat, streamFeedback, streamRevise } from "$lib/ai/clientStreams";
import { AutoAIReviewSchema, normalizeAutoAIReview } from "$lib/autoai/reviewSchema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_CONFORMANCE_FIXTURES } from "./fixtures/editorialConformance";

const mocks = vi.hoisted(() => ({
    createModel: vi.fn(() => ({ specificationVersion: "v2" })),
    streamText: vi.fn(),
}));

vi.mock("$lib/ai/provider", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/ai/provider")>();
    return { ...actual, createModel: mocks.createModel };
});

vi.mock("ai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ai")>();
    return {
        ...actual,
        convertToModelMessages: vi.fn(async () => []),
        streamText: mocks.streamText,
    };
});

const draft = "The draft contains a deliberate fragment.";

describe("provider editorial conformance", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.streamText.mockReturnValue({
            toUIMessageStream: () => new ReadableStream(),
        });
    });

    for (const fixture of PROVIDER_CONFORMANCE_FIXTURES) {
        it(`${fixture.name} receives the same narrow task contracts`, async () => {
            const options = {
                messages: [],
                documentContent: draft,
                selectedText: draft,
                selectedTextRange: { from: 0, to: draft.length },
                documentContext: {
                    freeform: "Preserve the fragment.",
                    decisions: ["Keep the final sentence unresolved."],
                },
                provider: fixture.provider,
                model: fixture.model,
                apiKey: fixture.apiKey,
                baseURL: fixture.baseURL,
            };

            await streamChat({ ...options, editorialTask: "reverse-outline" });
            expect(mocks.streamText.mock.lastCall?.[0].tools).toBeUndefined();

            await streamFeedback(options);
            expect(Object.keys(mocks.streamText.mock.lastCall?.[0].tools)).toEqual([
                "createComment",
            ]);

            await streamRevise({
                ...options,
                editorialTask: "exact-compression",
                exactWordCount: 5,
            });
            const exactRequest = mocks.streamText.mock.lastCall?.[0];
            expect(Object.keys(exactRequest.tools)).toEqual(["createRevision"]);
            expect(exactRequest.system).toContain("exactly 5 words");
            expect(exactRequest.system).not.toContain("final sentence unresolved");
            expect(exactRequest.messages[0].content).toContain("final sentence unresolved");

            expect(mocks.createModel).toHaveBeenLastCalledWith(
                fixture.provider,
                fixture.apiKey,
                fixture.model,
                fixture.baseURL,
            );
        });

        it(`${fixture.name} fixture normalizes into the shared AutoAI contract`, () => {
            const parsed = AutoAIReviewSchema.parse(fixture.autoAIResponse);
            expect(normalizeAutoAIReview(parsed)).toEqual(fixture.normalized);
        });
    }
});
