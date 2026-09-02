import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
    const openaiModelBuilder = vi.fn((modelId: string) => ({
        modelId,
        provider: "openai",
        specificationVersion: "v1",
    }));
    const anthropicModelBuilder = vi.fn((modelId: string) => ({
        modelId,
        provider: "anthropic",
        specificationVersion: "v1",
    }));
    const googleModelBuilder = vi.fn((modelId: string) => ({
        modelId,
        provider: "google",
        specificationVersion: "v1",
    }));
    const deepseekModelBuilder = vi.fn((modelId: string) => ({
        modelId,
        provider: "deepseek",
        specificationVersion: "v1",
    }));
    const oauthModelBuilder = vi.fn((modelId: string) => ({
        modelId,
        provider: "openai-oauth",
        specificationVersion: "v1",
    }));

    return {
        createOpenAI: vi.fn(() => openaiModelBuilder),
        createAnthropic: vi.fn(() => anthropicModelBuilder),
        createGoogleGenerativeAI: vi.fn(() => googleModelBuilder),
        createDeepSeek: vi.fn(() => deepseekModelBuilder),
        createOpenAIOAuth: vi.fn(() => oauthModelBuilder),
        openaiModelBuilder,
        anthropicModelBuilder,
        googleModelBuilder,
        deepseekModelBuilder,
        oauthModelBuilder,
    };
});

vi.mock("@ai-sdk/openai", () => ({
    createOpenAI: mocked.createOpenAI,
}));

vi.mock("@ai-sdk/anthropic", () => ({
    createAnthropic: mocked.createAnthropic,
}));

vi.mock("@ai-sdk/google", () => ({
    createGoogleGenerativeAI: mocked.createGoogleGenerativeAI,
}));

vi.mock("@ai-sdk/deepseek", () => ({
    createDeepSeek: mocked.createDeepSeek,
}));

vi.mock("@openai-oauth/ai-sdk", () => ({
    createOpenAIOAuth: mocked.createOpenAIOAuth,
}));

vi.mock("$lib/ai/openaiOAuth", () => ({
    getFreshOpenAISession: vi.fn(),
    openAIOAuthFetch: vi.fn(),
}));

import { createModel, resetOpenAIOAuthProvider } from "$lib/ai/provider";

beforeEach(() => {
    vi.clearAllMocks();
    resetOpenAIOAuthProvider();
});

describe("createModel", () => {
    it("routes openai provider through createOpenAI", () => {
        const model = createModel("openai", "openai-key", "gpt-4o-mini");

        expect(mocked.createOpenAI).toHaveBeenCalledWith({ apiKey: "openai-key" });
        expect(mocked.openaiModelBuilder).toHaveBeenCalledWith("gpt-4o-mini");
        expect(mocked.createAnthropic).not.toHaveBeenCalled();
        expect(mocked.createGoogleGenerativeAI).not.toHaveBeenCalled();
        expect(model).toMatchObject({ provider: "openai", modelId: "gpt-4o-mini" });
    });

    it("routes openai-compatible provider through createOpenAI with custom baseURL", () => {
        const model = createModel(
            "openai-compatible",
            "my-key",
            "llama3",
            "http://localhost:11434/v1",
        );

        expect(mocked.createOpenAI).toHaveBeenCalledWith({
            apiKey: "my-key",
            baseURL: "http://localhost:11434/v1",
        });
        expect(mocked.openaiModelBuilder).toHaveBeenCalledWith("llama3");
        expect(mocked.createAnthropic).not.toHaveBeenCalled();
        expect(mocked.createGoogleGenerativeAI).not.toHaveBeenCalled();
        expect(model).toMatchObject({ provider: "openai", modelId: "llama3" });
    });

    it("rejects an empty baseURL for openai-compatible", () => {
        expect(() => createModel("openai-compatible", "", "llama3")).toThrow(
            "Add a local endpoint base URL",
        );
        expect(mocked.createOpenAI).not.toHaveBeenCalled();
    });

    it("routes anthropic provider through createAnthropic", () => {
        const model = createModel("anthropic", "anthropic-key", "claude-3-7-sonnet");

        expect(mocked.createAnthropic).toHaveBeenCalledWith({ apiKey: "anthropic-key" });
        expect(mocked.anthropicModelBuilder).toHaveBeenCalledWith("claude-3-7-sonnet");
        expect(mocked.createOpenAI).not.toHaveBeenCalled();
        expect(mocked.createGoogleGenerativeAI).not.toHaveBeenCalled();
        expect(model).toMatchObject({ provider: "anthropic", modelId: "claude-3-7-sonnet" });
    });

    it("routes google provider through createGoogleGenerativeAI", () => {
        const model = createModel("google", "google-key", "gemini-2.0-flash");

        expect(mocked.createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: "google-key" });
        expect(mocked.googleModelBuilder).toHaveBeenCalledWith("gemini-2.0-flash");
        expect(mocked.createOpenAI).not.toHaveBeenCalled();
        expect(mocked.createAnthropic).not.toHaveBeenCalled();
        expect(model).toMatchObject({ provider: "google", modelId: "gemini-2.0-flash" });
    });

    it("routes deepseek through createDeepSeek", () => {
        const model = createModel("deepseek", "deepseek-key", "deepseek-chat");

        expect(mocked.createDeepSeek).toHaveBeenCalledWith({ apiKey: "deepseek-key" });
        expect(mocked.deepseekModelBuilder).toHaveBeenCalledWith("deepseek-chat");
        expect(model).toMatchObject({ provider: "deepseek", modelId: "deepseek-chat" });
    });

    it("reuses the ChatGPT OAuth provider across turns", () => {
        const first = createModel("openai-oauth", "", "codex-one");
        const second = createModel("openai-oauth", "", "codex-two");

        expect(mocked.createOpenAIOAuth).toHaveBeenCalledTimes(1);
        expect(mocked.createOpenAIOAuth).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "openai-oauth" }),
        );
        expect(mocked.oauthModelBuilder).toHaveBeenNthCalledWith(1, "codex-one");
        expect(mocked.oauthModelBuilder).toHaveBeenNthCalledWith(2, "codex-two");
        expect(first).toMatchObject({ provider: "openai-oauth", modelId: "codex-one" });
        expect(second).toMatchObject({ provider: "openai-oauth", modelId: "codex-two" });
    });
});
