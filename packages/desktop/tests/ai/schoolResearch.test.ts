import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const openaiWebSearch = vi.fn((options: unknown) => ({ name: "openai-web-search", options }));
    const openaiResponses = vi.fn((modelId: string) => ({ provider: "openai", modelId }));
    const openaiProvider = {
        responses: openaiResponses,
        tools: { webSearch: openaiWebSearch },
    };

    const anthropicWebSearch = vi.fn((options: unknown) => ({
        name: "anthropic-web-search",
        options,
    }));
    const anthropicModel = vi.fn((modelId: string) => ({ provider: "anthropic", modelId }));
    const anthropicProvider = Object.assign(anthropicModel, {
        tools: { webSearch_20250305: anthropicWebSearch },
    });

    const googleSearch = vi.fn((options: unknown) => ({ name: "google-search", options }));
    const urlContext = vi.fn((options: unknown) => ({ name: "url-context", options }));
    const googleModel = vi.fn((modelId: string) => ({ provider: "google", modelId }));
    const googleProvider = Object.assign(googleModel, {
        tools: { googleSearch, urlContext },
    });

    return {
        appSettings: { aiEnabled: true },
        aiSettings: {
            provider: "openai",
            model: "gpt-5.6-sol",
            apiKey: "SECRET_API_KEY",
            baseURL: "",
        },
        beginAiTask: vi.fn(() => Symbol("school-research")),
        endAiTask: vi.fn(),
        ensureApiKeyLoaded: vi.fn(async () => undefined),
        getAiAbortSignal: vi.fn(() => new AbortController().signal),
        hasApiKey: vi.fn(() => true),
        createModel: vi.fn(() => ({ provider: "fallback", modelId: "fallback" })),
        createOpenAI: vi.fn(() => openaiProvider),
        createAnthropic: vi.fn(() => anthropicProvider),
        createGoogleGenerativeAI: vi.fn(() => googleProvider),
        openaiWebSearch,
        openaiResponses,
        anthropicWebSearch,
        anthropicModel,
        googleSearch,
        urlContext,
        googleModel,
        invoke: vi.fn(async (command: string) =>
            command === "school_research_fetch"
                ? "<main>Example University 2026–2027: 650 words. Use your own voice.</main>"
                : null,
        ),
        isTauri: vi.fn(() => true),
        generateText: vi.fn(),
        Output: { object: vi.fn((options: unknown) => options) },
        stepCountIs: vi.fn((count: number) => ({ count })),
    };
});

vi.mock("$lib/settings.svelte", () => ({
    appSettings: mocks.appSettings,
}));

vi.mock("$lib/ai/settings.svelte", () => ({
    aiSettings: mocks.aiSettings,
    beginAiTask: mocks.beginAiTask,
    endAiTask: mocks.endAiTask,
    ensureApiKeyLoaded: mocks.ensureApiKeyLoaded,
    getAiAbortSignal: mocks.getAiAbortSignal,
    hasApiKey: mocks.hasApiKey,
}));

vi.mock("$lib/ai/provider", () => ({
    createModel: mocks.createModel,
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: mocks.invoke,
    isTauri: mocks.isTauri,
}));

vi.mock("@ai-sdk/openai", () => ({
    createOpenAI: mocks.createOpenAI,
}));

vi.mock("@ai-sdk/anthropic", () => ({
    createAnthropic: mocks.createAnthropic,
}));

vi.mock("@ai-sdk/google", () => ({
    createGoogleGenerativeAI: mocks.createGoogleGenerativeAI,
}));

vi.mock("ai", () => ({
    Output: mocks.Output,
    generateText: mocks.generateText,
    stepCountIs: mocks.stepCountIs,
}));

import { researchSchool, usesHostedSchoolResearch } from "$lib/ai/schoolResearch";
import type { ResearchTarget } from "$lib/college/research";

const SOURCE = "https://admissions.example.edu/essays";

function target(): ResearchTarget {
    return {
        school: "Example University",
        cycle: "2026–2027",
        program: "History",
        sourceUrl: SOURCE,
        prompts: [{ id: "p1", label: "Supplement", text: "Why this school?" }],
    };
}

function generatedResult(cycle = ""): {
    output: {
        institutionMatches: boolean;
        warnings: string[];
        findings: Array<{
            url: string;
            kind: "requirement";
            summary: string;
            evidence: string;
            cycle: string;
            promptIds: string[];
        }>;
    };
    steps: Array<{ sources: Array<Record<string, string>> }>;
} {
    return {
        output: {
            institutionMatches: true,
            warnings: [],
            findings: [
                {
                    url: SOURCE,
                    kind: "requirement",
                    summary: "The response limit is 650 words.",
                    evidence: "650 words",
                    cycle,
                    promptIds: ["p1"],
                },
            ],
        },
        steps: [
            {
                sources: [
                    {
                        type: "source",
                        sourceType: "url",
                        url: SOURCE,
                        title: "Example University admissions",
                    },
                ],
            },
        ],
    };
}

