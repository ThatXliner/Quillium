/**
 * tabDrafts.test.ts — Tab/draft identity and async race regression coverage.
 *
 * A tab switch crosses several IPC awaits. These tests force responses to
 * finish out of order and assert that only the newest tab may commit its draft
 * list or ask the editor to load content.
 */
import type { DraftMeta, TabMeta } from "$lib/db/types";
import { TabDraftController } from "$lib/editor/tabDrafts.svelte";
import { currentDocumentId, currentDraftId, currentTabId } from "$lib/stores";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    branchDraft: vi.fn(),
    cascadeDeleteDraft: vi.fn(),
    createTab: vi.fn(),
    deleteDraft: vi.fn(),
    deleteTab: vi.fn(),
    getActiveDraft: vi.fn(),
    getActiveTab: vi.fn(),
    iterateDraft: vi.fn(),
    listTabDrafts: vi.fn(),
    listTabs: vi.fn(),
    orphanAndDeleteDraft: vi.fn(),
    renameDraft: vi.fn(),
    renameTab: vi.fn(),
    reorderTabs: vi.fn(),
    reparentDraft: vi.fn(),
    restoreDraft: vi.fn(),
    restoreTab: vi.fn(),
    setActiveTab: vi.fn(),
    setDraftLocked: vi.fn(),
}));

vi.mock("$lib/db", () => db);
vi.mock("$lib/navigation", () => ({ goToHistory: vi.fn() }));
vi.mock("$lib/posthog", () => ({
    default: { capture: vi.fn() },
    captureException: vi.fn(),
}));
vi.mock("svelte-sonner", () => ({ toast: vi.fn() }));

function tab(id: string, position: number): TabMeta {
    return {
        id,
        documentId: "doc-1",
        tabType: "draft",
        label: `Tab ${id}`,
        position,
        createdAt: 1,
    };
}

