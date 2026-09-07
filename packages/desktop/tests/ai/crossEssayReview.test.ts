import {
    CROSS_ESSAY_REVIEW_SYSTEM,
    evaluateCrossEssayReviewQuality,
    runCrossEssayReview,
} from "$lib/ai/crossEssayReview";
import type { CrossEssayReviewPreview } from "$lib/college/review";
import {
    type CapturedReviewSource,
    type CollegeReviewGroup,
    reviewSourceKey,
} from "$lib/college/reviewModel";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const appSettings = { aiEnabled: true };
    const aiSettings = {
        provider: "openai" as const,
        model: "gpt-5.6-sol",
        apiKey: "secret-key",
        baseURL: "",
    };
    const globalAbort = new AbortController();
    return {
        appSettings,
        aiSettings,
        globalAbort,
        createModel: vi.fn(() => ({ model: "test-model" })),
        generateText: vi.fn(),
        outputObject: vi.fn((value: unknown) => value),
        beginAiTask: vi.fn(() => Symbol("review")),
        endAiTask: vi.fn(),
        ensureApiKeyLoaded: vi.fn(async () => undefined),
        getAiAbortSignal: vi.fn(() => globalAbort.signal),
        hasApiKey: vi.fn(() => true),
    };
});

vi.mock("$lib/settings.svelte", () => ({ appSettings: mocks.appSettings }));
vi.mock("$lib/ai/provider", () => ({ createModel: mocks.createModel }));
vi.mock("$lib/ai/settings.svelte", () => ({
    aiSettings: mocks.aiSettings,
    beginAiTask: mocks.beginAiTask,
    endAiTask: mocks.endAiTask,
    ensureApiKeyLoaded: mocks.ensureApiKeyLoaded,
    getAiAbortSignal: mocks.getAiAbortSignal,
    hasApiKey: mocks.hasApiKey,
}));
vi.mock("ai", () => ({
    Output: { object: mocks.outputObject },
    generateText: mocks.generateText,
}));

const contents = [
    "I organized a community garden on Saturday mornings. I learned to listen before leading.",
    "At the community garden, I tracked seed dates and taught younger volunteers. I learned to explain clearly.",
    "I built a garden data project in June and measured harvests. I worked 8 hours on June 3.",
];

function source(index: number): CapturedReviewSource {
    const sourceRef = {
        documentId: `document-${index + 1}`,
        tabId: `tab-${index + 1}`,
        draftId: `draft-${index + 1}`,
    };
    const sentContent = contents[index]!;
    return {
        sourceKey: reviewSourceKey(sourceRef),
        ...sourceRef,
        documentLabel: `Essay ${index + 1}`,
        tabLabel: `Prompt ${index + 1}`,
        draftLabel: `Attempt ${index + 1}`,
        promptLabel: "Supplement",
        promptText: "Tell us about a community.",
        setupSchool: "Example University",
        setupCycle: "2026",
        contentFingerprint: `full-${index + 1}`,
        totalChars: sentContent.length,
        sentChars: sentContent.length,
        omittedChars: 0,
        sentContent,
    };
}

function preview(): CrossEssayReviewPreview {
    const capturedSources = [source(0), source(1), source(2)];
    const group: CollegeReviewGroup = {
        version: 1,
        id: "group-1",
        name: "Application set",
        school: "Example University",
        cycle: "2026",
        sources: capturedSources.map(({ documentId, tabId, draftId }) => ({
            documentId,
            tabId,
            draftId,
        })),
    };
    const totalChars = capturedSources.reduce((sum, item) => sum + item.totalChars, 0);
    return {
        id: "preview-1",
        group,
        groupFingerprint: "group-fingerprint",
        capturedSources,
        sendSummary: {
            sourceCount: capturedSources.length,
            transmittedSourceCount: capturedSources.length,
            omittedSourceCount: 0,
            totalChars,
            sentChars: totalChars,
            omittedChars: 0,
            text: `${totalChars} characters sent`,
        },
    };
}

function citation(sourceValue: CapturedReviewSource, quote: string) {
    const from = sourceValue.sentContent.indexOf(quote);
    if (from < 0) throw new Error(`Missing fixture quote: ${quote}`);
    return {
        sourceKey: sourceValue.sourceKey,
        from,
        to: from + quote.length,
        quote,
    };
}

function extractionFor(review: CrossEssayReviewPreview) {
    const [first, second, third] = review.capturedSources;
    const garden1 = citation(first!, "community garden");
    const garden2 = citation(second!, "community garden");
    return {
        repeatedStories: [
            {
                summary: "The community-garden story appears in two essays.",
                citations: [garden1, garden2],
            },
        ],
        contributions: [
            {
                sourceKey: first!.sourceKey,
                summary: "The first essay contributes a lesson about listening before leading.",
                citations: [citation(first!, "listen before leading")],
            },
            {
                sourceKey: second!.sourceKey,
                summary: "The second essay contributes volunteer teaching and seed tracking.",
                citations: [citation(second!, "tracked seed dates")],
            },
            {
                sourceKey: third!.sourceKey,
                summary: "The third essay contributes a measurable data project.",
                citations: [citation(third!, "measured harvests")],
            },
        ],
        contradictions: [
            {
                question:
                    "Could the stated hours and June date be reconciled across these accounts?",
                citations: [citation(third!, "June 3"), citation(first!, "Saturday mornings")],
            },
        ],
        warnings: [],
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.appSettings.aiEnabled = true;
    mocks.aiSettings.provider = "openai";
    mocks.aiSettings.model = "gpt-5.6-sol";
    mocks.aiSettings.apiKey = "secret-key";
    mocks.aiSettings.baseURL = "";
    mocks.hasApiKey.mockReturnValue(true);
    mocks.ensureApiKeyLoaded.mockResolvedValue(undefined);
    mocks.getAiAbortSignal.mockImplementation(() => mocks.globalAbort.signal);
    mocks.generateText.mockResolvedValue({ output: extractionFor(preview()) });
});

