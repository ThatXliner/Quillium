/**
 * tabDrafts.test.ts — Tab/draft identity and async race regression coverage.
 *
 * A tab switch crosses several IPC awaits. These tests force responses to
 * finish out of order and assert that only the newest tab may commit its draft
 * list or ask the editor to load content.
 */
import type { DraftMeta, TabMeta } from "$lib/db/types";
import DraftTreePanel from "$lib/editor/DraftTreePanel.svelte";
import { TabDraftController } from "$lib/editor/tabDrafts.svelte";
import { currentDocumentId, currentDraftId, currentTabId } from "$lib/stores";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
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
vi.mock("svelte-sonner", () => ({
    toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }),
}));

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
    cleanup();
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

it("restores a deleted draft with Cmd-Z after the toast is gone", async () => {
    const survivor = draft("draft-initial", "tab-initial");
    const removed = { ...draft("take", "tab-initial"), branchedFrom: survivor.id };
    const controller = new TabDraftController({
        switchToDraft: vi.fn(),
        flushPendingPersist: vi.fn().mockResolvedValue(undefined),
        seedStateJson: vi.fn(),
    });
    controller.tabDrafts = [survivor, removed];
    db.deleteDraft.mockResolvedValue(undefined);
    db.listTabDrafts.mockResolvedValue([survivor]);
    db.restoreDraft.mockResolvedValue(undefined);
    await controller.handleDraftDelete(removed.id);
    const unlisten = controller.history.listen();
    window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }),
    );
    try {
        await vi.waitFor(() => expect(db.restoreDraft).toHaveBeenCalledWith(removed.id), {
            timeout: 100,
        });
    } finally {
        unlisten();
    }
});

