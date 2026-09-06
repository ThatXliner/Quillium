import { streamFeedback, streamRevise } from "$lib/ai/clientStreams";
import type { ReaderPersona } from "$lib/readers/presets";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createModel: vi.fn(),
}));

vi.mock("$lib/ai/provider", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/ai/provider")>();
    return { ...actual, createModel: mocks.createModel };
});

const persona: ReaderPersona = {
    id: "line-editor",
    name: "Line Editor",
    emoji: "",
    color: "#336699",
    description: "Checks sentences.",
    instruction: "checks sentence rhythm",
    builtin: true,
    enabled: true,
    chattiness: "normal",
};

const baseOptions = {
    messages: [],
    documentContent: "The draft contains a deliberate fragment.",
    selectedText: "",
    provider: "openai" as const,
    model: "test-model",
    apiKey: "test-key",
};

const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
};

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
    const reader = stream.getReader();
    const chunks: UIMessageChunk[] = [];
    while (true) {
        const { value, done } = await reader.read();
        if (done) return chunks;
        chunks.push(value);
    }
}

describe("persona stream output contract", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("requires an annotation tool and completes a comment without a follow-up call", async () => {
        const model = new MockLanguageModelV3({
            doStream: async () => ({
                stream: simulateReadableStream({
                    chunks: [
                        {
                            type: "tool-call",
                            toolCallId: "call-1",
                            toolName: "createComment",
                            input: JSON.stringify({
                                targetText: "deliberate fragment",
                                comment: "This phrase needs attention.",
                            }),
                        },
                        {
                            type: "finish",
                            finishReason: { unified: "tool-calls", raw: undefined },
                            usage,
                        },
                    ],
                }),
                warnings: [],
            }),
        });
        mocks.createModel.mockReturnValue(model);

        const chunks = await readAll(
            await streamFeedback({ ...baseOptions, persona, annotationOnly: true }),
        );

        expect(model.doStreamCalls).toHaveLength(1);
        expect(model.doStreamCalls[0].toolChoice).toEqual({ type: "required" });
        expect(model.doStreamCalls[0].tools?.map((tool) => tool.name)).toEqual([
            "createComment",
            "noAction",
        ]);
        expect(
            chunks.some(
                (chunk) =>
                    chunk.type === "tool-input-available" && chunk.toolName === "createComment",
            ),
        ).toBe(true);
        expect(chunks.some((chunk) => chunk.type === "tool-output-available")).toBe(true);
        expect(chunks.some((chunk) => chunk.type === "text-delta")).toBe(false);
        expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    });

    it("accepts noAction as the valid no-annotation result", async () => {
        const model = new MockLanguageModelV3({
            doStream: async () => ({
                stream: simulateReadableStream({
                    chunks: [
                        {
                            type: "tool-call",
                            toolCallId: "call-1",
                            toolName: "noAction",
                            input: "{}",
                        },
                        {
                            type: "finish",
                            finishReason: { unified: "tool-calls", raw: undefined },
                            usage,
                        },
                    ],
                }),
                warnings: [],
            }),
        });
        mocks.createModel.mockReturnValue(model);

        const chunks = await readAll(
            await streamFeedback({ ...baseOptions, persona, annotationOnly: true }),
        );

        expect(model.doStreamCalls).toHaveLength(1);
        expect(model.doStreamCalls[0].toolChoice).toEqual({ type: "required" });
        expect(model.doStreamCalls[0].tools?.map((tool) => tool.name)).toEqual([
            "createComment",
            "noAction",
        ]);
        expect(
            chunks.some(
                (chunk) => chunk.type === "tool-input-available" && chunk.toolName === "noAction",
            ),
        ).toBe(true);
        expect(chunks.some((chunk) => chunk.type === "tool-output-available")).toBe(true);
        expect(chunks.some((chunk) => chunk.type === "text-delta")).toBe(false);
        expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    });

    it.each([
        ["feedback", () => streamFeedback(baseOptions)],
        [
            "revise",
            () =>
                streamRevise({
                    ...baseOptions,
                    selectedText: "a deliberate fragment",
                    selectedTextRange: { from: 19, to: 40 },
                }),
        ],
    ])("keeps text output for normal %s streams", async (_name, run) => {
        const model = new MockLanguageModelV3({
            doStream: async () => ({
                stream: simulateReadableStream({
                    chunks: [
                        { type: "text-start", id: "text-1" },
                        { type: "text-delta", id: "text-1", delta: "A useful summary." },
                        { type: "text-end", id: "text-1" },
                        {
                            type: "finish",
                            finishReason: { unified: "stop", raw: undefined },
                            usage,
                        },
                    ],
                }),
                warnings: [],
            }),
        });
        mocks.createModel.mockReturnValue(model);

        const chunks = await readAll(await run());

        expect(model.doStreamCalls).toHaveLength(1);
        expect(model.doStreamCalls[0].toolChoice).toEqual({ type: "auto" });
        expect(
            chunks.some(
                (chunk) => chunk.type === "text-delta" && chunk.delta === "A useful summary.",
            ),
        ).toBe(true);
    });

    it("does not filter text if a provider ignores required tool choice", async () => {
        const model = new MockLanguageModelV3({
            doStream: async () => ({
                stream: simulateReadableStream({
                    chunks: [
                        { type: "text-start", id: "text-1" },
                        {
                            type: "text-delta",
                            id: "text-1",
                            delta: "Provider prose despite required tools.",
                        },
                        { type: "text-end", id: "text-1" },
                        {
                            type: "finish",
                            finishReason: { unified: "stop", raw: undefined },
                            usage,
                        },
                    ],
                }),
                warnings: [],
            }),
        });
        mocks.createModel.mockReturnValue(model);

        const chunks = await readAll(
            await streamFeedback({ ...baseOptions, persona, annotationOnly: true }),
        );

        expect(model.doStreamCalls).toHaveLength(1);
        expect(model.doStreamCalls[0].toolChoice).toEqual({ type: "required" });
        expect(
            chunks.some(
                (chunk) =>
                    chunk.type === "text-delta" &&
                    chunk.delta === "Provider prose despite required tools.",
            ),
        ).toBe(true);
    });
});
