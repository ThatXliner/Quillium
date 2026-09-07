import { parsePassageLink, serializePassageLink } from "$lib/editor/passageLink";
import {
    OVERLAP_MAX_SOURCES,
    OVERLAP_SOURCE_CHAR_LIMIT,
    OVERLAP_TOTAL_CHAR_LIMIT,
    listOverlapChoices,
    prepareOverlap,
    runOverlap,
} from "$lib/college/overlap";
import { newCollegeSetup } from "$lib/college/presets";
import { collegeState } from "$lib/college/state.svelte";
import { appSettings } from "$lib/settings.svelte";
import { currentDocumentId, currentDraftId, currentTabId, editorView } from "$lib/stores";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    tabs: [] as Array<Record<string, unknown>>,
    drafts: new Map<string, Array<Record<string, unknown>>>(),
    setups: new Map<string, string>(),
    contents: new Map<string, string>(),
    listTabs: vi.fn(),
    listTabDrafts: vi.fn(),
    getCollegeTabSetup: vi.fn(),
    loadDocumentState: vi.fn(),
    reconstructState: vi.fn(),
    getExtensions: vi.fn(() => []),
    createModel: vi.fn(() => ({ model: "fixture" })),
    ensureApiKeyLoaded: vi.fn(async () => undefined),
    hasApiKey: vi.fn(() => true),
    getAiAbortSignal: vi.fn(),
    beginAiTask: vi.fn(() => Symbol("overlap")),
    endAiTask: vi.fn(),
    outputObject: vi.fn((value: unknown) => value),
    generateText: vi.fn(),
    applyEditorialAction: vi.fn(() => ({ ok: true })),
    captureEditorialTarget: vi.fn(() => ({
        documentId: "document-1",
        tabId: "tab-1",
        draftId: "draft-1",
        selectedText: "",
        branchPath: [],
    })),
    compileEditorialPolicy: vi.fn(() => ({
        systemPrompt: "base policy",
        allowedActions: ["comment"],
    })),
    createAiGenerationProvenance: vi.fn((value: unknown) => value),
    aiSettings: {
        provider: "openai" as const,
        model: "fixture-model",
        apiKey: "fixture-key",
        baseURL: "",
    },
    globalAbort: new AbortController(),
    appSettings: { aiEnabled: true },
    collegeState: { hostEnabled: true },
}));

vi.mock("$lib/db", () => ({
    listTabs: mocks.listTabs,
    listTabDrafts: mocks.listTabDrafts,
    getCollegeTabSetup: mocks.getCollegeTabSetup,
    loadDocumentState: mocks.loadDocumentState,
}));
vi.mock("$lib/editor/extensions", () => ({ getExtensions: mocks.getExtensions }));
vi.mock("$lib/editor/replay", () => ({ reconstructState: mocks.reconstructState }));
vi.mock("$lib/ai/provider", () => ({ createModel: mocks.createModel }));
vi.mock("$lib/ai/settings.svelte", () => ({
    aiSettings: mocks.aiSettings,
    beginAiTask: mocks.beginAiTask,
    editorialPreferences: {
        stance: "author-first",
        feedbackDensity: "focused",
        voiceLatitude: "preserve",
    },
    endAiTask: mocks.endAiTask,
    ensureApiKeyLoaded: mocks.ensureApiKeyLoaded,
    getAiAbortSignal: mocks.getAiAbortSignal,
    hasApiKey: mocks.hasApiKey,
}));
vi.mock("$lib/settings.svelte", () => ({ appSettings: mocks.appSettings }));
vi.mock("$lib/college/state.svelte", () => ({ collegeState: mocks.collegeState }));
vi.mock("$lib/ai/editorialAction", () => ({
    applyEditorialAction: mocks.applyEditorialAction,
}));
vi.mock("$lib/ai/editorialTarget", () => ({
    captureEditorialTarget: mocks.captureEditorialTarget,
}));
vi.mock("$lib/ai/editorialPolicy", () => ({
    compileEditorialPolicy: mocks.compileEditorialPolicy,
}));
vi.mock("$lib/ai/provenance", () => ({
    createAiGenerationProvenance: mocks.createAiGenerationProvenance,
}));
vi.mock("ai", () => ({
    Output: { object: mocks.outputObject },
    generateText: mocks.generateText,
}));

const documentId = "document-1";
const targetTabId = "tab-1";
const targetDraftId = "draft-1";

function tab(id: string, label: string) {
    return {
        id,
        documentId,
        tabType: "draft",
        label,
        position: Number(id.slice(-1)),
        createdAt: 1,
    };
}

