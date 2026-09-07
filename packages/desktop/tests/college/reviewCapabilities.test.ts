import { createCollegeCapabilities } from "$lib/college/capabilities";
import type { CollegeSetup } from "$lib/college/model";
import { newCollegeSetup } from "$lib/college/presets";
import type { CrossEssayReviewPreview } from "$lib/college/review";
import type { CollegeReviewGroup, CollegeReviewSourceRef, Report } from "$lib/college/reviewModel";
import { reviewGroupFingerprint } from "$lib/college/reviewModel";
import type { SidebarPanelSession, SidebarPanelTarget } from "$lib/sidebar/panels";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    function store<T>(initial: T) {
        let value = initial;
        return {
            subscribe(run: (next: T) => void) {
                run(value);
                return () => undefined;
            },
            set(next: T) {
                value = next;
            },
            get() {
                return value;
            },
        };
    }

    const target = { documentId: "document-1", tabId: "tab-1", draftId: "draft-1" };
    const appSettings = { aiEnabled: true };
    const collegeState = {
        documentId: target.documentId,
        tabId: target.tabId,
        setup: null as CollegeSetup | null,
        status: "ready",
        error: "",
        saving: false,
        hostEnabled: true,
    };
    const currentDocumentId = store<string | null>(target.documentId);
    const currentDocumentTitle = store("Essay");
    const currentDraftId = store<string | null>(target.draftId);
    const currentDraftLabel = store("Current attempt");
    const currentTabId = store<string | null>(target.tabId);
    const currentTabLabel = store("Prompt tab");
    const documentContent = store("LIVE UNSAVED CONTENT");
    const rows = [] as Array<{ id: string; groupJson: string; updatedAt: number }>;
    const appEventBus = { emit: vi.fn() };
    const prepareReview = vi.fn();
    const validateReview = vi.fn(async () => undefined);
    const runReview = vi.fn();
    const resolveWorkspace = vi.fn(async () => ({
        groups: [],
        candidates: [],
        currentDraftGroupIds: [],
        warnings: [],
    }));
    const upsert = vi.fn(async (id: string, groupJson: string) => {
        const index = rows.findIndex((row) => row.id === id);
        const row = { id, groupJson, updatedAt: 2 };
        if (index < 0) rows.push(row);
        else rows[index] = row;
    });
    const remove = vi.fn(async (id: string) => {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
    });
    const getActiveCollegeSetup = vi.fn(() => collegeState.setup);

    return {
        target,
        appSettings,
        collegeState,
        stores: {
            currentDocumentId,
            currentDocumentTitle,
            currentDraftId,
            currentDraftLabel,
            currentTabId,
            currentTabLabel,
            documentContent,
        },
        rows,
        appEventBus,
        prepareReview,
        validateReview,
        runReview,
        resolveWorkspace,
        upsert,
        remove,
        getActiveCollegeSetup,
        hasApiKey: vi.fn(() => true),
    };
});

vi.mock("$lib/settings.svelte", () => ({ appSettings: mocks.appSettings }));
vi.mock("$lib/stores", () => mocks.stores);
vi.mock("$lib/events/appEventBus", () => ({ appEventBus: mocks.appEventBus }));
vi.mock("$lib/college/state.svelte", () => ({
    collegeState: mocks.collegeState,
    getActiveCollegeSetup: mocks.getActiveCollegeSetup,
    reloadCollegeSetup: vi.fn(async () => undefined),
    saveCollegeSetup: vi.fn(async () => undefined),
}));
vi.mock("$lib/college/workspace.svelte", () => ({ beginCollegeTabPick: vi.fn() }));
vi.mock("$lib/ai/settings.svelte", () => ({
    getAiAbortSignal: vi.fn(() => new AbortController().signal),
    getEffectiveDocumentContext: vi.fn(() => ({ freeform: "", decisions: [] })),
    hasApiKey: mocks.hasApiKey,
}));
vi.mock("$lib/ai/schoolResearch", () => ({
    researchProviderLabel: vi.fn(() => "OpenAI"),
    researchSchool: vi.fn(),
    researchUnavailableReason: vi.fn(() => ""),
}));
vi.mock("$lib/ai/crossEssayReview", () => ({ runCrossEssayReview: mocks.runReview }));
vi.mock("$lib/college/review", () => ({
    prepareCrossEssayReview: mocks.prepareReview,
    resolveCollegeReviewWorkspace: mocks.resolveWorkspace,
    validateCrossEssayReviewPreview: mocks.validateReview,
}));
vi.mock("$lib/db", () => ({
    createCollegeTabs: vi.fn(async () => []),
    deleteCollegeReviewGroup: mocks.remove,
    listCollegeReviewGroups: vi.fn(async () => mocks.rows),
    upsertCollegeReviewGroup: mocks.upsert,
}));
vi.mock("$lib/college/research", () => ({
    findingKey: vi.fn((value: { id: string }) => value.id),
}));