function privateTarget(): ResearchTarget {
    return {
        ...target(),
        privateNotes: "PRIVATE_NOTES",
        credentials: "PRIVATE_CREDENTIALS",
        prompts: [{ ...target().prompts[0], essay: "PRIVATE_ESSAY" }],
    } as unknown as ResearchTarget;
}

function requestText(): string {
    const request = mocks.generateText.mock.calls[0]?.[0] as
        | { system?: unknown; prompt?: unknown }
        | undefined;
    return `${request?.system ?? ""}\n${request?.prompt ?? ""}`;
}

function nativeFetchCalls(): ReadonlyArray<ReadonlyArray<unknown>> {
    return mocks.invoke.mock.calls.filter((call) => call[0] === "school_research_fetch");
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.appSettings.aiEnabled = true;
    mocks.aiSettings.provider = "openai";
    mocks.aiSettings.model = "gpt-5.6-sol";
    mocks.aiSettings.apiKey = "SECRET_API_KEY";
    mocks.aiSettings.baseURL = "";
    mocks.isTauri.mockReturnValue(true);
    mocks.hasApiKey.mockReturnValue(true);
    mocks.getAiAbortSignal.mockImplementation(() => new AbortController().signal);
    mocks.ensureApiKeyLoaded.mockResolvedValue(undefined);
    mocks.invoke.mockImplementation(async (command: string) =>
        command === "school_research_fetch"
            ? "<main>Example University 2026–2027: 650 words. Use your own voice.</main>"
            : null,
    );
    mocks.generateText.mockResolvedValue(generatedResult());
    mocks.createModel.mockReturnValue({ provider: "fallback", modelId: "fallback" });
});

describe("usesHostedSchoolResearch", () => {
    it("recognizes current hosted model families and keeps fallback families native", () => {
        const cases: Array<
            [
                (
                    | "openai"
                    | "openai-oauth"
                    | "openai-compatible"
                    | "anthropic"
                    | "google"
                    | "deepseek"
                ),
                string,
                boolean,
            ]
        > = [
            ["openai", "gpt-5", true],
            ["openai", "gpt-5.6-sol", true],
            ["openai", "gpt-4o", false],
            ["anthropic", "claude-opus-4-6", true],
            ["anthropic", "claude-sonnet-4-6", true],
            ["anthropic", "claude-3-7-sonnet", true],
            ["anthropic", "claude-3-opus", false],
            ["google", "gemini-3.5-flash", true],
            ["google", "gemini-2.0-flash", true],
            ["google", "gemini-1.5-pro", false],
            ["openai-oauth", "codex-mini-latest", false],
            ["openai-compatible", "llama3", false],
            ["deepseek", "deepseek-chat", false],
        ];

        for (const [provider, model, expected] of cases) {
            expect(usesHostedSchoolResearch(provider, model)).toBe(expected);
        }
    });
});