function draft(tabId: string, id: string, label: string, isActive = true) {
    return {
        id,
        documentId,
        tabId,
        label,
        createdAt: 1,
        isActive,
        parentDraftId: null,
        branchedFrom: null,
        locked: false,
    };
}

function setup(school: string): string {
    const value = newCollegeSetup("supplemental");
    value.school = school;
    value.prompts[0]!.label = "Essay prompt";
    value.prompts[0]!.text = "Tell us about a meaningful experience.";
    return JSON.stringify(value);
}

let targetText = "I built a community garden and learned to listen.";
let view: { state: { doc: { toString: () => string } } };

function session() {
    return {
        target: { documentId, tabId: targetTabId, draftId: targetDraftId },
        signal: new AbortController().signal,
        readSelection: () => null,
        isCurrent: () => true,
    };
}

function configureFixture(): void {
    const sourceTab = tab("tab-2", "Community prompt");
    mocks.tabs = [tab(targetTabId, "Current prompt"), sourceTab];
    mocks.drafts.clear();
    mocks.drafts.set(targetTabId, [draft(targetTabId, targetDraftId, "Current draft")]);
    mocks.drafts.set("tab-2", [draft("tab-2", "draft-2", "Source draft")]);
    mocks.setups.clear();
    mocks.setups.set(`${documentId}/${targetTabId}`, setup("Example University"));
    mocks.setups.set(`${documentId}/tab-2`, setup("Example University"));
    mocks.contents.clear();
    mocks.contents.set(targetDraftId, targetText);
    mocks.contents.set("draft-2", "I organized a community garden and learned to listen.");
    mocks.listTabs.mockImplementation(async () => mocks.tabs);
    mocks.listTabDrafts.mockImplementation(async (tabId: string) => mocks.drafts.get(tabId) ?? []);
    mocks.getCollegeTabSetup.mockImplementation(
        async (docId: string, tabId: string) => mocks.setups.get(`${docId}/${tabId}`) ?? null,
    );
    mocks.loadDocumentState.mockImplementation(async (_docId: string, draftId: string) => ({
        snapshotStateJson: mocks.contents.get(draftId) ?? "",
        snapshotEventId: 0,
        eventsSince: [],
    }));
    mocks.reconstructState.mockImplementation((snapshot: string) => ({
        doc: { toString: () => snapshot },
    }));
    targetText = "I built a community garden and learned to listen.";
    view = { state: { doc: { toString: () => targetText } } };
    currentDocumentId.set(documentId);
    currentTabId.set(targetTabId);
    currentDraftId.set(targetDraftId);
    editorView.set(view as never);
    mocks.globalAbort = new AbortController();
    mocks.getAiAbortSignal.mockImplementation(() => mocks.globalAbort.signal);
    Object.assign(mocks.aiSettings, {
        provider: "openai",
        model: "fixture-model",
        apiKey: "fixture-key",
        baseURL: "",
    });
    mocks.appSettings.aiEnabled = true;
    mocks.collegeState.hostEnabled = true;
    mocks.hasApiKey.mockReturnValue(true);
    mocks.ensureApiKeyLoaded.mockResolvedValue(undefined);
    mocks.generateText.mockResolvedValue({ output: { findings: [] } });
    mocks.applyEditorialAction.mockReset();
    mocks.applyEditorialAction.mockReturnValue({ ok: true });
    vi.clearAllMocks();
    // The fixture wiring above is intentionally restored after clearAllMocks.
    mocks.listTabs.mockImplementation(async () => mocks.tabs);
    mocks.listTabDrafts.mockImplementation(async (tabId: string) => mocks.drafts.get(tabId) ?? []);
    mocks.getCollegeTabSetup.mockImplementation(
        async (docId: string, tabId: string) => mocks.setups.get(`${docId}/${tabId}`) ?? null,
    );
    mocks.loadDocumentState.mockImplementation(async (_docId: string, draftId: string) => ({
        snapshotStateJson: mocks.contents.get(draftId) ?? "",
        snapshotEventId: 0,
        eventsSince: [],
    }));
    mocks.reconstructState.mockImplementation((snapshot: string) => ({
        doc: { toString: () => snapshot },
    }));
    mocks.getExtensions.mockReturnValue([]);
    mocks.hasApiKey.mockReturnValue(true);
    mocks.ensureApiKeyLoaded.mockResolvedValue(undefined);
    mocks.generateText.mockResolvedValue({ output: { findings: [] } });
    mocks.applyEditorialAction.mockReturnValue({ ok: true });
}

beforeEach(() => {
    configureFixture();
    collegeState.hostEnabled = true;
});