function ref(index: number): CollegeReviewSourceRef {
    return {
        documentId: `document-${index}`,
        tabId: `tab-${index}`,
        draftId: `draft-${index}`,
    };
}

function group(): CollegeReviewGroup {
    return {
        version: 1,
        id: "group-1",
        name: "Application set",
        school: "Example University",
        cycle: "2026",
        sources: [ref(1), ref(2)],
    };
}

function preview(value = group()): CrossEssayReviewPreview {
    const capturedSources = value.sources.map((source, index) => ({
        sourceKey: `source-${index + 1}`,
        ...source,
        documentLabel: `Essay ${index + 1}`,
        tabLabel: `Tab ${index + 1}`,
        draftLabel: `Draft ${index + 1}`,
        promptLabel: "Supplement",
        promptText: "Tell us about a community.",
        setupSchool: value.school,
        setupCycle: value.cycle,
        contentFingerprint: `fingerprint-${index + 1}`,
        totalChars: 5,
        sentChars: 5,
        omittedChars: 0,
        sentContent: "abcde",
    }));
    return {
        id: "preview-1",
        group: value,
        groupFingerprint: reviewGroupFingerprint(value),
        capturedSources,
        sendSummary: {
            sourceCount: 2,
            transmittedSourceCount: 2,
            omittedSourceCount: 0,
            totalChars: 10,
            sentChars: 10,
            omittedChars: 0,
            text: "2 sources sent",
        },
    };
}

function report(value = group()): Report {
    return {
        id: "report-1",
        groupId: value.id,
        createdAt: 1,
        providerLabel: "OpenAI",
        capturedSources: value.sources.map((source, index) => ({
            sourceKey: `source-${index + 1}`,
            ...source,
            documentLabel: `Essay ${index + 1}`,
            tabLabel: `Tab ${index + 1}`,
            draftLabel: `Draft ${index + 1}`,
            promptLabel: "Supplement",
            promptText: "Tell us about a community.",
            setupSchool: value.school,
            setupCycle: value.cycle,
            contentFingerprint: `fingerprint-${index + 1}`,
            totalChars: 5,
            sentChars: 5,
            omittedChars: 0,
        })),
        repeatedStories: [],
        contributions: [],
        contradictions: [],
        warnings: [],
    };
}

function sessionFor(): { session: SidebarPanelSession; moveTo: () => void } {
    let current = true;
    return {
        session: {
            target: { ...mocks.target },
            signal: new AbortController().signal,
            readSelection: () => null,
            isCurrent: () => current,
        },
        moveTo: () => {
            current = false;
        },
    };
}

beforeEach(() => {
    mocks.rows.splice(0);
    mocks.appSettings.aiEnabled = true;
    mocks.collegeState.hostEnabled = true;
    mocks.collegeState.status = "ready";
    mocks.collegeState.saving = false;
    mocks.stores.documentContent.set("LIVE UNSAVED CONTENT");
    mocks.prepareReview.mockReset();
    mocks.validateReview.mockReset();
    mocks.validateReview.mockResolvedValue(undefined);
    mocks.runReview.mockReset();
    mocks.resolveWorkspace.mockReset();
    mocks.resolveWorkspace.mockResolvedValue({
        groups: [],
        candidates: [],
        currentDraftGroupIds: [],
        warnings: [],
    });
    mocks.upsert.mockClear();
    mocks.remove.mockClear();
    mocks.appEventBus.emit.mockClear();
    mocks.hasApiKey.mockReset();
    mocks.hasApiKey.mockReturnValue(true);
});

