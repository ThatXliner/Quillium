import type { Provider } from "$lib/ai/provider";
import type { AutoAIReviewAnnotation } from "$lib/autoai/reviewSchema";

export type ProviderConformanceFixture = {
    name: string;
    provider: Provider;
    model: string;
    apiKey: string;
    baseURL?: string;
    autoAIResponse: unknown;
    normalized: AutoAIReviewAnnotation[];
};

export const PROVIDER_CONFORMANCE_FIXTURES: ProviderConformanceFixture[] = [
    {
        name: "OpenAI API",
        provider: "openai",
        model: "gpt-test",
        apiKey: "openai-key",
        autoAIResponse: {
            annotations: [
                { type: "comment", targetText: "deliberate fragment", comment: "Keep it." },
            ],
        },
        normalized: [{ type: "comment", targetText: "deliberate fragment", comment: "Keep it." }],
    },
    {
        name: "ChatGPT OAuth",
        provider: "openai-oauth",
        model: "codex-test",
        apiKey: "",
        autoAIResponse: {
            annotations: [
                {
                    type: "comment",
                    targetText: "deliberate fragment",
                    explanation: "The fragment sharpens the rhythm.",
                },
            ],
        },
        normalized: [
            {
                type: "comment",
                targetText: "deliberate fragment",
                comment: "The fragment sharpens the rhythm.",
            },
        ],
    },
    {
        name: "OpenAI-compatible",
        provider: "openai-compatible",
        model: "local-test",
        apiKey: "",
        baseURL: "http://127.0.0.1:11434/v1",
        autoAIResponse: {
            annotations: [
                {
                    type: "suggestion",
                    targetText: "contains a",
                    replacement: "holds one",
                    rationale: "More direct.",
                },
            ],
        },
        normalized: [
            {
                type: "suggestion",
                targetText: "contains a",
                replacement: "holds one",
                rationale: "More direct.",
            },
        ],
    },
    {
        name: "Anthropic",
        provider: "anthropic",
        model: "claude-test",
        apiKey: "anthropic-key",
        autoAIResponse: {
            annotations: [
                {
                    type: "suggestion",
                    targetText: "contains a",
                    suggestedReplacement: "holds one",
                    explanation: "More direct.",
                },
            ],
        },
        normalized: [
            {
                type: "suggestion",
                targetText: "contains a",
                replacement: "holds one",
                rationale: "More direct.",
            },
        ],
    },
    {
        name: "Google",
        provider: "google",
        model: "gemini-test",
        apiKey: "google-key",
        autoAIResponse: {
            annotations: [
                {
                    type: "revision",
                    targetText: "The draft contains a deliberate fragment.",
                    versionLabel: "Compressed",
                    versionText: "The draft keeps its deliberate fragment.",
                    threadMessage: "A tighter path.",
                },
            ],
        },
        normalized: [
            {
                type: "revision",
                targetText: "The draft contains a deliberate fragment.",
                versions: [
                    { label: "Compressed", text: "The draft keeps its deliberate fragment." },
                ],
                threadMessage: "A tighter path.",
            },
        ],
    },
    {
        name: "DeepSeek",
        provider: "deepseek",
        model: "deepseek-test",
        apiKey: "deepseek-key",
        autoAIResponse: {
            annotations: [
                {
                    type: "revision",
                    targetText: "The draft contains a deliberate fragment.",
                    label: "Options",
                    revisions: [
                        "The draft keeps a deliberate fragment.",
                        "A deliberate fragment remains in the draft.",
                    ],
                    explanation: "Two alternate rhythms.",
                },
            ],
        },
        normalized: [
            {
                type: "revision",
                targetText: "The draft contains a deliberate fragment.",
                versions: [
                    { label: "Options 1", text: "The draft keeps a deliberate fragment." },
                    { label: "Options 2", text: "A deliberate fragment remains in the draft." },
                ],
                threadMessage: "Two alternate rhythms.",
            },
        ],
    },
];
