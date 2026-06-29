/**
 * QuilliumPage — Page object encapsulating all Quillium E2E interactions.
 *
 * Provides a fluent, composable API so test bodies stay declarative.
 * All raw Playwright selectors live here; tests should never reach for
 * `page.locator(...)` directly.
 */

import { type Locator, type Page, expect } from "@playwright/test";

// ── Tauri mock configuration ────────────────────────────────────────────────

export type MockSnapshot = {
    id: number;
    draftId: string;
    upToEventId: number;
    createdAt: number;
    label: string | null;
    /** The plain-text doc content stored in this snapshot. */
    doc: string;
};

export type MockDocEvent = {
    id: number;
    documentId: string;
    eventType: string;
    payload: string;
    createdAt: number;
};

export type TauriMockOptions = {
    /** Return value for `get_api_key`. null = no key configured. */
    apiKey: string | null;
    /** When false, the tutorial overlay appears on load. */
    skipTutorial: boolean;
    /** Merged into localStorage `quillium-app-settings`. */
    settings: Record<string, unknown>;
    /**
     * Pre-loaded document text.  When set, cmd_load_document_state returns
     * a snapshot so the editor opens with content.
     */
    initialDoc: string | null;
    /**
     * Pre-seeded version history snapshots returned by cmd_list_snapshots.
     * cmd_load_snapshot_state returns a minimal state blob from each snapshot's doc.
     */
    snapshots: MockSnapshot[];
    /** Pre-seeded document activity records returned by cmd_list_doc_events. */
    docEvents: MockDocEvent[];
};

const DEFAULT_OPTIONS: TauriMockOptions = {
    apiKey: null,
    skipTutorial: true,
    settings: {
        showNestedEditor: true,
        atomicRevisions: true,
        aiEnabled: true,
        autoVersionOnRevisionCreate: false,
    },
    initialDoc: null,
    snapshots: [],
    docEvents: [],
};

// ── Page object ─────────────────────────────────────────────────────────────

export class QuilliumPage {
    readonly page: Page;
    readonly options: TauriMockOptions;

    // Stable locators (lazy, cached on first access)
    get editor(): Locator {
        return this.page.locator("#editor-document .cm-content");
    }
    get statusBar(): Locator {
        return this.page.locator("#status-bar");
    }
    get wordCountOverlay(): Locator {
        return this.page.getByRole("button", { name: /Word count/ });
    }
    get inlineEditor(): Locator {
        return this.page.locator(".revision-inline-editor .cm-content").first();
    }
    get modalEditor(): Locator {
        return this.page.locator("dialog[open] .revision-modal-editor .cm-content").first();
    }
    get aiSidebar(): Locator {
        return this.page.locator("#ai-sidebar");
    }
    get annotationCards(): Locator {
        return this.page.locator(".annotation-card");
    }
    get modalAnnotationCards(): Locator {
        return this.page.locator("dialog[open] .annotation-card-inline");
    }

