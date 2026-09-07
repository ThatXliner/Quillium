import { streamChat } from "$lib/ai/clientStreams";
import { mockIPC } from "@tauri-apps/api/mocks";
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

const baseOptions = {
    messages: [],
    documentContent: "A draft with a private passage.",
    selectedText: "",
    provider: "openai-oauth" as const,
    model: "test-model",
    apiKey: "test-key",
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

async function flushLogging(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AI stream errors", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("emits a UI error and logs contextual provider details through native IPC", async () => {
        const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
        mockIPC((cmd, args) => {
            calls.push({ cmd, args: args as Record<string, unknown> });
            return null;
        });

        const cause = new Error("OAuth token refresh failed");
        const error = Object.assign(new Error("ChatGPT session expired"), {
            cause,
            statusCode: 401,
            isRetryable: false,
            requestBodyValues: { prompt: "private passage" },
            responseBody: "private provider response",
        });
        const model = new MockLanguageModelV3({
            doStream: async () => ({
                stream: simulateReadableStream({
                    chunks: [{ type: "error", error }],
                }),
                warnings: [],
            }),
        });
        mocks.createModel.mockReturnValue(model);

        const chunks = await readAll(await streamChat(baseOptions));
        await flushLogging();

        expect(chunks.some((chunk) => chunk.type === "error")).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].cmd).toBe("cmd_log_app_event");
        expect(calls[0].args.level).toBe("error");
        expect(calls[0].args.target).toBe("ai");
        expect(calls[0].args.message).toBe("AI stream failed");

        const details = JSON.parse(String(calls[0].args.details));
        expect(details.data).toMatchObject({
            mode: "chat",
            task: "conversation",
            provider: "openai-oauth",
            model: "test-model",
            error: {
                message: "ChatGPT session expired",
                statusCode: 401,
                isRetryable: false,
                cause: { message: "OAuth token refresh failed" },
            },
        });
        expect(details.data.error.stack).toContain("ChatGPT session expired");
        expect(String(calls[0].args.details)).not.toContain("private passage");
        expect(String(calls[0].args.details)).not.toContain("private provider response");
    });
});