describe("College cross-essay review capabilities", () => {
    it("exposes the target draft in snapshots and passes live current prose as the default override", async () => {
        const value = group();
        const prepared = preview(value);
        mocks.prepareReview.mockResolvedValue(prepared);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        expect(capabilities.read().draftId).toBe("draft-1");
        await capabilities.prepareReview(value);
        expect(mocks.prepareReview).toHaveBeenCalledWith(value, {
            sourceRef: mocks.target,
            documentContent: "LIVE UNSAVED CONTENT",
        });
    });

    it("persists a cloned saved group and loads workspace rows through the resolver", async () => {
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        const saved = await capabilities.saveReviewGroup({
            version: 1,
            name: "Application set",
            school: "Example University",
            cycle: "2026",
            sources: [ref(1), ref(2)],
        });
        expect(saved.id).toMatch(/./);
        expect(mocks.upsert).toHaveBeenCalledWith(
            saved.id,
            expect.stringContaining(`"id":"${saved.id}"`),
        );
        expect(saved).not.toBe(await capabilities.saveReviewGroup(saved));

        await capabilities.loadReviewWorkspace();
        expect(mocks.resolveWorkspace).toHaveBeenCalledWith(
            [expect.objectContaining({ id: saved.id })],
            "draft-1",
        );
    });

    it("loads local review metadata without requiring credentials", async () => {
        const value = group();
        mocks.rows.push({ id: value.id, groupJson: JSON.stringify(value), updatedAt: 1 });
        mocks.hasApiKey.mockReturnValue(false);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        await expect(capabilities.loadReviewWorkspace()).resolves.toBeDefined();
        expect(mocks.resolveWorkspace).toHaveBeenCalledWith(
            [expect.objectContaining({ id: value.id })],
            "draft-1",
        );
    });

    it("accepts only its private preview, validates before and after AI, then stores the report", async () => {
        const value = group();
        const prepared = preview(value);
        const generated = report(value);
        mocks.rows.push({ id: value.id, groupJson: JSON.stringify(value), updatedAt: 1 });
        mocks.prepareReview.mockResolvedValue(prepared);
        mocks.runReview.mockResolvedValue(generated);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        await capabilities.prepareReview(value);

        await expect(
            capabilities.runReview("other-preview", new AbortController().signal),
        ).rejects.toThrow(/preview is stale/i);
        await expect(
            capabilities.runReview(prepared.id, new AbortController().signal),
        ).resolves.toEqual(generated);
        expect(mocks.validateReview).toHaveBeenCalledTimes(2);
        expect(mocks.runReview).toHaveBeenCalledWith(prepared, expect.any(AbortSignal));
        expect(mocks.upsert).toHaveBeenCalledWith(
            value.id,
            expect.stringContaining('"latestReport"'),
        );
    });

    it("rejects a switched target and emits exact source navigation events", async () => {
        const value = group();
        const prepared = preview(value);
        mocks.prepareReview.mockResolvedValue(prepared);
        const { session, moveTo } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        await capabilities.prepareReview(value);
        moveTo();
        await expect(
            capabilities.runReview(prepared.id, new AbortController().signal),
        ).rejects.toThrow(/stale/i);
        expect(mocks.runReview).not.toHaveBeenCalled();
        expect(mocks.upsert).not.toHaveBeenCalled();

        // A fresh capability keeps navigation scoped to its original session.
        const second = sessionFor();
        const nextCapabilities = createCollegeCapabilities(second.session, vi.fn());
        nextCapabilities.navigateToReviewSource(ref(2), undefined, "fingerprint-2");
        expect(mocks.appEventBus.emit).toHaveBeenCalledWith({
            type: "college-review-source",
            sourceRef: ref(2),
            fingerprint: "fingerprint-2",
        });
    });

    it.each(["group", "source"] as const)(
        "discards a preview when its %s becomes stale and never saves a report",
        async (kind) => {
            const value = group();
            const prepared = preview(value);
            const generated = report(value);
            mocks.rows.push({ id: value.id, groupJson: JSON.stringify(value), updatedAt: 1 });
            mocks.prepareReview.mockResolvedValue(prepared);
            mocks.runReview.mockResolvedValue(generated);
            const { session } = sessionFor();
            const capabilities = createCollegeCapabilities(session, vi.fn());
            await capabilities.prepareReview(value);

            if (kind === "group") {
                mocks.rows[0]!.groupJson = JSON.stringify({ ...value, name: "Changed set" });
            } else {
                mocks.validateReview.mockRejectedValueOnce(
                    new Error("This cross-essay review is stale because a source changed."),
                );
            }

            await expect(
                capabilities.runReview(prepared.id, new AbortController().signal),
            ).rejects.toThrow(/stale|changed/i);
            expect(mocks.runReview).not.toHaveBeenCalled();
            expect(mocks.upsert).not.toHaveBeenCalled();
            await expect(
                capabilities.runReview(prepared.id, new AbortController().signal),
            ).rejects.toThrow(/preview is stale/i);
        },
    );

    it("does not persist or return a provider result after caller cancellation", async () => {
        const value = group();
        const prepared = preview(value);
        const generated = report(value);
        mocks.rows.push({ id: value.id, groupJson: JSON.stringify(value), updatedAt: 1 });
        mocks.prepareReview.mockResolvedValue(prepared);
        const caller = new AbortController();
        mocks.runReview.mockImplementation(async () => {
            caller.abort();
            return generated;
        });
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        await capabilities.prepareReview(value);

        await expect(capabilities.runReview(prepared.id, caller.signal)).rejects.toMatchObject({
            name: "AbortError",
        });
        expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it("deletes only the selected group", async () => {
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        await capabilities.deleteReviewGroup("group-1");
        expect(mocks.remove).toHaveBeenCalledWith("group-1");
    });
});
