import { newCollegeSetup } from "$lib/college/presets";
import {
    REVIEW_SOURCE_CHAR_LIMIT,
    REVIEW_TOTAL_CHAR_LIMIT,
    fingerprintReviewContent,
    listCollegeEssayCandidates,
    prepareCrossEssayReview,
    validateCrossEssayReviewPreview,
} from "$lib/college/review";
import type { CollegeReviewGroup, CollegeReviewSourceRef } from "$lib/college/reviewModel";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const documents = [
        {
            id: "document-1",
            title: "Essay one",
            createdAt: 1,
            updatedAt: 1,
            wordCount: 1,
            previewText: "PRIVATE PROSE ONE",
            tags: "[]",
            deletedAt: null,
            persistHistory: true,
            createdWithVersion: "test",
        },
        {
            id: "document-2",
            title: "Essay two",
            createdAt: 1,
            updatedAt: 1,
            wordCount: 1,
            previewText: "PRIVATE PROSE TWO",
            tags: "[]",
            deletedAt: null,
            persistHistory: true,
            createdWithVersion: "test",
        },
        {
            id: "document-3",
            title: "Essay three",
            createdAt: 1,
            updatedAt: 1,
            wordCount: 1,
            previewText: "PRIVATE PROSE THREE",
            tags: "[]",
            deletedAt: null,
            persistHistory: true,
            createdWithVersion: "test",
        },
    ];
    const tabs = documents.map((document, index) => ({
        id: `tab-${index + 1}`,
        documentId: document.id,
        tabType: "draft",
        label: `Prompt tab ${index + 1}`,
        position: index,
        createdAt: 1,
    }));
    const drafts = tabs.map((tab, index) => ({
        id: `draft-${index + 1}`,
        documentId: tab.documentId,
        tabId: tab.id,
        label: `Attempt ${index + 1}`,
        createdAt: 1,
        isActive: true,
        parentDraftId: null,
        branchedFrom: null,
        locked: false,
    }));
    const contents = new Map<string, string>();
    const setups = new Map<string, string>();
    const listDocuments = vi.fn(async () => documents);
    const listTabs = vi.fn(async (documentId: string) =>
        tabs.filter((tab) => tab.documentId === documentId),
    );
    const listTabDrafts = vi.fn(async (tabId: string) =>
        drafts.filter((draft) => draft.tabId === tabId),
    );
    const getCollegeTabSetup = vi.fn(
        async (documentId: string, tabId: string) => setups.get(`${documentId}/${tabId}`) ?? null,
    );
    const loadDocumentState = vi.fn(async (_documentId: string, draftId?: string | null) => ({
        snapshotStateJson: contents.get(draftId ?? "") ?? "",
        snapshotEventId: 0,
        eventsSince: [],
    }));
    const listTrashedDocuments = vi.fn(async () => []);
    const listDocumentStructure = vi.fn(async () => ({ tabs: [], drafts: [] }));
    return {
        documents,
        tabs,
        drafts,
        contents,
        setups,
        listDocuments,
        listTabs,
        listTabDrafts,
        getCollegeTabSetup,
        loadDocumentState,
        listTrashedDocuments,
        listDocumentStructure,
    };
});

vi.mock("$lib/db", () => ({
    getCollegeTabSetup: mocks.getCollegeTabSetup,
    listDocumentStructure: mocks.listDocumentStructure,
    listDocuments: mocks.listDocuments,
    listTabDrafts: mocks.listTabDrafts,
    listTabs: mocks.listTabs,
    listTrashedDocuments: mocks.listTrashedDocuments,
    loadDocumentState: mocks.loadDocumentState,
}));
vi.mock("$lib/editor/extensions", () => ({ getExtensions: vi.fn(() => ({})) }));
vi.mock("$lib/editor/replay", () => ({
    reconstructState: vi.fn((snapshotStateJson: string) => ({
        doc: { toString: () => snapshotStateJson },
    })),
}));

function setup(school = "Example University") {
    const value = newCollegeSetup("supplemental");
    value.school = school;
    value.cycle = "2026";
    value.prompts[0]!.label = "Supplement";
    value.prompts[0]!.text = "Tell us about a community.";
    return value;
}

function ref(index: number): CollegeReviewSourceRef {
    return {
        documentId: `document-${index}`,
        tabId: `tab-${index}`,
        draftId: `draft-${index}`,
    };
}