    constructor(page: Page, options: Partial<TauriMockOptions> = {}) {
        this.page = page;
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options,
            settings: {
                ...DEFAULT_OPTIONS.settings,
                ...(options.settings ?? {}),
            },
        };
    }

    // ── Setup ───────────────────────────────────────────────────────────

    /** Install Tauri mock and configure localStorage settings. */
    async setup(): Promise<void> {
        const opts = this.options;
        await this.page.addInitScript(
            (payload: {
                apiKey: string | null;
                skipTutorial: boolean;
                settings: Record<string, unknown>;
                initialDoc: string | null;
                snapshots: MockSnapshot[];
                docEvents: MockDocEvent[];
            }) => {
                if (payload.skipTutorial) {
                    localStorage.setItem("quillium_tutorial_seen", "1");
                    localStorage.setItem("quillium_beta_accepted", "true");
                    localStorage.setItem("quillium_changelog_seen", "999.999");
                }
                if (Object.keys(payload.settings).length > 0) {
                    localStorage.setItem("quillium-app-settings", JSON.stringify(payload.settings));
                }
                if (payload.apiKey) {
                    localStorage.setItem("quillium-has-api-key", "1");
                }

                let nextCallbackId = 1;
                const callbacks = new Map<number, (...args: unknown[]) => unknown>();
                const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

                // ── Stateful tabs & draft-tree mock (#160) ──────────────
                type MockTab = {
                    id: string;
                    documentId: string;
                    tabType: string;
                    label: string;
                    position: number;
                    createdAt: number;
                    deletedAt: number | null;
                };
                type MockDraft = {
                    id: string;
                    documentId: string;
                    label: string;
                    createdAt: number;
                    isActive: boolean;
                    tabId: string | null;
                    parentDraftId: string | null;
                    branchedFrom: string | null;
                    locked: boolean;
                    deletedAt: number | null;
                };
                let nextTabIndex = 2;
                let nextDraftIndex = 2;
                const tabs: MockTab[] = [
                    {
                        id: "tab-test-1",
                        documentId: "doc-test-1",
                        tabType: "draft",
                        label: "Main",
                        position: 0,
                        createdAt: 0,
                        deletedAt: null,
                    },
                ];
                const drafts: MockDraft[] = [
                    {
                        id: "draft-test-1",
                        documentId: "doc-test-1",
                        label: "main",
                        createdAt: 0,
                        isActive: true,
                        tabId: "tab-test-1",
                        parentDraftId: null,
                        branchedFrom: null,
                        locked: false,
                        deletedAt: null,
                    },
                ];
                const activeTabByDoc: Record<string, string> = {};
                const activeDraftByTab: Record<string, string> = {};

                (window as unknown as Record<string, unknown>).__TAURI_MOCK__ = { invokeCalls };

                (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
                    metadata: {
                        currentWindow: { label: "main" },
                        currentWebview: { label: "main", windowLabel: "main" },
                    },
                    invoke: async (cmd: string, args: unknown) => {
                        invokeCalls.push({ cmd, args });

                        if (cmd === "cmd_list_documents")
                            return [
                                {
                                    id: "doc-test-1",
                                    title: "Untitled",
                                    createdAt: 0,
                                    updatedAt: 0,
                                    wordCount: 0,
                                    previewText: "",
                                    tags: "[]",
                                },
                            ];
                        if (cmd === "cmd_create_document") return "doc-test-1";
                        if (cmd === "cmd_create_draft") return "draft-test-1";
                        if (cmd === "cmd_list_drafts") {
                            const a = args as { docId: string };
                            return drafts.filter((d) => d.documentId === a.docId && !d.deletedAt);
                        }

                        // ── Tabs & draft tree (#160) ────────────────────
                        if (cmd === "cmd_list_tabs") {
                            const a = args as { docId: string };
                            return tabs.filter((t) => t.documentId === a.docId && !t.deletedAt);
                        }
                        if (cmd === "cmd_create_tab") {
                            const a = args as { docId: string; label: string };
                            const tab: MockTab = {
                                id: `tab-test-${nextTabIndex++}`,
                                documentId: a.docId,
                                tabType: "draft",
                                label: a.label,
                                position: tabs.length,
                                createdAt: Date.now(),
                                deletedAt: null,
                            };
                            tabs.push(tab);
                            drafts.push({
                                id: `draft-test-${nextDraftIndex++}`,
                                documentId: a.docId,
                                label: "main",
                                createdAt: Date.now(),
                                isActive: true,
                                tabId: tab.id,
                                parentDraftId: null,
                                branchedFrom: null,
                                locked: false,
                                deletedAt: null,
                            });
                            return tab;
                        }
                        if (cmd === "cmd_rename_tab") {
                            const a = args as { tabId: string; label: string };
                            const tab = tabs.find((t) => t.id === a.tabId);
                            if (tab) tab.label = a.label;
                            return null;
                        }
                        if (cmd === "cmd_delete_tab") {
                            const a = args as { tabId: string };
                            const tab = tabs.find((t) => t.id === a.tabId);
                            if (tab) tab.deletedAt = Date.now();
                            return null;
                        }
                        if (cmd === "cmd_restore_tab") {
                            const a = args as { tabId: string };
                            const tab = tabs.find((t) => t.id === a.tabId);
                            if (tab) tab.deletedAt = null;
                            return null;
                        }
                        if (cmd === "cmd_list_doc_events") return payload.docEvents;
                        if (cmd === "cmd_get_active_tab") {
                            const a = args as { docId: string };
                            return activeTabByDoc[a.docId] ?? null;
                        }
                        if (cmd === "cmd_set_active_tab") {
                            const a = args as { docId: string; tabId: string };
                            activeTabByDoc[a.docId] = a.tabId;
                            return null;
                        }
                        if (cmd === "cmd_list_tab_drafts") {
                            const a = args as { tabId: string };
                            return drafts.filter((d) => d.tabId === a.tabId && !d.deletedAt);
                        }
                        if (cmd === "cmd_get_active_draft") {
                            const a = args as { tabId: string };
                            return activeDraftByTab[a.tabId] ?? null;
                        }
                        if (cmd === "cmd_set_active_draft") {
                            const a = args as { tabId: string; draftId: string };
                            activeDraftByTab[a.tabId] = a.draftId;
                            return null;
                        }
                        if (cmd === "cmd_iterate_draft") {
                            const a = args as { sourceDraftId: string; label: string };
                            const source = drafts.find((d) => d.id === a.sourceDraftId);
                            // Iterating locks the source (superseded); the new
                            // draft becomes the run's editable tip.
                            if (source) source.locked = true;
                            const next: MockDraft = {
                                id: `draft-test-${nextDraftIndex++}`,
                                documentId: source?.documentId ?? "doc-test-1",
                                label: a.label,
                                createdAt: Date.now(),
                                isActive: true,
                                tabId: source?.tabId ?? null,
                                parentDraftId: a.sourceDraftId,
                                branchedFrom: null,
                                locked: false,
                                deletedAt: null,
                            };
                            drafts.push(next);
                            return next;
                        }
                        if (cmd === "cmd_branch_draft") {
                            const a = args as { sourceDraftId: string; label: string };
                            const source = drafts.find((d) => d.id === a.sourceDraftId);
                            const branch: MockDraft = {
                                id: `draft-test-${nextDraftIndex++}`,
                                documentId: source?.documentId ?? "doc-test-1",
                                label: a.label,
                                createdAt: Date.now(),
                                isActive: true,
                                tabId: source?.tabId ?? null,
                                parentDraftId: null,
                                branchedFrom: a.sourceDraftId,
                                locked: false,
                                deletedAt: null,
                            };
                            drafts.push(branch);
                            return branch;
                        }
                        if (cmd === "cmd_rename_draft") {
                            const a = args as { draftId: string; label: string };
                            const draft = drafts.find((d) => d.id === a.draftId);
                            if (draft) draft.label = a.label;
                            return null;
                        }
                        if (cmd === "cmd_set_draft_locked") {
                            const a = args as { draftId: string; locked: boolean };
                            const draft = drafts.find((d) => d.id === a.draftId);
                            if (draft) draft.locked = a.locked;
                            return null;
                        }
                        // Relock the run that `seed` belongs to: lock all live
                        // members except the newest (the editable tip).
                        const relockRun = (seed: MockDraft) => {
                            let head = seed;
                            while (head.parentDraftId) {
                                const p = drafts.find((x) => x.id === head.parentDraftId);
                                if (!p) break;
                                head = p;
                            }
                            const run: MockDraft[] = [];
                            let cur: MockDraft | undefined = head;
                            while (cur) {
                                if (!cur.deletedAt) run.push(cur);
                                const c: MockDraft | undefined = cur;
                                cur = drafts.find((x) => x.parentDraftId === c.id && !x.deletedAt);
                            }
                            if (run.length === 0) return;
                            const tip = run.reduce(
                                (a2, b) => (b.createdAt >= a2.createdAt ? b : a2),
                                run[0],
                            );
                            for (const m of run) m.locked = m.id !== tip?.id;
                        };
                        if (cmd === "cmd_delete_draft" || cmd === "cmd_restore_draft") {
                            const a = args as { draftId: string };
                            const draft = drafts.find((d) => d.id === a.draftId);
                            if (!draft) return null;
                            if (
                                cmd === "cmd_delete_draft" &&
                                draft.parentDraftId == null &&
                                draft.branchedFrom == null
                            ) {
                                throw new Error("Cannot delete the storyline root draft");
                            }
                            draft.deletedAt = cmd === "cmd_delete_draft" ? Date.now() : null;
                            relockRun(draft);
                            return null;
                        }
                        if (cmd === "cmd_orphan_and_delete_draft") {
                            const a = args as { draftId: string };
                            const draft = drafts.find((d) => d.id === a.draftId);
                            if (!draft) return [];
                            if (draft.parentDraftId == null && draft.branchedFrom == null) {
                                throw new Error("Cannot delete the storyline root draft");
                            }
                            const rewrites: {
                                draftId: string;
                                oldParentDraftId: string | null;
                                oldBranchedFrom: string | null;
                            }[] = [];
                            const children = drafts.filter(
                                (d) =>
                                    !d.deletedAt &&
                                    (d.parentDraftId === draft.id || d.branchedFrom === draft.id),
                            );
                            const reattachAnchor = draft.parentDraftId ?? draft.branchedFrom;
                            for (const c of children) {
                                rewrites.push({
                                    draftId: c.id,
                                    oldParentDraftId: c.parentDraftId,
                                    oldBranchedFrom: c.branchedFrom,
                                });
                                if (c.branchedFrom === draft.id) {
                                    // Branch child re-points to D's anchor.
                                    c.branchedFrom = reattachAnchor;
                                    c.parentDraftId = null;
                                } else {
                                    // Iteration child splices D out of the run;
                                    // if D was a branch root, the child becomes
                                    // the new branch root off D's source.
                                    c.parentDraftId = draft.parentDraftId;
                                    c.branchedFrom =
                                        draft.parentDraftId == null ? draft.branchedFrom : null;
                                }
                            }
                            draft.deletedAt = Date.now();
                            for (const c of children) relockRun(c);
                            return rewrites;
                        }
                        if (cmd === "cmd_cascade_delete_draft") {
                            const a = args as { draftId: string };
                            const root = drafts.find((d) => d.id === a.draftId);
                            if (!root) return [];
                            if (root.parentDraftId == null && root.branchedFrom == null) {
                                throw new Error("Cannot delete the storyline root draft");
                            }
                            const subtree: string[] = [];
                            const queue = [root.id];
                            const seen = new Set([root.id]);
                            while (queue.length > 0) {
                                const id = queue.shift()!;
                                subtree.push(id);
                                for (const child of drafts) {
                                    if (
                                        child.deletedAt ||
                                        seen.has(child.id) ||
                                        (child.parentDraftId !== id && child.branchedFrom !== id)
                                    ) {
                                        continue;
                                    }
                                    seen.add(child.id);
                                    queue.push(child.id);
                                }
                            }
                            const now = Date.now();
                            for (const id of subtree) {
                                const d = drafts.find((x) => x.id === id);
                                if (d) d.deletedAt = now;
                            }
                            if (root.parentDraftId) {
                                const parent = drafts.find((x) => x.id === root.parentDraftId);
                                if (parent) relockRun(parent);
                            }
                            return subtree;
                        }
                        if (cmd === "cmd_reparent_draft") {
                            const a = args as {
                                draftId: string;
                                parentDraftId: string | null;
                                branchedFrom: string | null;
                            };
                            const draft = drafts.find((d) => d.id === a.draftId);
                            if (!draft) return null;
                            draft.parentDraftId = a.parentDraftId;
                            draft.branchedFrom = a.branchedFrom;
                            relockRun(draft);
                            return null;
                        }

                        if (cmd === "cmd_load_document_state") {
                            if (payload.initialDoc) {
                                return {
                                    snapshotStateJson: JSON.stringify({
                                        doc: payload.initialDoc,
                                        selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
                                        annotations: {},
                                    }),
                                    snapshotEventId: 0,
                                    eventsSince: [],
                                };
                            }
                            return {
                                snapshotStateJson: null,
                                snapshotEventId: -1,
                                eventsSince: [],
                            };
                        }

                        if (cmd === "cmd_append_event") return { eventId: 1, needsSnapshot: false };
                        if (cmd === "cmd_create_snapshot") return null;
                        if (cmd === "cmd_update_document_meta") return null;
                        if (cmd === "get_api_key") return payload.apiKey;

                        // Version history
                        if (cmd === "cmd_list_snapshots")
                            return payload.snapshots.map((s) => ({
                                id: s.id,
                                draftId: s.draftId,
                                upToEventId: s.upToEventId,
                                createdAt: s.createdAt,
                                label: s.label,
                            }));
                        if (cmd === "cmd_load_snapshot_state") {
                            const a = args as { snapshotId: number };
                            const snap = payload.snapshots.find((s) => s.id === a.snapshotId);
                            if (!snap) return null;
                            return JSON.stringify({
                                doc: snap.doc,
                                selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
                            });
                        }
                        if (cmd === "cmd_label_snapshot") {
                            const a = args as { snapshotId: number; label: string };
                            const snap = payload.snapshots.find((s) => s.id === a.snapshotId);
                            if (snap) snap.label = a.label;
                            return null;
                        }
                        if (cmd === "cmd_restore_to_snapshot") return null;
                        if (cmd === "cmd_get_snapshot_storage_size") {
                            // Return sum of state_json byte lengths for mock snapshots
                            return payload.snapshots.reduce(
                                (sum, s) =>
                                    sum + JSON.stringify({ doc: s.doc, annotations: {} }).length,
                                0,
                            );
                        }
                        if (cmd === "cmd_prune_snapshots_keep_last_n") {
                            const a = args as { draftId: string; keepN: number };
                            const unlabeled = payload.snapshots
                                .filter((s) => s.draftId === a.draftId && s.label === null)
                                .sort((x, y) => y.createdAt - x.createdAt);
                            const toDelete = unlabeled.slice(a.keepN);
                            const deleteIds = new Set(toDelete.map((s) => s.id));
                            const before = payload.snapshots.length;
                            payload.snapshots = payload.snapshots.filter(
                                (s) => !deleteIds.has(s.id),
                            );
                            return before - payload.snapshots.length;
                        }
                        if (cmd === "cmd_prune_snapshots_older_than") {
                            const a = args as { draftId: string; olderThanDays: number };
                            const cutoff = Date.now() - a.olderThanDays * 86_400_000;
                            const before = payload.snapshots.length;
                            payload.snapshots = payload.snapshots.filter(
                                (s) => s.label !== null || s.createdAt >= cutoff,
                            );
                            return before - payload.snapshots.length;
                        }
                        if (cmd === "cmd_create_named_snapshot") {
                            const a = args as { label: string; upToEventId: number };
                            const newId = payload.snapshots.length + 100;
                            payload.snapshots.unshift({
                                id: newId,
                                draftId: "draft-test-1",
                                upToEventId: a.upToEventId,
                                createdAt: Date.now(),
                                label: a.label,
                                doc: "",
                            });
                            return newId;
                        }

                        // Tauri event plumbing
                        if (cmd === "plugin:event|listen") return 1;
                        if (cmd === "plugin:event|unlisten") return null;

                        return null;
                    },
                    transformCallback: (callback: (...args: unknown[]) => unknown) => {
                        const id = nextCallbackId++;
                        callbacks.set(id, callback);
                        return id;
                    },
                    unregisterCallback: (id: number) => {
                        callbacks.delete(id);
                    },
                    convertFileSrc: (filePath: string) => filePath,
                };

                (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
                    unregisterListener: () => {},
                };
            },
            {
                apiKey: opts.apiKey,
                skipTutorial: opts.skipTutorial,
                settings: opts.settings,
                initialDoc: opts.initialDoc,
                snapshots: opts.snapshots,
                docEvents: opts.docEvents,
            },
        );
    }

    /** Navigate to "/" and wait for the editor to render. */
    async goto(): Promise<void> {
        await this.page.goto("/");
        await expect(this.editor).toBeVisible({ timeout: 40_000 });
    }

    /** setup() + goto() — the common two-liner for most tests. */
    async init(): Promise<void> {
        await this.setup();
        await this.goto();
    }

    /** Navigate to "/history" and wait for the history page to render. */
    async gotoHistory(): Promise<void> {
        await this.page.goto("/history");
        await expect(this.page.getByText("Version History")).toBeVisible({ timeout: 10_000 });
    }

    /** setup() + gotoHistory() */
    async initHistory(): Promise<void> {
        await this.setup();
        await this.gotoHistory();
    }

    /** Click the History button in the status bar to navigate to /history. */
    async openHistoryFromStatusBar(): Promise<void> {
        await this.page.locator("#status-bar button[aria-label='Version history']").click();
        await expect(this.page.getByText("Version History")).toBeVisible({ timeout: 10_000 });
    }

    // ── Tauri mock introspection ────────────────────────────────────────

    /** Return all Tauri IPC command names invoked so far. */
    async getInvokedCommands(): Promise<string[]> {
        return this.page.evaluate(() =>
            (
                window as unknown as {
                    __TAURI_MOCK__: {
                        invokeCalls: Array<{ cmd: string }>;
                    };
                }
            ).__TAURI_MOCK__.invokeCalls.map((x) => x.cmd),
        );
    }

    /** Count how many times a specific Tauri command was invoked. */
    async countInvocations(cmd: string): Promise<number> {
        return this.page.evaluate(
            (c) =>
                (
                    window as unknown as {
                        __TAURI_MOCK__: {
                            invokeCalls: Array<{ cmd: string }>;
                        };
                    }
                ).__TAURI_MOCK__.invokeCalls.filter((x) => x.cmd === c).length,
            cmd,
        );
    }

    // ── Editor text ─────────────────────────────────────────────────────

    /** Read the text content of a CodeMirror `.cm-content` element. */
    async cmText(locator?: Locator): Promise<string> {
        const target = locator ?? this.editor;
        return target.evaluate((el) => {
            const lines = el.querySelectorAll(".cm-line");
            if (lines.length > 0) {
                return Array.from(lines)
                    .map((l) => l.textContent ?? "")
                    .join("\n");
            }
            return el.textContent ?? "";
        });
    }

    /** Assert main editor text equals `expected`. Polls until stable. */
    async expectEditorText(expected: string): Promise<void> {
        await expect.poll(() => this.cmText()).toBe(expected);
    }

    /** Assert inline nested editor text. */
    async expectInlineText(expected: string): Promise<void> {
        await expect(this.inlineEditor).toBeVisible({ timeout: 8_000 });
        await expect.poll(() => this.cmText(this.inlineEditor)).toBe(expected);
    }

    /** Assert modal editor text. */
    async expectModalText(expected: string): Promise<void> {
        await expect(this.modalEditor).toBeVisible({ timeout: 8_000 });
        await expect.poll(() => this.cmText(this.modalEditor)).toBe(expected);
    }

    // ── Typing ──────────────────────────────────────────────────────────

    /** Focus the main editor and replace all text with `text`. */
    async typeInEditor(text: string): Promise<void> {
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
            await expect(this.editor).toBeVisible({ timeout: 10_000 });
            await this.editor.click();
            await this.selectAll();
            await this.page.keyboard.type(text);
            try {
                await expect.poll(() => this.cmText(), { timeout: 10_000 }).toBe(text);
                return;
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    }

    /** Type into a specific CodeMirror editor locator. */
    async typeIn(locator: Locator, text: string): Promise<void> {
        await locator.click();
        await this.page.keyboard.type(text);
    }

    /** Type at a specific character offset (0-based) in the editor. */
    async typeAtOffset(offset: number, text: string): Promise<void> {
        await this.editor.click();
        await this.page.keyboard.press("Home");
        await this.moveCursorRight(offset);
        await this.page.keyboard.type(text);
    }

    // ── Cursor & selection ──────────────────────────────────────────────

    /** Press key N times. */
    async pressRepeat(key: string, count: number): Promise<void> {
        for (let i = 0; i < count; i++) {
            await this.page.keyboard.press(key);
        }
    }

    async moveCursorRight(n: number): Promise<void> {
        await this.pressRepeat("ArrowRight", n);
    }

    async moveCursorLeft(n: number): Promise<void> {
        await this.pressRepeat("ArrowLeft", n);
    }

    /** Select N characters to the right from the current cursor. */
    async selectRight(n: number): Promise<void> {
        await this.pressRepeat("Shift+ArrowRight", n);
    }

    /** Select N characters to the left from the current cursor. */
    async selectLeft(n: number): Promise<void> {
        await this.pressRepeat("Shift+ArrowLeft", n);
    }

    async selectAll(): Promise<void> {
        await this.page.keyboard.press("ControlOrMeta+a");
    }

    async home(): Promise<void> {
        await this.page.keyboard.press("Home");
    }

    async end(): Promise<void> {
        await this.page.keyboard.press("End");
    }

    /** Select a range of text by character offsets in the main editor. */
    async selectRange(from: number, to: number): Promise<void> {
        await this.editor.click();
        await this.home();
        await this.moveCursorRight(from);
        await this.selectRight(to - from);
    }

    // ── Keyboard shortcuts ──────────────────────────────────────────────

    async undo(): Promise<void> {
        await this.page.keyboard.press("Control+z");
    }

    async redo(): Promise<void> {
        await this.page.keyboard.press("Control+y");
    }

    async backspace(n = 1): Promise<void> {
        await this.pressRepeat("Backspace", n);
    }

    async createComment(): Promise<void> {
        await this.page.keyboard.press("Control+Alt+m");
    }

    async createRevision(): Promise<void> {
        await this.page.keyboard.press("Control+Alt+k");
    }

    async newVersion(): Promise<void> {
        await this.page.keyboard.press("ControlOrMeta+Shift+v");
    }

    async replyToAnnotation(): Promise<void> {
        await this.page.keyboard.press("ControlOrMeta+/");
    }

    async openDictionary(): Promise<void> {
        await this.page.keyboard.press("Control+d");
    }

    async sendReply(): Promise<void> {
        await this.page.keyboard.press("ControlOrMeta+Enter");
    }

    async escape(): Promise<void> {
        await this.page.keyboard.press("Escape");
    }

    // ── Compound actions ────────────────────────────────────────────────

    /**
     * Type text, select a range within it, and create a revision.
     * Returns the text that was selected for the revision.
     */
    async createRevisionOnRange(fullText: string, from: number, to: number): Promise<string> {
        await this.typeInEditor(fullText);
        const selectedText = fullText.slice(from, to);
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
            await this.selectRange(from, to);
            await this.createRevision();
            try {
                await expect(this.page.locator("[data-revision-id]").first()).toBeVisible({
                    timeout: attempt === 0 ? 5_000 : 10_000,
                });
                return selectedText;
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    }

    /** Create a revision spanning all text and return it. */
    async createFullRevision(text: string): Promise<string> {
        return this.createRevisionOnRange(text, 0, text.length);
    }

    /**
     * Create a revision and open its modal editor. Returns the modal
     * editor locator.
     */
    async createRevisionAndOpenModal(text: string): Promise<Locator> {
        await this.createFullRevision(text);
        return this.openRevisionModal();
    }

    /** Open the revision modal via the expand button. */
    async openRevisionModal(): Promise<Locator> {
        const expand = this.page.locator("[data-tutorial-action='expand-revision-modal']").first();
        if (await expand.isVisible({ timeout: 4_000 }).catch(() => false)) {
            await expand.dispatchEvent("click");
        }
        await expect(this.modalEditor).toBeVisible({ timeout: 8_000 });
        return this.modalEditor;
    }

    /** Type text, select a range, and create a comment. */
    async createCommentOnRange(fullText: string, from: number, to: number): Promise<void> {
        await this.typeInEditor(fullText);
        await this.selectRange(from, to);
        await this.createComment();
    }

    /**
     * Submit comment text in the pre-comment composer.
     * Assumes the comment textarea is visible.
     */
    async submitComment(text: string): Promise<void> {
        const textarea = this.page.locator("textarea[placeholder='Add a comment…']");
        await expect(textarea).toBeVisible({ timeout: 5_000 });
        await textarea.fill(text);
        await this.sendReply();
        await expect(textarea).toBeHidden({ timeout: 5_000 });
    }

    /** Wait for a separate undo group (history newGroupDelay). */
    async waitForUndoGroup(): Promise<void> {
        await this.page.waitForTimeout(350);
    }

    // ── Click helpers ───────────────────────────────────────────────────

    /**
     * Click at a fractional position within a locator's bounding box.
     * xFrac/yFrac are 0..1 proportions.
     */
    async clickAt(locator: Locator, xFrac: number, yFrac = 0.5): Promise<void> {
        const box = await locator.boundingBox();
        if (!box) throw new Error("Element not visible for clickAt");
        await this.page.mouse.click(box.x + box.width * xFrac, box.y + box.height * yFrac);
    }

    /** Click at the very beginning of the editor (outside any revision). */
    async clickEditorStart(): Promise<void> {
        await this.clickAt(this.editor, 0.02);
    }

    // ── Page error tracking ─────────────────────────────────────────────

    private _pageErrors: string[] = [];

    /** Start capturing page errors. Call in beforeEach. */
    capturePageErrors(): void {
        this._pageErrors = [];
        this.page.on("pageerror", (error) => {
            this._pageErrors.push(error.message ?? String(error));
        });
    }

    /** Assert no page errors occurred. Call at end of test. */
    expectNoPageErrors(): void {
        expect(this._pageErrors).toHaveLength(0);
    }

    // ── Settings modal ──────────────────────────────────────────────────

    async openSettings(): Promise<Locator> {
        await this.page.locator("#status-bar button[aria-label='Open settings']").click();
        const modal = this.page.locator(".settings-modal-inner");
        await expect(modal).toBeVisible({ timeout: 5_000 });
        return modal;
    }

    // ── Status bar assertions ───────────────────────────────────────────

    async expectWordCount(n: number): Promise<void> {
        await expect(this.wordCountOverlay).toContainText(`${n} words`);
    }

    async expectCharCount(n: number): Promise<void> {
        await expect(this.wordCountOverlay).toContainText(`${n} chars`);
    }
}
