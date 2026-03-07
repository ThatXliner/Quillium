import { describe, it, expect, vi } from "vitest";

vi.mock("@ai-sdk/openai", () => ({
    createOpenAI: (opts: { apiKey: string }) =>
        (modelId: string) => ({
            modelId,
            provider: "openai",
            specificationVersion: "v1",
            apiKey: opts.apiKey,
        }),
}));

vi.mock("@ai-sdk/anthropic", () => ({
    createAnthropic: (opts: { apiKey: string }) =>
        (modelId: string) => ({
            modelId,
            provider: "anthropic",
            specificationVersion: "v1",
            apiKey: opts.apiKey,
        }),
}));

vi.mock("@ai-sdk/google", () => ({
    createGoogleGenerativeAI: (opts: { apiKey: string }) =>
        (modelId: string) => ({
            modelId,
            provider: "google",
            specificationVersion: "v1",
            apiKey: opts.apiKey,
        }),
}));

import { createModel } from "$lib/ai/provider";

describe("createModel", () => {
    it("returns a truthy object for openai provider", () => {
        const model = createModel("openai", "test-key", "gpt-4");
        expect(model).toBeTruthy();
    });

    it("returns a truthy object for anthropic provider", () => {
        const model = createModel(
            "anthropic",
            "test-key",
            "claude-3-5-sonnet-20241022",
        );
        expect(model).toBeTruthy();
    });

    it("returns a truthy object for google provider", () => {
        const model = createModel("google", "test-key", "gemini-pro");
        expect(model).toBeTruthy();
    });

    it("returned object has LanguageModel-like properties", () => {
        const model = createModel("openai", "test-key", "gpt-4");
        const obj = model as unknown as Record<string, unknown>;
        expect(obj).toHaveProperty("modelId", "gpt-4");
        expect(obj).toHaveProperty("specificationVersion", "v1");
    });

    it("different modelIds produce objects with different model identifiers", () => {
        const modelA = createModel("openai", "test-key", "gpt-4");
        const modelB = createModel("openai", "test-key", "gpt-4o");
        const objA = modelA as unknown as Record<string, unknown>;
        const objB = modelB as unknown as Record<string, unknown>;
        expect(objA.modelId).toBe("gpt-4");
        expect(objB.modelId).toBe("gpt-4o");
        expect(objA.modelId).not.toBe(objB.modelId);
    });
});