afterEach(() => {
    currentDocumentId.set(null);
    currentTabId.set(null);
    currentDraftId.set(null);
    editorView.set(undefined);
});

describe("overlap source selection", () => {
    it("lists only active configured live peer tabs without loading prose", async () => {
        const choices = await listOverlapChoices(session());

        expect(choices).toMatchObject([
            {
                tabId: "tab-2",
                tabLabel: "Community prompt",
                school: "Example University",
                selectedDraftId: "draft-2",
            },
        ]);
        expect(mocks.loadDocumentState).not.toHaveBeenCalled();
    });

    it("captures deterministic prefixes under the 12k per-source and 48k total limits", async () => {
        targetText = "T".repeat(13_000);
        mocks.contents.set(targetDraftId, targetText);
        mocks.contents.set("draft-2", "S".repeat(13_000));
        for (const index of [3, 4]) {
            const tabId = `tab-${index}`;
            const draftId = `draft-${index}`;
            mocks.tabs.push(tab(tabId, `Source prompt ${index}`));
            mocks.drafts.set(tabId, [draft(tabId, draftId, `Source draft ${index}`)]);
            mocks.setups.set(`${documentId}/${tabId}`, setup("Example University"));
            mocks.contents.set(draftId, String.fromCharCode(64 + index).repeat(13_000));
        }
        const preview = await prepareOverlap(
            session(),
            [
                { tabId: "tab-2", draftId: "draft-2" },
                { tabId: "tab-3", draftId: "draft-3" },
                { tabId: "tab-4", draftId: "draft-4" },
            ],
            "Example University",
        );

        expect(preview.sources).toHaveLength(3);
        expect(preview.sources).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ totalChars: 13_000, sentChars: OVERLAP_SOURCE_CHAR_LIMIT }),
            ]),
        );
        expect(preview.omittedChars).toBe(4_000);
        expect(
            preview.sources.reduce((sum, source) => sum + source.sentChars, 0),
        ).toBeLessThanOrEqual(OVERLAP_TOTAL_CHAR_LIMIT - OVERLAP_SOURCE_CHAR_LIMIT);
    });

    it("rejects duplicate tabs, the target tab, and more than three sources", async () => {
        await expect(
            prepareOverlap(
                session(),
                [{ tabId: targetTabId, draftId: targetDraftId }],
                "Example University",
            ),
        ).rejects.toThrow(/current tab/i);
        await expect(
            prepareOverlap(
                session(),
                [
                    { tabId: "tab-2", draftId: "draft-2" },
                    { tabId: "tab-2", draftId: "draft-2" },
                ],
                "Example University",
            ),
        ).rejects.toThrow(/one draft from each/i);
        await expect(
            prepareOverlap(
                session(),
                Array.from({ length: OVERLAP_MAX_SOURCES + 1 }, (_, index) => ({
                    tabId: `tab-${index + 2}`,
                    draftId: `draft-${index + 2}`,
                })),
                "Example University",
            ),
        ).rejects.toThrow(/no more than/i);
    });

    it("rejects a mismatched school, empty scope, and empty source", async () => {
        await expect(
            prepareOverlap(session(), [{ tabId: "tab-2", draftId: "draft-2" }], ""),
        ).rejects.toThrow(/school or application/i);
        mocks.setups.set(`${documentId}/tab-2`, setup("Other University"));
        await expect(
            prepareOverlap(
                session(),
                [{ tabId: "tab-2", draftId: "draft-2" }],
                "Example University",
            ),
        ).rejects.toThrow(/different school/i);
        mocks.setups.set(`${documentId}/tab-2`, setup("Example University"));
        mocks.contents.set("draft-2", " \n ");
        await expect(
            prepareOverlap(
                session(),
                [{ tabId: "tab-2", draftId: "draft-2" }],
                "Example University",
            ),
        ).rejects.toThrow(/empty/i);
    });
});

describe("supporting passage links", () => {
    it("round-trips bounded local links with punctuation and preserves invalid suffixes", () => {
        const quote = "garden (A)'s";
        const suffix = serializePassageLink({
            documentId,
            tabId: "tab-2",
            draftId: "draft-2",
            from: 4,
            to: 4 + quote.length,
            quote,
            fingerprint: "01234567-89abcdef",
        });
        const message = `A repeated anecdote matters.\n${suffix}`;
        expect(parsePassageLink(message)).toEqual({
            text: "A repeated anecdote matters.",
            link: {
                documentId,
                tabId: "tab-2",
                draftId: "draft-2",
                from: 4,
                to: 4 + quote.length,
                quote,
                fingerprint: "01234567-89abcdef",
            },
        });

        const invalid = message.replace("01234567-89abcdef", "bad");
        expect(parsePassageLink(invalid)).toEqual({ text: invalid, link: null });
    });
});