describe("draft and tab deletion history", () => {
    function setupDeletion() {
        const survivor = draft("draft-initial", "tab-initial");
        const removed = { ...draft("take", "tab-initial"), branchedFrom: survivor.id };
        const switchToDraft = vi.fn(async (tabId: string, id: string) => {
            currentTabId.set(tabId);
            currentDraftId.set(id);
        });
        const controller = new TabDraftController({
            switchToDraft,
            flushPendingPersist: vi.fn().mockResolvedValue(undefined),
            seedStateJson: vi.fn(),
        });
        controller.tabs = [tab("tab-initial", 0), tab("tab-other", 1)];
        controller.tabDrafts = [survivor, removed];
        db.deleteDraft.mockResolvedValue(undefined);
        db.restoreDraft.mockResolvedValue(undefined);
        db.listTabDrafts.mockResolvedValue([survivor]);
        return { controller, survivor, removed, switchToDraft };
    }

    it("restores a take from the real draft-panel delete button and Cmd-Z", async () => {
        const { controller, survivor, removed } = setupDeletion();
        const shell = document.createElement("div");
        shell.className = "editor-shell";
        document.body.appendChild(shell);
        const unlisten = controller.history.listen();
        try {
            const rendered = render(DraftTreePanel, {
                target: shell,
                props: {
                    drafts: controller.tabDrafts,
                    activeDraftId: survivor.id,
                    ondraftselect: vi.fn(),
                    ondraftiterate: vi.fn(),
                    ondraftbranch: vi.fn(),
                    ondraftrename: vi.fn(),
                    ontogglelock: vi.fn(),
                    ondraftdelete: (id: string) => {
                        void controller.handleDraftDelete(id);
                    },
                },
            });
            const button = rendered.getByRole("button", { name: `Delete ${removed.label}` });
            button.focus();
            await fireEvent.click(button);
            await vi.waitFor(() => expect(controller.tabDrafts).toEqual([survivor]));
            button.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "z",
                    metaKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            );
            await vi.waitFor(() => expect(db.restoreDraft).toHaveBeenCalledWith(removed.id));
        } finally {
            unlisten();
            shell.remove();
        }
    });

    it("switches away before deleting the active draft and supports repeated undo/redo", async () => {
        const { controller, survivor, removed, switchToDraft } = setupDeletion();
        currentDraftId.set(removed.id);
        db.deleteDraft.mockImplementation(async () => {
            expect(get(currentDraftId)).toBe(survivor.id);
        });
        await controller.handleDraftDelete(removed.id);
        expect(switchToDraft).toHaveBeenCalledWith("tab-initial", survivor.id);
        await controller.history.undo();
        expect(db.restoreDraft).toHaveBeenCalledWith(removed.id);
        await controller.history.redo();
        expect(db.deleteDraft).toHaveBeenCalledTimes(2);
        await controller.history.undo();
        expect(db.restoreDraft).toHaveBeenCalledTimes(2);
    });

    it("restores exactly the cascade's returned IDs in parent-first order", async () => {
        const { controller, survivor, removed } = setupDeletion();
        const child = { ...draft("child", "tab-initial"), parentDraftId: removed.id };
        controller.tabDrafts = [survivor, removed, child];
        db.cascadeDeleteDraft.mockResolvedValue([removed.id, child.id]);
        await controller.handleDeleteCascade(removed.id);
        await controller.history.undo();
        expect(db.restoreDraft.mock.calls.map(([id]) => id)).toEqual([removed.id, child.id]);
        await controller.history.redo();
        expect(db.cascadeDeleteDraft).toHaveBeenCalledTimes(2);
    });

    it("restores orphaned children to their original links and refreshes rewrites on redo", async () => {
        const { controller, removed } = setupDeletion();
        const rewrites = [
            { draftId: "iteration", oldParentDraftId: removed.id, oldBranchedFrom: null },
            { draftId: "branch", oldParentDraftId: null, oldBranchedFrom: removed.id },
        ];
        db.orphanAndDeleteDraft.mockResolvedValue(rewrites);
        db.reparentDraft.mockImplementation(async () => {
            expect(db.restoreDraft).toHaveBeenCalledWith(removed.id);
        });
        await controller.handleDeleteOrphan(removed.id);
        await controller.history.undo();
        expect(db.reparentDraft.mock.calls).toEqual([
            ["iteration", removed.id, null],
            ["branch", null, removed.id],
        ]);
        await controller.history.redo();
        expect(db.orphanAndDeleteDraft).toHaveBeenCalledTimes(2);
    });

    it("does not record a rejected deletion", async () => {
        const { controller, removed } = setupDeletion();
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        db.deleteDraft.mockRejectedValueOnce(new Error("locked"));
        await controller.handleDraftDelete(removed.id);
        expect(await controller.history.undo()).toBe(false);
        expect(db.restoreDraft).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("keeps a successful deletion undoable when refreshing its panel fails", async () => {
        const { controller, removed } = setupDeletion();
        db.listTabDrafts.mockRejectedValueOnce(new Error("refresh failed"));
        await controller.handleDraftDelete(removed.id).catch(() => {});
        expect(await controller.history.undo()).toBe(true);
        expect(db.restoreDraft).toHaveBeenCalledWith(removed.id);
    });

    it("does not delete the active draft when switching to its survivor was cancelled", async () => {
        const { controller, removed, switchToDraft } = setupDeletion();
        currentDraftId.set(removed.id);
        switchToDraft.mockImplementationOnce(async () => {});
        await controller.handleDraftDelete(removed.id);
        expect(db.deleteDraft).not.toHaveBeenCalled();
    });

    it("restores multiple deletions in reverse order", async () => {
        const { controller, removed } = setupDeletion();
        await controller.handleDraftDelete(removed.id);
        await controller.handleDraftDelete("another-take");
        await controller.history.undo();
        await controller.history.undo();
        expect(db.restoreDraft.mock.calls.map(([id]) => id)).toEqual(["another-take", removed.id]);
    });

    it("does not delete an active tab when its survivor draft load was cancelled", async () => {
        const { controller, switchToDraft } = setupDeletion();
        db.listTabDrafts.mockResolvedValue([draft("other-draft", "tab-other")]);
        db.getActiveDraft.mockResolvedValue("other-draft");
        switchToDraft.mockImplementationOnce(async () => {});
        await controller.handleTabDelete("tab-initial");
        expect(db.deleteTab).not.toHaveBeenCalled();
    });

    it("does not offer a stale deletion toast after navigating to another document", async () => {
        const { controller, removed } = setupDeletion();
        const { toast } = await import("svelte-sonner");
        const deletion = deferred<void>();
        db.deleteDraft.mockReturnValueOnce(deletion.promise);
        const pending = controller.handleDraftDelete(removed.id);
        await vi.waitFor(() => expect(db.deleteDraft).toHaveBeenCalled());
        currentDocumentId.set("another-document");
        deletion.resolve();
        await pending;
        expect(toast).not.toHaveBeenCalled();
        expect(await controller.history.undo()).toBe(false);
    });

    it("does not retry a successful tab restore when refreshing the tab list fails", async () => {
        const { controller } = setupDeletion();
        db.deleteTab.mockResolvedValue(undefined);
        db.restoreTab.mockResolvedValue(undefined);
        db.listTabs.mockRejectedValueOnce(new Error("refresh failed"));
        await controller.handleTabDelete("tab-other");
        await controller.history.undo();
        expect(await controller.history.undo()).toBe(false);
        expect(db.restoreTab).toHaveBeenCalledOnce();
        await controller.history.redo();
        expect(db.deleteTab).toHaveBeenCalledTimes(2);
    });

    it("also undoes and redoes closing a tab", async () => {
        const { controller } = setupDeletion();
        db.deleteTab.mockResolvedValue(undefined);
        db.restoreTab.mockResolvedValue(undefined);
        db.listTabs.mockResolvedValue(controller.tabs);
        await controller.handleTabDelete("tab-other");
        await controller.history.undo();
        expect(db.restoreTab).toHaveBeenCalledWith("tab-other");
        await controller.history.redo();
        expect(db.deleteTab).toHaveBeenCalledTimes(2);
    });
});
