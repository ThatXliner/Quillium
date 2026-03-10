/**
 * tests/e2e/screenshots.pw.ts — Visual snapshot tests / screenshot generator
 *
 * Each test captures a key UI state and compares it against a committed
 * baseline in screenshots/. Running with --update-snapshots regenerates
 * the baselines (i.e. "bun run screenshots").
 *
 * Scenarios:
 *   01-editor           — clean editor with the AI sidebar pill
 *   02-feedback         — feedback panel open with quick-action chips
 *   03-annotations      — all three annotation types collapsed beside the doc
 *   04-comment-active   — comment card active: full thread + reply input visible
 *   05-revision-active  — revision card active: version pills + nested editor open
 *   06-library          — document library with multiple documents and preview panel
 *   07-revision-modal   — revision full-screen modal editor open
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// ── Content ───────────────────────────────────────────────────────────────────

// Public domain — opening of A Tale of Two Cities (Dickens)
const PROSE_SHORT =
    "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.";

// ── Library mock data ─────────────────────────────────────────────────────────

const LIBRARY_DOCUMENTS = [
    {
        id: "doc-1",
        title: "The Lighthouse Keeper",
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
        updatedAt: Date.now() - 1000 * 60 * 30,
        wordCount: 312,
        previewText:
            "The old lighthouse keeper had watched storms roll in from the sea for forty years. Each one was different — some crept in slowly, giving him hours to prepare…",
        tags: '["fiction","short story"]',
        deletedAt: null,
    },
    {
        id: "doc-2",
        title: "On the Question of Forgetting",
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 12,
        updatedAt: Date.now() - 1000 * 60 * 60 * 2,
        wordCount: 580,
        previewText:
            "There is a particular cruelty in the way memory works: it keeps what we would most like to lose and loses what we most want to keep…",
        tags: '["essay","nonfiction"]',
        deletedAt: null,
    },
    {
        id: "doc-3",
        title: "Inventory",
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 20,
        updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 1,
        wordCount: 204,
        previewText:
            "Marcus kept a list of everything he had ever lost. It began, as these things often do, as a joke. He was twenty-four and had lost his keys for the third time that week…",
        tags: '["fiction"]',
        deletedAt: null,
    },
    {
        id: "doc-4",
        title: "Elena in Kraków",
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
        updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
        wordCount: 421,
        previewText:
            "The morning Elena arrived in Kraków, the city was doing what it did best: pretending nothing had changed. Trams rattled past the Cloth Hall on their same iron tracks…",
        tags: '["fiction","novel"]',
        deletedAt: null,
    },
];

// ── Tauri mock ────────────────────────────────────────────────────────────────

type TauriMockOptions = {
    loadResponse: string | null;
    fakeApiKey: boolean;
    libraryMode: boolean;
};

async function installTauriMock(
    page: Page,
    options: Partial<TauriMockOptions> = {},
): Promise<void> {
    const loadResponse = options.loadResponse ?? null;
    const fakeApiKey = options.fakeApiKey ?? false;
    const libraryMode = options.libraryMode ?? false;

    await page.addInitScript(
        (payload: {
            loadResponse: string | null;
            fakeApiKey: boolean;
            libraryMode: boolean;
            libraryDocs: typeof LIBRARY_DOCUMENTS;
        }) => {
            localStorage.setItem("quillium_tutorial_seen", "1");

            let nextCallbackId = 1;
            const callbacks = new Map<number, (...args: unknown[]) => unknown>();
            const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

            let savedState: string | null = payload.loadResponse;

            (window as unknown as Record<string, unknown>).__TAURI_MOCK__ = { invokeCalls };

            (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
                invoke: async (cmd: string, args: unknown) => {
                    invokeCalls.push({ cmd, args });
                    if (cmd === "load") return savedState;
                    if (cmd === "save") {
                        savedState = (args as { state: string }).state;
                        return true;
                    }
                    if (cmd === "get_api_key") return payload.fakeApiKey ? "sk-demo-key" : null;
                    if (cmd === "set_api_key") return null;
                    if (cmd === "plugin:event|listen") return 1;
                    if (cmd === "plugin:event|unlisten") return null;
                    if (cmd === "cmd_migrate_from_state_json")
                        return { migrated: false, documentId: null };
                    if (cmd === "cmd_list_documents")
                        return payload.libraryMode ? payload.libraryDocs : [];
                    if (cmd === "cmd_list_trashed_documents") return [];
                    if (cmd === "cmd_get_trash_retention") return 30;
                    if (cmd === "cmd_set_trash_retention") return null;
                    if (cmd === "cmd_purge_expired_trash") return 0;
                    if (cmd === "cmd_get_document") {
                        const id = (args as { id: string }).id;
                        return payload.libraryDocs.find((d) => d.id === id) ?? null;
                    }
                    if (cmd === "cmd_create_document") return "doc-new";
                    if (cmd === "cmd_update_document_meta") return null;
                    if (cmd === "cmd_trash_document") return null;
                    if (cmd === "cmd_restore_document") return null;
                    if (cmd === "cmd_delete_document") return null;
                    if (cmd === "cmd_reset_db") {
                        savedState = null;
                        return null;
                    }
                    if (cmd === "cmd_list_drafts") return [];
                    if (cmd === "cmd_create_draft") return "draft-1";
                    if (cmd === "cmd_append_event")
                        return { eventId: Math.floor(Math.random() * 100000) };
                    if (cmd === "cmd_create_snapshot") {
                        savedState = (args as { stateJson: string }).stateJson;
                        return null;
                    }
                    if (cmd === "cmd_load_document_state")
                        return { snapshotStateJson: savedState, eventsSince: [] };
                    return null;
                },
                transformCallback: (callback: (...args: unknown[]) => unknown) => {
                    const id = nextCallbackId;
                    nextCallbackId += 1;
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
        { loadResponse, fakeApiKey, libraryMode, libraryDocs: LIBRARY_DOCUMENTS },
    );
}

// ── Editor helpers ────────────────────────────────────────────────────────────

async function waitForEditor(page: Page): Promise<void> {
    await page.locator("#editor-document").waitFor({ state: "attached", timeout: 15_000 });
    await page
        .locator("#editor-document .cm-editor")
        .waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(200);
}

async function setEditorText(page: Page, text: string): Promise<void> {
    const editor = page.locator("#editor-document .cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.evaluate((t: string) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", t);
        document.activeElement?.dispatchEvent(
            new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }),
        );
    }, text);
    await page.waitForTimeout(300);
}

async function applyDebugScenario(page: Page, scenarioId: string): Promise<boolean> {
    const ok = await page.evaluate(async (id: string) => {
        const fn = (window as unknown as Record<string, unknown>).__runScenario__;
        if (typeof fn !== "function") return false;
        return (fn as (id: string) => Promise<boolean>)(id);
    }, scenarioId);
    if (ok) await page.waitForTimeout(1200);
    return ok;
}

async function activateAnnotation(page: Page, targetText: string): Promise<void> {
    await page.evaluate((target: string) => {
        const editorViewStore = (window as unknown as Record<string, unknown>).__editorView__ as
            | { subscribe(fn: (v: unknown) => void): () => void }
            | undefined;
        if (!editorViewStore) return;
        let view: unknown;
        const unsub = editorViewStore.subscribe((v) => {
            view = v;
        });
        unsub();
        if (!view) return;
        const v = view as {
            state: { doc: { toString(): string } };
            dispatch(tr: object): void;
            focus(): void;
        };
        const pos = v.state.doc.toString().indexOf(target);
        if (pos === -1) return;
        v.focus();
        v.dispatch({ selection: { anchor: pos + Math.floor(target.length / 2) } });
    }, targetText);
    await page.waitForTimeout(400);
}

// ── Snapshot helper ───────────────────────────────────────────────────────────

// Threshold: 0.5% of pixels must differ to count as a meaningful change.
const SNAPSHOT_THRESHOLD = 0.005;

function snap(page: Page, name: string) {
    return expect(page).toHaveScreenshot(`${name}.png`, {
        maxDiffPixelRatio: SNAPSHOT_THRESHOLD,
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.use({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
});

test("01-editor", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await waitForEditor(page);
    await setEditorText(page, PROSE_SHORT);
    await page.mouse.click(720, 800);
    await page.waitForTimeout(200);
    await snap(page, "01-editor");
});

test("02-feedback", async ({ page }) => {
    await installTauriMock(page, { fakeApiKey: true });
    await page.goto("/");
    await waitForEditor(page);
    await setEditorText(page, PROSE_SHORT);
    await page.locator("#ai-tab-feedback").waitFor({ state: "visible" });
    await page
        .waitForFunction(
            () =>
                document
                    .querySelector("#ai-tab-feedback")
                    ?.getAttribute("aria-label")
                    ?.includes("⌘") ?? false,
            { timeout: 5000 },
        )
        .catch(() => {});
    await page.locator("#ai-tab-feedback").click({ force: true });
    await page.locator("#ai-sidebar").waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    await snap(page, "02-feedback");
});

test("03-annotations", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-annotations");
    if (!applied) await setEditorText(page, PROSE_SHORT);
    await page.mouse.click(720, 800);
    await page.waitForTimeout(400);
    await snap(page, "03-annotations");
});

test("04-comment-active", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-comment-thread");
    if (!applied) await setEditorText(page, PROSE_SHORT);
    await activateAnnotation(page, "it was the age of wisdom, it was the age of foolishness");
    await snap(page, "04-comment-active");
});

test("05-revision-active", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-revision-active");
    if (!applied) await setEditorText(page, PROSE_SHORT);
    await activateAnnotation(page, "Spiritual revelations were conceded");
    await page.waitForTimeout(400);
    await snap(page, "05-revision-active");
});

test("06-library", async ({ page }) => {
    await installTauriMock(page, { libraryMode: true });
    await page.goto("/library");
    await page.locator("h1").filter({ hasText: "Your Library" }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const cards = page.locator('[role="button"]').filter({ hasText: /words/ });
    const count = await cards.count();
    if (count > 1) {
        await cards.nth(1).click();
        await page.waitForTimeout(300);
    }
    await snap(page, "06-library");
});

test("07-revision-modal", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-revision-active");
    if (!applied) {
        await setEditorText(page, PROSE_SHORT);
        await snap(page, "07-revision-modal");
        return;
    }
    await activateAnnotation(page, "Spiritual revelations were conceded");
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const stack = w.__modalStack__ as { push(entry: object): void } | undefined;
        const editorViewStore = w.__editorView__ as
            | { subscribe(fn: (v: unknown) => void): () => void }
            | undefined;
        if (!stack || !editorViewStore) return;
        let view: unknown;
        const unsub = editorViewStore.subscribe((v) => {
            view = v;
        });
        unsub();
        if (!view) return;
        const revCard = document.querySelector("[data-tutorial-role='revision-card']");
        const revisionIdStr = revCard?.getAttribute("data-revision-id");
        if (!revisionIdStr) return;
        const revisionId = parseInt(revisionIdStr, 10);
        if (isNaN(revisionId)) return;
        stack.push({ type: "revision", revisionId, parentView: view, label: "Revision" });
    });
    await page.waitForTimeout(600);
    await snap(page, "07-revision-modal");
});