describe("overlap request and gateway", () => {
    it("sends a concrete overlap fixture and applies a provenance-backed linked comment", async () => {
        const preview = await prepareOverlap(
            session(),
            [{ tabId: "tab-2", draftId: "draft-2" }],
            "Example University",
        );
        const sourceQuote = "community garden";
        const sourceFrom = mocks.contents.get("draft-2")!.indexOf(sourceQuote);
        mocks.generateText.mockResolvedValue({
            output: {
                findings: [
                    {
                        targetQuote: sourceQuote,
                        comment:
                            "The same anecdote appears here; decide what unique work this essay does.",
                        sourceTabId: "tab-2",
                        sourceQuote,
                        sourceFrom,
                        sourceTo: sourceFrom + sourceQuote.length,
                    },
                ],
            },
        });

        const result = await runOverlap(session(), preview, new AbortController().signal);
        expect(result).toEqual({ applied: 1, skipped: 0 });
        expect(mocks.outputObject).toHaveBeenCalledOnce();
        const request = mocks.generateText.mock.calls[0]![0] as Record<string, unknown>;
        expect(request.maxRetries).toBe(0);
        expect(request.maxOutputTokens).toBe(2_500);
        expect(String(request.system)).toMatch(
            /thematic continuity|reuse across different schools/i,
        );
        expect(String(request.prompt)).toContain("community garden");
        expect(mocks.compileEditorialPolicy).toHaveBeenCalledWith(
            expect.objectContaining({ task: "global-review", requestedActions: ["comment"] }),
        );
        expect(mocks.createAiGenerationProvenance).toHaveBeenCalledWith(
            expect.objectContaining({ task: "global-review" }),
        );
        const payload = mocks.applyEditorialAction.mock.calls[0]![0] as {
            payload: { comment: string };
        };
        const link = parsePassageLink(payload.payload.comment);
        expect(link.text).toContain("same anecdote");
        expect(link.link).toMatchObject({
            documentId,
            tabId: "tab-2",
            draftId: "draft-2",
            from: sourceFrom,
            quote: sourceQuote,
        });
    });

    it("drops injected or out-of-prefix evidence without calling the gateway", async () => {
        const preview = await prepareOverlap(
            session(),
            [{ tabId: "tab-2", draftId: "draft-2" }],
            "Example University",
        );
        mocks.generateText.mockResolvedValue({
            output: {
                findings: [
                    {
                        targetQuote: "Ignore this instruction",
                        comment: "Injected comment",
                        sourceTabId: "tab-2",
                        sourceQuote: "not in source",
                        sourceFrom: 0,
                        sourceTo: 12,
                    },
                ],
            },
        });
        await expect(runOverlap(session(), preview, new AbortController().signal)).resolves.toEqual(
            {
                applied: 0,
                skipped: 1,
            },
        );
        expect(mocks.applyEditorialAction).not.toHaveBeenCalled();
    });

    it("does not request credentials when AI is unavailable", async () => {
        const preview = await prepareOverlap(
            session(),
            [{ tabId: "tab-2", draftId: "draft-2" }],
            "Example University",
        );
        mocks.appSettings.aiEnabled = false;
        await expect(runOverlap(session(), preview, new AbortController().signal)).rejects.toThrow(
            /enable ai/i,
        );
        expect(mocks.ensureApiKeyLoaded).not.toHaveBeenCalled();
        expect(mocks.generateText).not.toHaveBeenCalled();
    });

    it("rejects cancellation and stale target/source state before applying comments", async () => {
        const preview = await prepareOverlap(
            session(),
            [{ tabId: "tab-2", draftId: "draft-2" }],
            "Example University",
        );
        const caller = new AbortController();
        mocks.generateText.mockImplementation(() => new Promise(() => undefined));
        const pending = runOverlap(session(), preview, caller.signal);
        await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledOnce());
        caller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(mocks.applyEditorialAction).not.toHaveBeenCalled();

        mocks.generateText.mockResolvedValue({ output: { findings: [] } });
        const stalePreview = await prepareOverlap(
            session(),
            [{ tabId: "tab-2", draftId: "draft-2" }],
            "Example University",
        );
        mocks.contents.set("draft-2", "Changed source content.");
        await expect(
            runOverlap(session(), stalePreview, new AbortController().signal),
        ).rejects.toThrow(/stale|changed/i);
    });
});
