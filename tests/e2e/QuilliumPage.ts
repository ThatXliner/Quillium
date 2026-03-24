/**
 * QuilliumPage — Page object encapsulating all Quillium E2E interactions.
 *
 * Provides a fluent, composable API so test bodies stay declarative.
 * All raw Playwright selectors live here; tests should never reach for
 * `page.locator(...)` directly.
 */

import { expect, type Page, type Locator } from "@playwright/test";

// ── Tauri mock configuration ────────────────────────────────────────────────

export type TauriMockOptions = {
    /** Return value for `get_api_key`. null = no key configured. */
    apiKey: string | null;
    /** When set, `plugin:updater|check` returns an available update. */
    updateVersion: string | null;
    /** When false, the tutorial overlay appears on load. */
    skipTutorial: boolean;
    /** Merged into localStorage `quillium-app-settings`. */
    settings: Record<string, unknown>;
    /**
     * Pre-loaded document text.  When set, cmd_load_document_state returns
     * a snapshot so the editor opens with content.
     */
    initialDoc: string | null;
};

const DEFAULT_OPTIONS: TauriMockOptions = {
    apiKey: null,
    updateVersion: null,
    skipTutorial: true,
    settings: { showNestedEditor: true, atomicRevisions: true },
    initialDoc: null,
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
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    // ── Setup ───────────────────────────────────────────────────────────

    /** Install Tauri mock and configure localStorage settings. */
    async setup(): Promise<void> {
        const opts = this.options;
        await this.page.addInitScript(
            (payload: {
                apiKey: string | null;
                updateVersion: string | null;
                skipTutorial: boolean;
                settings: Record<string, unknown>;
                initialDoc: string | null;
            }) => {
                if (payload.skipTutorial) {
                    localStorage.setItem("quillium_tutorial_seen", "1");
                }
                if (Object.keys(payload.settings).length > 0) {
                    localStorage.setItem("quillium-app-settings", JSON.stringify(payload.settings));
                }

                let nextCallbackId = 1;
                const callbacks = new Map<number, (...args: unknown[]) => unknown>();
                const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

                (window as unknown as Record<string, unknown>).__TAURI_MOCK__ = { invokeCalls };

                (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
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
                        if (cmd === "cmd_list_drafts")
                            return [
                                {
                                    id: "draft-test-1",
                                    documentId: "doc-test-1",
                                    label: "Draft",
                                    createdAt: 0,
                                    isActive: true,
                                },
                            ];

                        if (cmd === "cmd_load_document_state") {
                            if (payload.initialDoc) {
                                return {
                                    snapshotStateJson: JSON.stringify({
                                        doc: payload.initialDoc,
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

                        if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
                        if (cmd === "cmd_create_snapshot") return null;
                        if (cmd === "cmd_update_document_meta") return null;
                        if (cmd === "get_api_key") return payload.apiKey;

                        // Updater plugin
                        if (cmd === "plugin:updater|check") {
                            if (payload.updateVersion) {
                                return {
                                    available: true,
                                    version: payload.updateVersion,
                                    date: new Date().toISOString(),
                                    body: "Release notes",
                                };
                            }
                            return null;
                        }
                        if (cmd === "plugin:updater|download_and_install") {
                            await new Promise((r) => setTimeout(r, 60_000));
                            return null;
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
                updateVersion: opts.updateVersion,
                skipTutorial: opts.skipTutorial,
                settings: opts.settings,
                initialDoc: opts.initialDoc,
            },
        );
    }

    /** Navigate to "/" and wait for the editor to render. */
    async goto(): Promise<void> {
        await this.page.goto("/");
        await expect(this.editor).toBeVisible({ timeout: 10_000 });
    }

    /** setup() + goto() — the common two-liner for most tests. */
    async init(): Promise<void> {
        await this.setup();
        await this.goto();
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
        await this.editor.click();
        await this.selectAll();
        await this.page.keyboard.type(text);
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
        await this.page.keyboard.press("ControlOrMeta+z");
    }

    async redo(): Promise<void> {
        await this.page.keyboard.press("ControlOrMeta+Shift+z");
    }

    async backspace(n = 1): Promise<void> {
        await this.pressRepeat("Backspace", n);
    }

    async createComment(): Promise<void> {
        await this.page.keyboard.press("ControlOrMeta+Alt+m");
    }

    async createRevision(): Promise<void> {
        await this.page.keyboard.press("ControlOrMeta+Alt+k");
    }

    async newVersion(): Promise<void> {
        await this.page.keyboard.press("ControlOrMeta+Shift+v");
    }

    async replyToAnnotation(): Promise<void> {
        await this.page.keyboard.press("ControlOrMeta+/");
    }

    async openDictionary(): Promise<void> {
        await this.page.keyboard.press("ControlOrMeta+b");
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
        await this.selectRange(from, to);
        await this.createRevision();
        return fullText.slice(from, to);
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
            await expand.click();
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
        await expect(this.statusBar).toContainText(`Words: ${n}`);
    }

    async expectCharCount(n: number): Promise<void> {
        await expect(this.statusBar).toContainText(`Characters: ${n}`);
    }
}
