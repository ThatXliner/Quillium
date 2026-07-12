/**
 * tabDrafts.svelte.ts — Tab & draft-tree state and actions (#160).
 *
 * Owns the tab bar and draft-tree state for the open document plus every
 * user action on them (select/create/rename/reorder/delete tabs; select/
 * iterate/branch/rename/delete/lock drafts, including the orphan-vs-cascade
 * delete prompt and its Undo toasts).
 *
 * Editor.svelte supplies the pieces that belong to the editor lifecycle via
 * constructor deps: switching the live view to a draft, flushing pending
 * persistence, and serializing a draft's state to seed iterations/branches.
 * See docs/tabs-and-drafts.md for the data model.
 */

import {
    branchDraft,
    cascadeDeleteDraft,
    createTab,
    deleteDraft,
    deleteTab,
    getActiveDraft,
    getActiveTab,
    iterateDraft,
    listTabDrafts,
    listTabs,
    orphanAndDeleteDraft,
    renameDraft,
    renameTab,
    reorderTabs,
    reparentDraft,
    restoreDraft,
    restoreTab,
    setActiveTab,
    setDraftLocked,
} from "$lib/db";
import type { DraftMeta, TabMeta } from "$lib/db/types";
import { goToHistory } from "$lib/navigation";
import posthog, { captureException } from "$lib/posthog";
import { currentDocumentId, currentDraftId, currentTabId } from "$lib/stores";
import { toast } from "svelte-sonner";
import { get } from "svelte/store";
import { collectSubtree, hasLiveChildren } from "./draftTree";

export type TabDraftControllerDeps = {
    /** Load a draft of the current document into the live editor view. */
    switchToDraft: (tabId: string, draftId: string) => Promise<void>;
    /** Flush queued events + debounced meta writes before switching context. */
    flushPendingPersist: () => Promise<void>;
    /** Serialize a draft's current state to seed a new draft. */
    seedStateJson: (sourceDraftId: string) => Promise<string>;
};

export class TabDraftController {
    tabs = $state<TabMeta[]>([]);
    tabDrafts = $state<DraftMeta[]>([]);
    forking = $state(false);
    /** Set while the orphan-vs-cascade prompt is open for a draft with children. */
    pendingDelete = $state<{ id: string; label: string; descendants: number } | null>(null);

    readonly #deps: TabDraftControllerDeps;
    /** Latest-wins guard shared by document refreshes and tab selections. */
    #contextGeneration = 0;
    /** Preserve request order for the persisted active-tab pointer. */
    #activeTabWrite: Promise<void> = Promise.resolve();

    constructor(deps: TabDraftControllerDeps) {
        this.#deps = deps;
    }

    lockedOf(draftId: string | null): boolean {
        return this.tabDrafts.find((d) => d.id === draftId)?.locked ?? false;
    }