function group(sources: CollegeReviewSourceRef[] = [ref(1), ref(2), ref(3)]): CollegeReviewGroup {
    return {
        version: 1,
        id: "group-1",
        name: "Application set",
        school: "Example University",
        cycle: "2026",
        sources,
    };
}

beforeEach(() => {
    mocks.contents.clear();
    mocks.setups.clear();
    for (const [index, document] of mocks.documents.entries()) {
        const tab = mocks.tabs[index]!;
        const draft = mocks.drafts[index]!;
        mocks.setups.set(`${document.id}/${tab.id}`, JSON.stringify(setup()));
        mocks.contents.set(draft.id, `Persisted essay ${index + 1}.`);
    }
    vi.clearAllMocks();
});

describe("College cross-essay source orchestration", () => {
    it("enumerates configured live drafts without exposing document preview prose", async () => {
        const candidates = await listCollegeEssayCandidates();
        expect(candidates).toHaveLength(3);
        expect(candidates[0]).toMatchObject({
            documentId: "document-1",
            tabId: "tab-1",
            draftId: "draft-1",
            promptLabel: "Supplement",
            setupSchool: "Example University",
        });
        expect(candidates[0]).not.toHaveProperty("previewText");
        expect(candidates[0]).not.toHaveProperty("documentContent");
        expect(mocks.loadDocumentState).not.toHaveBeenCalled();
    });

    it("uses an active override and truncates only suffixes under deterministic budgets", async () => {
        const first = "A".repeat(REVIEW_SOURCE_CHAR_LIMIT + 7);
        const second = "B".repeat(REVIEW_SOURCE_CHAR_LIMIT + 7);
        const third = "C".repeat(REVIEW_SOURCE_CHAR_LIMIT + 7);
        mocks.contents.set("draft-1", first);
        mocks.contents.set("draft-2", second);
        mocks.contents.set("draft-3", third);
        const override = "UNSAVED CURRENT ESSAY";
        const preview = await prepareCrossEssayReview(group(), {
            sourceRef: ref(2),
            documentContent: override,
        });

        expect(preview.capturedSources.map((source) => source.sentChars)).toEqual([
            REVIEW_SOURCE_CHAR_LIMIT,
            override.length,
            REVIEW_SOURCE_CHAR_LIMIT,
        ]);
        expect(preview.capturedSources[0]!.sentContent).toBe(
            first.slice(0, REVIEW_SOURCE_CHAR_LIMIT),
        );
        expect(preview.capturedSources[1]!.sentContent).toBe(override);
        expect(preview.capturedSources[2]!.sentContent).toBe(
            third.slice(0, REVIEW_SOURCE_CHAR_LIMIT),
        );
        expect(preview.capturedSources[0]!.omittedChars).toBe(7);
        expect(preview.capturedSources[1]!.contentFingerprint).toBe(
            fingerprintReviewContent(override),
        );
        expect(preview.sendSummary.omittedChars).toBe(
            first.length + override.length + third.length - preview.sendSummary.sentChars,
        );
        expect(preview.sendSummary.sentChars).toBeLessThanOrEqual(REVIEW_TOTAL_CHAR_LIMIT);
        expect(Object.isFrozen(preview)).toBe(true);
        expect(Object.isFrozen(preview.capturedSources[0])).toBe(true);
    });

    it("rejects unavailable, mismatched-school, and empty exact sources", async () => {
        await expect(
            prepareCrossEssayReview(group([ref(1), { ...ref(2), draftId: "not-live" }, ref(3)])),
        ).rejects.toThrow(/no longer live/i);

        mocks.setups.set("document-2/tab-2", JSON.stringify(setup("Other University")));
        await expect(prepareCrossEssayReview(group())).rejects.toThrow(/different school/i);

        mocks.setups.set("document-2/tab-2", JSON.stringify(setup()));
        mocks.contents.set("draft-2", "   \n");
        await expect(prepareCrossEssayReview(group())).rejects.toThrow(/empty/i);
    });

    it("detects changed full source content and supports validating the live override", async () => {
        const activeText = "Current unsaved essay.";
        const preview = await prepareCrossEssayReview(group(), {
            sourceRef: ref(1),
            documentContent: activeText,
        });
        await expect(
            validateCrossEssayReviewPreview(preview, {
                sourceRef: ref(1),
                documentContent: activeText,
            }),
        ).resolves.toBeUndefined();

        await expect(
            validateCrossEssayReviewPreview(preview, {
                sourceRef: ref(1),
                documentContent: "Changed while reviewing.",
            }),
        ).rejects.toThrow(/stale|changed/i);
    });
});