describe("hosted school research", () => {
    it("uses OpenAI web search with the confirmed hostname and keeps cited URL sources", async () => {
        mocks.aiSettings.provider = "openai";
        mocks.aiSettings.model = "gpt-5.6-sol";
        mocks.generateText.mockResolvedValue(generatedResult());

        const result = await researchSchool(privateTarget(), new AbortController().signal);

        expect(mocks.createOpenAI).toHaveBeenCalledWith({ apiKey: "SECRET_API_KEY" });
        expect(mocks.openaiResponses).toHaveBeenCalledWith("gpt-5.6-sol");
        expect(mocks.openaiWebSearch).toHaveBeenCalledWith({
            filters: { allowedDomains: ["admissions.example.edu"] },
        });
        expect(result.pages).toEqual([{ url: SOURCE, title: "Example University admissions" }]);
        expect(result.findings[0]?.url).toBe(SOURCE);
        expect(nativeFetchCalls()).toHaveLength(0);
        expect(requestText()).not.toMatch(
            /PRIVATE_NOTES|PRIVATE_CREDENTIALS|PRIVATE_ESSAY|SECRET_API_KEY/,
        );
    });

    it("uses Anthropic's current web search contract and keeps cited URL sources", async () => {
        mocks.aiSettings.provider = "anthropic";
        mocks.aiSettings.model = "claude-opus-4-6";
        mocks.generateText.mockResolvedValue(generatedResult());

        const result = await researchSchool(privateTarget(), new AbortController().signal);

        expect(mocks.createAnthropic).toHaveBeenCalledWith({ apiKey: "SECRET_API_KEY" });
        expect(mocks.anthropicModel).toHaveBeenCalledWith("claude-opus-4-6");
        expect(mocks.anthropicWebSearch).toHaveBeenCalledWith({
            maxUses: 1,
            allowedDomains: ["admissions.example.edu"],
        });
        expect(result.pages).toEqual([{ url: SOURCE, title: "Example University admissions" }]);
        expect(result.findings[0]?.url).toBe(SOURCE);
        expect(nativeFetchCalls()).toHaveLength(0);
        expect(requestText()).not.toMatch(
            /PRIVATE_NOTES|PRIVATE_CREDENTIALS|PRIVATE_ESSAY|SECRET_API_KEY/,
        );
    });

    it("uses Google's search and URL context tools and states the exact URL restriction", async () => {
        mocks.aiSettings.provider = "google";
        mocks.aiSettings.model = "gemini-3.5-flash";
        mocks.generateText.mockResolvedValue(generatedResult());

        const result = await researchSchool(privateTarget(), new AbortController().signal);
        const request = mocks.generateText.mock.calls[0]?.[0] as {
            prompt?: string;
            tools?: Record<string, unknown>;
        };

        expect(mocks.createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: "SECRET_API_KEY" });
        expect(mocks.googleModel).toHaveBeenCalledWith("gemini-3.5-flash");
        expect(mocks.googleSearch).toHaveBeenCalledWith({});
        expect(mocks.urlContext).toHaveBeenCalledWith({});
        expect(Object.keys(request.tools ?? {})).toEqual(["google_search", "url_context"]);
        expect(request.prompt).toContain(SOURCE);
        expect(request.prompt).toContain("admissions.example.edu");
        expect(result.pages).toEqual([{ url: SOURCE, title: "Example University admissions" }]);
        expect(result.findings[0]?.url).toBe(SOURCE);
        expect(nativeFetchCalls()).toHaveLength(0);
        expect(requestText()).not.toMatch(
            /PRIVATE_NOTES|PRIVATE_CREDENTIALS|PRIVATE_ESSAY|SECRET_API_KEY/,
        );
    });
});

describe("fallback school research", () => {
    it("fetches the confirmed target once and uses createModel for each native provider", async () => {
        const cases: Array<{
            provider: "openai-oauth" | "openai-compatible" | "deepseek" | "openai";
            model: string;
            baseURL: string;
        }> = [
            { provider: "openai-oauth", model: "codex-mini-latest", baseURL: "" },
            {
                provider: "openai-compatible",
                model: "llama3",
                baseURL: "http://localhost:11434/v1",
            },
            { provider: "deepseek", model: "deepseek-chat", baseURL: "" },
            { provider: "openai", model: "gpt-4o", baseURL: "" },
        ];

        for (const testCase of cases) {
            vi.clearAllMocks();
            mocks.appSettings.aiEnabled = true;
            mocks.aiSettings.provider = testCase.provider;
            mocks.aiSettings.model = testCase.model;
            mocks.aiSettings.apiKey = "SECRET_API_KEY";
            mocks.aiSettings.baseURL = testCase.baseURL;
            mocks.isTauri.mockReturnValue(true);
            mocks.hasApiKey.mockReturnValue(true);
            mocks.getAiAbortSignal.mockImplementation(() => new AbortController().signal);
            mocks.ensureApiKeyLoaded.mockResolvedValue(undefined);
            mocks.invoke.mockImplementation(async (command: string) =>
                command === "school_research_fetch"
                    ? "<main>Example University 2026–2027: 650 words. Use your own voice.</main>"
                    : null,
            );
            mocks.generateText.mockResolvedValue(generatedResult("2026–2027"));
            mocks.createModel.mockReturnValue({ provider: "fallback", modelId: testCase.model });

            const result = await researchSchool(privateTarget(), new AbortController().signal);

            expect(nativeFetchCalls()).toHaveLength(1);
            expect(nativeFetchCalls()[0]?.[1]).toEqual(expect.objectContaining({ url: SOURCE }));
            expect(mocks.createModel).toHaveBeenCalledTimes(1);
            expect(mocks.createModel).toHaveBeenCalledWith(
                testCase.provider,
                "SECRET_API_KEY",
                testCase.model,
                testCase.baseURL,
            );
            expect(mocks.generateText).toHaveBeenCalledTimes(1);
            expect(result.findings[0]?.url).toBe(SOURCE);
            expect(requestText()).not.toMatch(
                /PRIVATE_NOTES|PRIVATE_CREDENTIALS|PRIVATE_ESSAY|SECRET_API_KEY/,
            );
        }
    });
});