    #isCurrentContext(generation: number, docId: string): boolean {
        return generation === this.#contextGeneration && get(currentDocumentId) === docId;
    }

    #persistActiveTab(docId: string, tabId: string): Promise<void> {
        const write = this.#activeTabWrite.then(() => setActiveTab(docId, tabId));
        // A failed write is still returned to its caller, but must not poison
        // every later selection queued behind it.
        this.#activeTabWrite = write.catch(() => {});
        return write;
    }

    /**
     * Resolves the active tab + draft for a document, creating a default
     * "Main" tab (with its root draft) for documents that have none yet.
     * Refreshes the local tab/draft-tree state and the currentTabId store.
     */
    async refreshTabState(docId: string): Promise<{ tabId: string; draftId: string } | null> {
        const generation = ++this.#contextGeneration;
        let tabList = await listTabs(docId);
        if (!this.#isCurrentContext(generation, docId)) return null;
        if (tabList.length === 0) {
            tabList = [await createTab(docId, "Main")];
            if (!this.#isCurrentContext(generation, docId)) return null;
        }
        const persistedTab = await getActiveTab(docId);
        if (!this.#isCurrentContext(generation, docId)) return null;
        let activeTab = tabList.find((t) => t.id === persistedTab) ?? tabList[0];

        let drafts = await listTabDrafts(activeTab.id);
        if (!this.#isCurrentContext(generation, docId)) return null;
        if (drafts.length === 0) {
            // Should not happen (createTab seeds a root draft; deleting the
            // last draft of a tab is rejected) — heal with a fresh tab.
            const fresh = await createTab(docId, "Main");
            if (!this.#isCurrentContext(generation, docId)) return null;
            tabList = [...tabList, fresh];
            drafts = await listTabDrafts(fresh.id);
            if (!this.#isCurrentContext(generation, docId)) return null;
            await this.#persistActiveTab(docId, fresh.id);
            if (!this.#isCurrentContext(generation, docId)) return null;
            activeTab = fresh;
        }
        const persistedDraft = await getActiveDraft(activeTab.id);
        if (!this.#isCurrentContext(generation, docId)) return null;
        const activeDraft = drafts.find((d) => d.id === persistedDraft) ?? drafts[0];

        this.tabs = tabList;
        this.tabDrafts = drafts;
        currentTabId.set(activeTab.id);
        return activeDraft ? { tabId: activeTab.id, draftId: activeDraft.id } : null;
    }

    // ── Tab actions ─────────────────────────────────────────────

    async handleTabSelect(tabId: string) {
        const docId = get(currentDocumentId);
        if (!docId) return;
        const generation = ++this.#contextGeneration;
        await this.#deps.flushPendingPersist();
        if (!this.#isCurrentContext(generation, docId)) return;
        // Clicking back to the already-committed tab must still cancel and
        // outlast an in-flight switch to another tab.
        if (tabId === get(currentTabId)) {
            await this.#persistActiveTab(docId, tabId);
            return;
        }
        await this.#persistActiveTab(docId, tabId);
        if (!this.#isCurrentContext(generation, docId)) return;

        const [drafts, persisted] = await Promise.all([
            listTabDrafts(tabId),
            getActiveDraft(tabId),
        ]);
        if (!this.#isCurrentContext(generation, docId)) return;
        this.tabDrafts = drafts;
        const draft = drafts.find((d) => d.id === persisted) ?? drafts[0];
        currentTabId.set(tabId);
        if (draft) await this.#deps.switchToDraft(tabId, draft.id);
        if (!this.#isCurrentContext(generation, docId)) return;
        posthog.capture("tab_switched");
    }

    async handleTabCreate() {
        const docId = get(currentDocumentId);
        if (!docId) return;
        const tab = await createTab(docId, `Tab ${this.tabs.length + 1}`);
        this.tabs = [...this.tabs, tab];
        posthog.capture("tab_created");
        await this.handleTabSelect(tab.id);
    }

    async handleTabRename(tabId: string, label: string) {
        await renameTab(tabId, label).catch(console.error);
        this.tabs = this.tabs.map((t) => (t.id === tabId ? { ...t, label } : t));
        posthog.capture("tab_renamed");
    }

    async handleTabReorder(orderedIds: string[]) {
        const docId = get(currentDocumentId);
        if (!docId) return;
        // Optimistically apply the new order, then persist. If persistence
        // fails, reload from the DB so the bar reflects the true stored order.
        const byId = new Map(this.tabs.map((t) => [t.id, t]));
        this.tabs = orderedIds
            .map((id) => byId.get(id))
            .filter((t): t is TabMeta => t !== undefined);
        try {
            await reorderTabs(docId, orderedIds);
            posthog.capture("tab_reordered");
        } catch (e) {
            console.error("[Editor] reorder tabs failed", e);
            this.tabs = await listTabs(docId);
        }
    }

    async handleTabDelete(tabId: string) {
        if (this.tabs.length <= 1) return;
        const tab = this.tabs.find((t) => t.id === tabId);
        await this.#deps.flushPendingPersist();
        try {
            await deleteTab(tabId);
        } catch (e) {
            console.error("[Editor] delete tab failed", e);
            return;
        }
        const idx = this.tabs.findIndex((t) => t.id === tabId);
        this.tabs = this.tabs.filter((t) => t.id !== tabId);
        posthog.capture("tab_deleted");
        if (get(currentTabId) === tabId) {
            const next = this.tabs[Math.min(Math.max(idx, 0), this.tabs.length - 1)];
            currentTabId.set(null); // force handleTabSelect to run for the neighbour
            if (next) await this.handleTabSelect(next.id);
        }
        // Soft delete: the tab and all its drafts survive in the DB and can
        // come back from here or from the document's version history.
        toast(`Deleted tab “${tab?.label ?? "Tab"}”`, {
            duration: 8000,
            action: {
                label: "Undo",
                onClick: async () => {
                    await restoreTab(tabId).catch(console.error);
                    const docId = get(currentDocumentId);
                    if (docId) this.tabs = await listTabs(docId);
                    posthog.capture("tab_restored");
                },
            },
            cancel: {
                label: "View in history",
                onClick: () => {
                    posthog.capture("delete_toast_view_history", { kind: "tab" });
                    goToHistory().catch(console.error);
                },
            },
        });
    }

    // ── Draft actions ───────────────────────────────────────────

    async handleDraftSelect(draftId: string) {
        if (draftId === get(currentDraftId)) return;
        const tabId = get(currentTabId);
        if (!tabId) return;
        await this.#deps.switchToDraft(tabId, draftId);
        posthog.capture("draft_switched");
    }

    /**
     * Iterate (the common verb): the next version in `sourceId`'s run, seeded
     * from its state. Renders flat; the source locks (superseded), the new tip
     * stays editable.
     */
    async handleDraftIterate(sourceId: string) {
        const tabId = get(currentTabId);
        if (!tabId || this.forking) return;
        this.forking = true;
        try {
            await this.#deps.flushPendingPersist();
            const stateJson = await this.#deps.seedStateJson(sourceId);
            const next = await iterateDraft(sourceId, `v${this.tabDrafts.length}`, stateJson);
            this.tabDrafts = await listTabDrafts(tabId);
            posthog.capture("draft_iterated");
            await this.#deps.switchToDraft(tabId, next.id);
        } catch (e) {
            console.error("[Editor] iterate draft failed", e);
            captureException(e);
        } finally {
            this.forking = false;
        }
    }

    /**
     * Branch (the rare verb): a different take off `sourceId`, seeded from its
     * state. Renders indented; nothing locks — source and branch are parallel
     * live explorations.
     */
    async handleDraftBranch(sourceId: string) {
        const tabId = get(currentTabId);
        if (!tabId || this.forking) return;
        this.forking = true;
        try {
            await this.#deps.flushPendingPersist();
            const stateJson = await this.#deps.seedStateJson(sourceId);
            const branch = await branchDraft(sourceId, "new take", stateJson);
            this.tabDrafts = await listTabDrafts(tabId);
            posthog.capture("draft_branched");
            await this.#deps.switchToDraft(tabId, branch.id);
        } catch (e) {
            console.error("[Editor] branch draft failed", e);
            captureException(e);
        } finally {
            this.forking = false;
        }
    }

    async handleDraftRename(draftId: string, label: string) {
        await renameDraft(draftId, label).catch(console.error);
        this.tabDrafts = this.tabDrafts.map((d) => (d.id === draftId ? { ...d, label } : d));
    }

    async handleDraftDelete(draftId: string) {
        // A childless draft deletes straight away; one with children prompts for
        // orphan vs cascade (the modal then calls the matching handler).
        if (!hasLiveChildren(draftId, this.tabDrafts)) {
            await this.#performDraftDelete(draftId, [draftId], "leaf");
            return;
        }
        const draft = this.tabDrafts.find((d) => d.id === draftId);
        const descendants = collectSubtree(draftId, this.tabDrafts).length - 1;
        this.pendingDelete = { id: draftId, label: draft?.label ?? "draft", descendants };
    }

    /**
     * Switches the editor off `doomed` (the ids about to be soft-deleted) when
     * the open draft is among them, landing on a surviving draft so the editor
     * never points at a hidden one. Returns false if there's no survivor to
     * land on (shouldn't happen — the backend refuses emptying a tab — but
     * guards anyway).
     */
    async #ensureEditorOffDeleted(doomed: string[]): Promise<boolean> {
        if (!doomed.includes(get(currentDraftId) ?? "")) {
            await this.#deps.flushPendingPersist();
            return true;
        }
        const doomedSet = new Set(doomed);
        const survivor = this.tabDrafts.find((d) => !doomedSet.has(d.id));
        if (!survivor) return false;
        const tabId = get(currentTabId);
        if (!tabId) return false;
        await this.#deps.switchToDraft(tabId, survivor.id);
        return true;
    }

    /** Soft-deletes a childless draft (or its subtree root) and offers Undo. */
    async #performDraftDelete(draftId: string, doomed: string[], mode: "leaf" | "cascade") {
        const draft = this.tabDrafts.find((d) => d.id === draftId);
        if (!(await this.#ensureEditorOffDeleted(doomed))) return;
        try {
            if (mode === "cascade") {
                await cascadeDeleteDraft(draftId);
            } else {
                await deleteDraft(draftId);
            }
        } catch (e) {
            console.error("[Editor] delete draft failed", e);
            return;
        }
        await this.refreshDraftsAndCurrentLock();
        posthog.capture("draft_deleted", { mode });
        // Soft delete: each draft's text and history survive in the DB, so Undo
        // restores the whole set (root + any cascaded descendants).
        toast(`Deleted draft “${draft?.label ?? "draft"}”`, {
            duration: 8000,
            action: {
                label: "Undo",
                onClick: async () => {
                    // Restore parents before children so links land on live rows.
                    for (const id of doomed) {
                        await restoreDraft(id).catch(console.error);
                    }
                    await this.refreshDraftsAndCurrentLock();
                    posthog.capture("draft_restored");
                },
            },
        });
    }

    /** Cascade branch of the delete prompt: remove the draft and its whole subtree. */
    async handleDeleteCascade(draftId: string) {
        this.pendingDelete = null;
        const doomed = collectSubtree(draftId, this.tabDrafts);
        await this.#performDraftDelete(draftId, doomed, "cascade");
    }

    /** Orphan branch of the delete prompt: keep the children, re-attaching them. */
    async handleDeleteOrphan(draftId: string) {
        this.pendingDelete = null;
        const draft = this.tabDrafts.find((d) => d.id === draftId);
        // Only the draft itself vanishes; its children survive re-attached.
        if (!(await this.#ensureEditorOffDeleted([draftId]))) return;
        let rewrites: Awaited<ReturnType<typeof orphanAndDeleteDraft>>;
        try {
            rewrites = await orphanAndDeleteDraft(draftId);
        } catch (e) {
            console.error("[Editor] orphan-delete draft failed", e);
            return;
        }
        await this.refreshDraftsAndCurrentLock();
        posthog.capture("draft_deleted", { mode: "orphan" });
        toast(`Deleted draft “${draft?.label ?? "draft"}”`, {
            duration: 8000,
            action: {
                label: "Undo",
                onClick: async () => {
                    // Restore the parent first, then re-point each moved child back
                    // at it (reversing the orphan rewrite).
                    await restoreDraft(draftId).catch(console.error);
                    for (const r of rewrites) {
                        await reparentDraft(r.draftId, r.oldParentDraftId, r.oldBranchedFrom).catch(
                            console.error,
                        );
                    }
                    await this.refreshDraftsAndCurrentLock();
                    posthog.capture("draft_restored");
                },
            },
            cancel: {
                label: "View in history",
                onClick: () => {
                    posthog.capture("delete_toast_view_history", { kind: "draft" });
                    goToHistory().catch(console.error);
                },
            },
        });
    }

    /**
     * Re-reads the active tab's drafts and rebuilds the editor state when the
     * open draft's lock changed underneath it.
     */
    async refreshDraftsAndCurrentLock() {
        const tabId = get(currentTabId);
        if (!tabId) return;
        const current = get(currentDraftId);
        const wasLocked = this.lockedOf(current);
        this.tabDrafts = await listTabDrafts(tabId);
        const nowLocked = this.lockedOf(current);
        if (current && nowLocked !== wasLocked) {
            await this.#deps.switchToDraft(tabId, current);
        }
    }

    /** Toggles the soft lock and rebuilds the editor state's read-only flag. */
    async handleDraftToggleLock(draftId: string, locked: boolean) {
        await setDraftLocked(draftId, locked).catch(console.error);
        this.tabDrafts = this.tabDrafts.map((d) => (d.id === draftId ? { ...d, locked } : d));
        posthog.capture(locked ? "draft_locked" : "draft_unlocked");
        if (draftId === get(currentDraftId)) {
            const tabId = get(currentTabId);
            if (tabId) await this.#deps.switchToDraft(tabId, draftId);
        }
    }
}