describe("cross-essay review provider orchestration", () => {
    it("makes one bounded structured request and persists metadata without prose", async () => {
        const review = preview();
        mocks.generateText.mockResolvedValue({ output: extractionFor(review) });
        const report = await runCrossEssayReview(review, new AbortController().signal);
        const request = mocks.generateText.mock.calls[0]?.[0] as Record<string, unknown>;

        expect(mocks.createModel).toHaveBeenCalledWith("openai", "secret-key", "gpt-5.6-sol", "");
        expect(mocks.generateText).toHaveBeenCalledTimes(1);
        expect(request.model).toEqual({ model: "test-model" });
        expect(request.maxRetries).toBe(0);
        expect(request.maxOutputTokens).toBe(4_000);
        expect(request.output).toBeDefined();
        expect(String(request.system)).toContain("untrusted data");
        expect(String(request.system)).toMatch(
            /reuse across different schools is not inherently redundant/i,
        );
        expect(String(request.prompt)).toContain(contents[0]);
        expect(String(request.prompt)).toContain(contents[2]);
        expect(String(request.prompt)).not.toContain("contentFingerprint");
        expect(report.capturedSources[0]).not.toHaveProperty("sentContent");
        expect(report.repeatedStories[0]!.citations[0]!.quote).toBe("community garden");
    });

    it("keeps exact evidence and evaluates repeated stories, contributions, and contradictions", async () => {
        const review = preview();
        const extraction = extractionFor(review);
        mocks.generateText.mockResolvedValue({ output: extraction });
        const report = await runCrossEssayReview(review, new AbortController().signal);
        const quality = evaluateCrossEssayReviewQuality(report, review);

        expect(report.repeatedStories[0]!.citations).toEqual(
            extraction.repeatedStories[0]!.citations,
        );
        expect(report.contributions.map((item) => item.sourceKey)).toEqual(
            review.capturedSources.map((item) => item.sourceKey),
        );
        expect(report.contradictions[0]!.citations[0]!.quote).toBe("June 3");
        expect(quality).toMatchObject({
            evidenceValidity: true,
            contradictionEvidenceValidity: true,
            passes: true,
            repeatedStoryCoverage: { covered: true, validStoryCount: 1 },
            contributionCoverage: {
                covered: true,
                missingSourceKeys: [],
            },
        });
    });

    it("drops findings with any invalid, out-of-range, or omitted citation", async () => {
        const review = preview();
        const first = review.capturedSources[0]!;
        const second = review.capturedSources[1]!;
        const valid = citation(first, "community garden");
        mocks.generateText.mockResolvedValue({
            output: {
                repeatedStories: [
                    {
                        summary: "Should be dropped",
                        citations: [
                            valid,
                            { ...citation(second, "community garden"), quote: "wrong quote" },
                        ],
                    },
                ],
                contributions: [
                    {
                        sourceKey: first.sourceKey,
                        summary: "Out of range",
                        citations: [{ ...valid, from: 9_999, to: 10_000, quote: "nope" }],
                    },
                ],
                contradictions: [
                    {
                        question: "Was this consistent?",
                        citations: [valid, { ...citation(second, "community garden"), from: -1 }],
                    },
                ],
                warnings: [],
            },
        });
        const report = await runCrossEssayReview(review, new AbortController().signal);
        expect(report.repeatedStories).toEqual([]);
        expect(report.contributions).toEqual([]);
        expect(report.contradictions).toEqual([]);
        expect(report.warnings.join(" ")).toMatch(/invalid|insufficient|evidence/i);
    });

    it("filters admissions predictions and responds to cancellation", async () => {
        const review = preview();
        const first = review.capturedSources[0]!;
        mocks.generateText.mockResolvedValue({
            output: {
                repeatedStories: [],
                contributions: [
                    {
                        sourceKey: first.sourceKey,
                        summary: "This essay will likely be admitted.",
                        citations: [citation(first, "community garden")],
                    },
                ],
                contradictions: [],
                warnings: [],
            },
        });
        const report = await runCrossEssayReview(review, new AbortController().signal);
        expect(report.contributions).toEqual([]);
        expect(report.warnings.join(" ")).toMatch(/unsupported prediction/i);
        expect(report.warnings.join(" ")).not.toContain("will likely be admitted");

        const caller = new AbortController();
        mocks.generateText.mockImplementation(
            ({ abortSignal }: { abortSignal: AbortSignal }) =>
                new Promise((_, reject) => {
                    abortSignal.addEventListener("abort", () => reject(new Error("aborted")), {
                        once: true,
                    });
                }),
        );
        const pending = runCrossEssayReview(review, caller.signal);
        caller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(mocks.endAiTask).toHaveBeenCalled();
    });
});

describe("cross-essay review system prompt", () => {
    it("states the evidence and safety contract", () => {
        expect(CROSS_ESSAY_REVIEW_SYSTEM).toMatch(/untrusted data/i);
        expect(CROSS_ESSAY_REVIEW_SYSTEM).toMatch(/omitted text was reviewed/i);
        expect(CROSS_ESSAY_REVIEW_SYSTEM).toMatch(/contradictions? as questions/i);
    });
});