function draft(id: string, tabId: string): DraftMeta {
    return {
        id,
        documentId: "doc-1",
        label: `Draft ${id}`,
        createdAt: 1,
        isActive: true,
        tabId,
        parentDraftId: null,
        branchedFrom: null,
        locked: false,
    };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

beforeEach(() => {
    vi.clearAllMocks();
    currentDocumentId.set("doc-1");
    currentTabId.set("tab-initial");
    currentDraftId.set("draft-initial");
    db.setActiveTab.mockResolvedValue(undefined);
});

afterEach(() => {
    currentDocumentId.set(null);
    currentTabId.set(null);
    currentDraftId.set(null);
});

describe("TabDraftController", () => {
    it("keeps the newest tab selection when an older lookup finishes last", async () => {
        const tabA = tab("tab-a", 0);
        const tabB = tab("tab-b", 1);
        const draftA = draft("draft-a", tabA.id);
        const draftB = draft("draft-b", tabB.id);
        const delayedA = deferred<DraftMeta[]>();
        const switchToDraft = vi.fn().mockResolvedValue(undefined);
        const controller = new TabDraftController({
            switchToDraft,
            flushPendingPersist: vi.fn().mockResolvedValue(undefined),
            seedStateJson: vi.fn(),
        });
        controller.tabs = [tabA, tabB];

        db.listTabDrafts.mockImplementation((tabId: string) =>
            tabId === tabA.id ? delayedA.promise : Promise.resolve([draftB]),
        );
        db.getActiveDraft.mockImplementation((tabId: string) =>
            Promise.resolve(tabId === tabA.id ? draftA.id : draftB.id),
        );

        const selectA = controller.handleTabSelect(tabA.id);
        await vi.waitFor(() => expect(db.listTabDrafts).toHaveBeenCalledWith(tabA.id));

        const selectB = controller.handleTabSelect(tabB.id);
        await selectB;
        delayedA.resolve([draftA]);
        await selectA;

        expect(get(currentTabId)).toBe(tabB.id);
        expect(controller.tabDrafts).toEqual([draftB]);
        expect(switchToDraft).toHaveBeenCalledOnce();
        expect(switchToDraft).toHaveBeenCalledWith(tabB.id, draftB.id);
    });

    it("cancels a pending switch when the user clicks back to the current tab", async () => {
        const tabA = tab("tab-a", 0);
        const tabB = tab("tab-b", 1);
        const delayedB = deferred<void>();
        const switchToDraft = vi.fn().mockResolvedValue(undefined);
        const controller = new TabDraftController({
            switchToDraft,
            flushPendingPersist: vi.fn().mockResolvedValue(undefined),
            seedStateJson: vi.fn(),
        });
        currentTabId.set(tabA.id);
        db.setActiveTab.mockImplementation((_docId: string, tabId: string) =>
            tabId === tabB.id ? delayedB.promise : Promise.resolve(),
        );

        const selectB = controller.handleTabSelect(tabB.id);
        await vi.waitFor(() => expect(db.setActiveTab).toHaveBeenCalledWith("doc-1", tabB.id));
        const stayOnA = controller.handleTabSelect(tabA.id);

        delayedB.resolve();
        await Promise.all([selectB, stayOnA]);

        expect(db.setActiveTab.mock.calls).toEqual([
            ["doc-1", tabB.id],
            ["doc-1", tabA.id],
        ]);
        expect(get(currentTabId)).toBe(tabA.id);
        expect(switchToDraft).not.toHaveBeenCalled();
    });

    it("pairs a healed tab with the draft created inside that tab", async () => {
        const emptyTab = tab("empty", 0);
        const freshTab = tab("fresh", 1);
        const freshDraft = draft("fresh-draft", freshTab.id);
        const controller = new TabDraftController({
            switchToDraft: vi.fn(),
            flushPendingPersist: vi.fn(),
            seedStateJson: vi.fn(),
        });

        db.listTabs.mockResolvedValue([emptyTab]);
        db.getActiveTab.mockResolvedValue(emptyTab.id);
        db.createTab.mockResolvedValue(freshTab);
        db.listTabDrafts.mockImplementation((tabId: string) =>
            Promise.resolve(tabId === emptyTab.id ? [] : [freshDraft]),
        );
        db.getActiveDraft.mockResolvedValue(freshDraft.id);

        const resolved = await controller.refreshTabState("doc-1");

        expect(resolved).toEqual({ tabId: freshTab.id, draftId: freshDraft.id });
        expect(get(currentTabId)).toBe(freshTab.id);
        expect(db.getActiveDraft).toHaveBeenCalledWith(freshTab.id);
    });

    it("accepts only owned College tabs and selects the first through the normal pipeline", async () => {
        const existing = tab("existing", 0);
        const created = tab("college", 1);
        const foreign = { ...tab("foreign", 2), documentId: "doc-2" };
        const createdDraft = draft("college-draft", created.id);
        const switchToDraft = vi.fn().mockResolvedValue(undefined);
        const controller = new TabDraftController({
            switchToDraft,
            flushPendingPersist: vi.fn().mockResolvedValue(undefined),
            seedStateJson: vi.fn(),
        });
        controller.tabs = [existing];
        currentTabId.set(existing.id);
        db.listTabDrafts.mockResolvedValue([createdDraft]);
        db.getActiveDraft.mockResolvedValue(createdDraft.id);

        await controller.acceptCreatedCollegeTabs("doc-1", [created, foreign, existing]);

        expect(controller.tabs).toEqual([existing, created]);
        expect(switchToDraft).toHaveBeenCalledWith(created.id, createdDraft.id);
        expect(get(currentTabId)).toBe(created.id);
    });

    it("can merge late College tabs without stealing focus", async () => {
        const existing = tab("existing", 0);
        const created = tab("college", 1);
        const controller = new TabDraftController({
            switchToDraft: vi.fn(),
            flushPendingPersist: vi.fn(),
            seedStateJson: vi.fn(),
        });
        controller.tabs = [existing];
        currentTabId.set(existing.id);

        await controller.acceptCreatedCollegeTabs("doc-1", [created], false);

        expect(controller.tabs).toEqual([existing, created]);
        expect(db.listTabDrafts).not.toHaveBeenCalled();
        expect(get(currentTabId)).toBe(existing.id);
    });

    it("ignores College tabs for a different current document", async () => {
        const existing = tab("existing", 0);
        const created = tab("college", 1);
        const controller = new TabDraftController({
            switchToDraft: vi.fn(),
            flushPendingPersist: vi.fn(),
            seedStateJson: vi.fn(),
        });
        controller.tabs = [existing];
        currentDocumentId.set("doc-2");

        await controller.acceptCreatedCollegeTabs("doc-1", [created]);

        expect(controller.tabs).toEqual([existing]);
    });
});
