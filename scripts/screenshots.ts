/**
 * scripts/screenshots.ts — Automated demo screenshot capture
 *
 * Starts the Vite dev server, seeds realistic content via debug
 * scenarios, and writes PNG files to screenshots/.
 *
 * Usage:
 *   bun run screenshots              # auto-start dev server on :4173 if needed
 *   bun run screenshots --no-server  # use already-running server on :1420 (tauri dev)
 *
 * Output: screenshots/
 *   01-editor.png           — clean editor with the AI sidebar pill
 *   02-feedback.png         — feedback panel open with quick-action chips
 *   03-annotations.png      — all three annotation types collapsed beside the doc
 *   04-comment-active.png   — comment card active: full thread + reply input visible
 *   05-revision-active.png  — revision card active: version pills + nested editor open
 *   06-library.png          — document library with multiple documents and preview panel
 *   07-revision-modal.png   — revision full-screen modal editor open
 *   10-dictionary.png       — dictionary/thesaurus panel open with word selected
 *   09-update-banner.png    — update notification banner in bottom-right
 *   10-autoai-bubble.png   — AutoAI collaborator bubble in active state (rainbow border)
 *   11-autoai-card.png     — AutoAI settings card morphed open from the bubble
 */

import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

// ── Config ────────────────────────────────────────────────────────────────────

const noServer = process.argv.includes("--no-server");
const force = process.argv.includes("--force");
const BASE_URL = noServer ? "http://localhost:1420" : "http://localhost:4173";
const OUT_DIR = "screenshots";
const VIEWPORT = { width: 1440, height: 900 };
const DEVICE_SCALE_FACTOR = 2;

// Minimum fraction of pixels that must differ for a screenshot to be considered
// "significantly changed" and worth committing. 0.01 = 1% of total pixels.
// If --force is set, all screenshots are updated (threshold = 0).
const DIFF_THRESHOLD = force ? 0 : 0.01;

// ── Content ───────────────────────────────────────────────────────────────────

// Public domain — opening of A Tale of Two Cities (Dickens)
const PROSE_SHORT =
    "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.";

// ── Tauri mock ────────────────────────────────────────────────────────────────

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

// ── Tauri mock options ────────────────────────────────────────────────────────

type TauriMockOptions = {
    loadResponse: string | null;
    fakeApiKey: boolean;
    libraryMode: boolean;
    updateVersion: string | null;
};

async function installTauriMock(
    page: Page,
    options: Partial<TauriMockOptions> = {},
): Promise<void> {
    const loadResponse = options.loadResponse ?? null;
    const fakeApiKey = options.fakeApiKey ?? false;
    const libraryMode = options.libraryMode ?? false;
    const updateVersion = options.updateVersion ?? null;

    await page.addInitScript(
        (payload: {
            loadResponse: string | null;
            fakeApiKey: boolean;
            libraryMode: boolean;
            libraryDocs: typeof LIBRARY_DOCUMENTS;
            updateVersion: string | null;
        }) => {
            localStorage.setItem("quillium_tutorial_seen", "1");
            // Signal that an API key has been saved so the settings module
            // calls loadApiKeyForProvider() on startup. Without this,
            // hasApiKey() always returns false and tab clicks redirect to Settings.
            if (payload.fakeApiKey) {
                localStorage.setItem("quillium-has-api-key", "1");
            }
            // Hide the debug button so it never appears in screenshots.
            document.addEventListener("DOMContentLoaded", () => {
                const style = document.createElement("style");
                style.textContent = "[aria-label='Open debug panel'] { display: none !important; }";
                document.head.appendChild(style);
            });
            // Ensure a consistent font for all screenshots regardless of any
            // persisted user settings that may be present in the browser profile.
            localStorage.setItem(
                "quillium-app-settings",
                JSON.stringify({
                    docFontFamily: "Georgia, serif",
                    docFontSize: 18,
                }),
            );

            let nextCallbackId = 1;
            const callbacks = new Map<number, (...args: unknown[]) => unknown>();
            const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

            // Mutable saved state — updated by "save" so "load" returns the
            // latest value (needed for the scenario reload cycle).
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
                    // Document library commands
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
        { loadResponse, fakeApiKey, libraryMode, libraryDocs: LIBRARY_DOCUMENTS, updateVersion },
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

/**
 * Apply a debug scenario via the window.__runScenario__ bridge exposed
 * in +page.svelte (DEV only). Runs the same save+reload cycle as the
 * debug panel. Returns true if the scenario ran successfully.
 */
async function applyDebugScenario(page: Page, scenarioId: string): Promise<boolean> {
    const ok = await page.evaluate(async (id: string) => {
        const fn = (window as unknown as Record<string, unknown>).__runScenario__;
        if (typeof fn !== "function") return false;
        return (fn as (id: string) => Promise<boolean>)(id);
    }, scenarioId);
    // Wait for setState + Svelte reactivity + annotation decorations to settle
    if (ok) await page.waitForTimeout(1200);
    return ok;
}

/**
 * Place the CodeMirror cursor inside the first occurrence of targetText,
 * activating the annotation card whose range covers that position.
 */
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
        // Place cursor mid-word so it falls squarely inside the annotation range
        v.focus();
        v.dispatch({ selection: { anchor: pos + Math.floor(target.length / 2) } });
    }, targetText);
    // Let the activeAnnotation store update and Svelte re-render
    await page.waitForTimeout(400);
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

async function startServer(): Promise<ChildProcess> {
    console.log("Starting dev server…");
    const server = spawn(
        "bun",
        ["run", "dev", "--", "--host", "localhost", "--port", "4173", "--strictPort"],
        { stdio: ["ignore", "pipe", "pipe"], detached: false },
    );
    server.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[server] ${chunk}`));
    server.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[server] ${chunk}`));
    await pollUntilReady(BASE_URL);
    console.log("Server ready.");
    return server;
}

async function pollUntilReady(url: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok || res.status === 304) return;
        } catch {
            /* not ready yet */
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

// ── Visual diff ───────────────────────────────────────────────────────────────

let significantChanges = false;

/**
 * Compare two PNG buffers pixel-by-pixel. Returns the fraction of pixels
 * that differ (0–1). Returns 1 if the images have different dimensions.
 */
function diffFraction(a: Buffer, b: Buffer): number {
    const imgA = PNG.sync.read(a);
    const imgB = PNG.sync.read(b);
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) return 1;
    const total = imgA.width * imgA.height;
    const changed = pixelmatch(imgA.data, imgB.data, null, imgA.width, imgA.height, {
        threshold: 0.1,
    });
    return changed / total;
}

// ── Screenshot helper ─────────────────────────────────────────────────────────

async function shot(page: Page, name: string): Promise<void> {
    const filePath = `${OUT_DIR}/${name}.png`;
    const newBytes = await page.screenshot({ fullPage: false });

    if (existsSync(filePath)) {
        const oldBytes = await readFile(filePath);
        const fraction = diffFraction(oldBytes, newBytes);
        const pct = (fraction * 100).toFixed(2);
        if (fraction >= DIFF_THRESHOLD) {
            significantChanges = true;
            console.log(`  ✓ ${filePath} (${pct}% changed — significant)`);
        } else {
            console.log(`  – ${filePath} (${pct}% changed — skipped, below threshold)`);
            return; // keep the existing file
        }
    } else {
        significantChanges = true;
        console.log(`  ✓ ${filePath} (new)`);
    }

    await writeFile(filePath, newBytes);
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

/**
 * 01. editor — Clean writing environment: the document card, status bar,
 *    and the collapsed AI sidebar pill. Shows the focused, minimal UI.
 */
async function scenarioEditor(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    await setEditorText(page, PROSE_SHORT);
    await page.mouse.click(720, 800);
    await page.waitForTimeout(200);
    await shot(page, "01-editor");
    await page.close();
}

/**
 * 02. feedback — The Feedback panel open with quick-action chips visible.
 *    Shows the AI assistance UI before any session starts.
 */
async function scenarioFeedback(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page, { fakeApiKey: true });
    await page.goto(BASE_URL);
    await waitForEditor(page);
    await setEditorText(page, PROSE_SHORT);
    // Wait for the async loadApiKeyForProvider() call to resolve — without
    // this, hasApiKey() returns false and the click redirects to "settings".
    // The aria-label changes from "…add API key…" to "…⌘⇧2…" once resolved.
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
    await shot(page, "02-feedback");
    await page.close();
}

/**
 * 03. annotations — All three annotation types (comment, suggestion,
 *    revision) beside the document in their collapsed/resting state.
 *    Shows the annotation panel at a glance.
 */
async function scenarioAnnotations(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-annotations");
    if (!applied) {
        await setEditorText(page, PROSE_SHORT);
    }
    // Click somewhere neutral — no annotation active
    await page.mouse.click(720, 800);
    await page.waitForTimeout(400);
    await shot(page, "03-annotations");
    await page.close();
}

/**
 * 04. comment-active — A comment card in its expanded active state:
 *    the full back-and-forth thread and reply input are visible.
 *    The yellow highlight in the editor shows which text is annotated.
 */
async function scenarioCommentActive(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-comment-thread");
    if (!applied) {
        await setEditorText(page, PROSE_SHORT);
    }
    // Activate the comment card by placing the cursor inside its range
    await activateAnnotation(page, "it was the age of wisdom, it was the age of foolishness");
    await shot(page, "04-comment-active");
    await page.close();
}

/**
 * 05. revision-active — A revision card in its expanded active state:
 *    version pills are visible and the inline nested editor is open
 *    showing the alternative text. The purple highlight marks the range.
 */
async function scenarioRevisionActive(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-revision-active");
    if (!applied) {
        await setEditorText(page, PROSE_SHORT);
    }
    // Activate the revision card — nested editor auto-opens when active
    await activateAnnotation(page, "Spiritual revelations were conceded");
    await page.waitForTimeout(400); // extra time for nested editor to mount
    await shot(page, "05-revision-active");
    await page.close();
}

/**
 * 06. library — The document library with multiple documents in the grid
 *    and the preview panel open on the right, showing the document
 *    management system.
 */
async function scenarioLibrary(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page, { libraryMode: true });
    await page.goto(`${BASE_URL}/library`);
    // Wait for the document grid to load
    await page.locator("h1").filter({ hasText: "Your Library" }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    // Select the second document card to show the preview panel populated
    // Cards are role="button" elements inside the grid container
    const cards = page.locator('[role="button"]').filter({ hasText: /words/ });
    const count = await cards.count();
    if (count > 1) {
        await cards.nth(1).click();
        await page.waitForTimeout(300);
    }
    await shot(page, "06-library");
    await page.close();
}

/**
 * 07. revision-modal — The full-screen revision modal editor open, showing
 *    the alternative text being edited in a distraction-free modal over
 *    the main editor.
 */
async function scenarioRevisionModal(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-revision-active");
    if (!applied) {
        await setEditorText(page, PROSE_SHORT);
        await shot(page, "07-revision-modal");
        await page.close();
        return;
    }
    // Activate the revision card
    await activateAnnotation(page, "Spiritual revelations were conceded");
    await page.waitForTimeout(400);
    // Push directly to modalStack via the DEV bridge — more reliable than clicking
    // the DOM button which can be blocked by clip-path or positioning.
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const stack = w.__modalStack__ as { push(entry: object): void } | undefined;
        const editorViewStore = w.__editorView__ as
            | { subscribe(fn: (v: unknown) => void): () => void }
            | undefined;
        if (!stack || !editorViewStore) return;
        // Synchronously read the current EditorView from the Svelte store
        let view: unknown;
        const unsub = editorViewStore.subscribe((v) => {
            view = v;
        });
        unsub();
        if (!view) return;
        // Find the revision annotation id from the DOM
        const revCard = document.querySelector("[data-tutorial-role='revision-card']");
        const revisionIdStr = revCard?.getAttribute("data-revision-id");
        if (!revisionIdStr) return;
        const revisionId = Number.parseInt(revisionIdStr, 10);
        if (Number.isNaN(revisionId)) return;
        stack.push({ type: "revision", revisionId, parentView: view, label: "Revision" });
    });
    await page.waitForTimeout(600);
    await shot(page, "07-revision-modal");
    await page.close();
}

/**
 * 08. full-ui — Hero marketing screenshot: all three annotation types visible
 *    beside an original short prose passage, the AI Chat sidebar open with
 *    a context snippet, and the last comment card active (showing thread +
 *    reply input + Suggest button).
 */
async function scenarioFullUi(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page, { fakeApiKey: true });
    await page.goto(BASE_URL);
    await waitForEditor(page);

    const applied = await applyDebugScenario(page, "screenshot-full-ui");
    if (!applied) {
        // Fallback: no scenario bridge in this build — skip
        await page.close();
        return;
    }

    // Open the AI Chat sidebar so it appears in the screenshot
    await page.locator("#ai-tab-chat").waitFor({ state: "visible" });
    await page
        .waitForFunction(
            () =>
                document.querySelector("#ai-tab-chat")?.getAttribute("aria-label")?.includes("⌘") ??
                false,
            { timeout: 5000 },
        )
        .catch(() => {});
    await page.locator("#ai-tab-chat").click({ force: true });
    await page.locator("#ai-sidebar").waitFor({ state: "visible" });

    // Select "The letter stayed where it was." as a range — this both activates
    // the comment card AND populates $selectedText so the Context box appears.
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const editorViewStore = w.__editorView__ as
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
        const doc = v.state.doc.toString();
        const target = "The letter stayed where it was.";
        const from = doc.indexOf(target);
        if (from === -1) return;
        const to = from + target.length;
        v.focus();
        v.dispatch({ selection: { anchor: from, head: to } });
    });
    await page.waitForTimeout(400);

    await shot(page, "08-full-ui");
    await page.close();
}

/** Shared setup for AutoAI screenshots — enables AutoAI via localStorage. */
async function setupAutoAIPage(ctx: BrowserContext): Promise<Page> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page, { fakeApiKey: true });
    await page.addInitScript(() => {
        localStorage.setItem(
            "quillium-autoai-settings",
            JSON.stringify({
                enabled: true,
                mode: "continuous",
                debounceMs: 10000,
                persona: "Auto",
                annotationTypes: ["comment", "suggestion", "revision"],
                conservativeness: "conservative",
            }),
        );
    });
    await page.goto(BASE_URL);
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-autoai-widget");
    if (!applied) await setEditorText(page, PROSE_SHORT);
    // Click away so no annotation is active
    await page.mouse.click(720, 700);
    await page.waitForTimeout(300);
    return page;
}

/**
 * 10. autoai-bubble — The AutoAI collaborator bubble in its active state:
 *    rainbow conic-gradient border showing AutoAI is enabled and watching.
 */
async function scenarioAutoAIBubble(ctx: BrowserContext): Promise<void> {
    const page = await setupAutoAIPage(ctx);
    await shot(page, "10-autoai-bubble");
    await page.close();
}

/**
 * 11. autoai-card — The AutoAI settings card morphed open from the bubble,
 *    showing the persona name, toggle, mode, delay, focus, and annotation
 *    type controls.
 */
async function scenarioAutoAICard(ctx: BrowserContext): Promise<void> {
    const page = await setupAutoAIPage(ctx);
    // Click the bubble to open the settings card
    await page.locator("button[aria-label*='AutoAI']").first().click();
    // Wait for the morph transition to complete (340ms) + panel fade-in (80ms delay)
    await page.waitForTimeout(600);
    await shot(page, "11-autoai-card");
    await page.close();
}

/**
 * 10. dictionary — The Dictionary & Thesaurus panel open in "Look up word"
 *    mode, with "wisdom" selected in the editor and the quick-action chips
 *    visible below the empty-state prompt.
 */
async function scenarioDictionary(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page, { fakeApiKey: true });
    await page.goto(BASE_URL);
    await waitForEditor(page);
    await setEditorText(page, PROSE_SHORT);

    // Select "wisdom" in the editor so the dictionary panel auto-populates it
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const editorViewStore = w.__editorView__ as
            | { subscribe(fn: (v: unknown) => void): () => void }
            | undefined;
        if (!editorViewStore) return;
        let view: unknown;
        const unsub = editorViewStore.subscribe((v) => { view = v; });
        unsub();
        if (!view) return;
        const v = view as {
            state: { doc: { toString(): string } };
            dispatch(tr: object): void;
            focus(): void;
        };
        const doc = v.state.doc.toString();
        const target = "wisdom";
        const from = doc.indexOf(target);
        if (from === -1) return;
        v.focus();
        v.dispatch({ selection: { anchor: from, head: from + target.length } });
    });
    await page.waitForTimeout(300);

    // Open the dictionary tab — wait for API key to resolve first so
    // hasApiKey() returns true and the click doesn't redirect to settings.
    await page.locator("#ai-tab-dictionary").waitFor({ state: "visible" });
    await page
        .waitForFunction(
            () =>
                !document
                    .querySelector("#ai-tab-dictionary")
                    ?.getAttribute("aria-label")
                    ?.includes("add API key") ?? false,
            { timeout: 8000 },
        )
        .catch(() => {});
    await page.locator("#ai-tab-dictionary").click({ force: true });
    await page.locator("#ai-sidebar").waitFor({ state: "visible" });
    // If we ended up on settings, click dictionary again
    await page.waitForTimeout(300);
    const titleText = await page.locator("#ai-sidebar .text-xs.font-semibold").innerText().catch(() => "");
    if (titleText.includes("Settings")) {
        await page.locator("#ai-tab-dictionary").click({ force: true });
        await page.waitForTimeout(400);
    }
    await page.waitForTimeout(300);

    await shot(page, "10-dictionary");
    await page.close();
}

/**
 * 09. update-banner — The update notification banner in the bottom-right
 *    corner, showing an available version with Update and Dismiss buttons.
 */
async function scenarioUpdateBanner(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page, { updateVersion: "1.0.0" });
    await page.goto(BASE_URL);
    await waitForEditor(page);
    await setEditorText(page, PROSE_SHORT);
    // Wait for the update banner to appear
    await page.locator("text=is available").waitFor({ state: "visible", timeout: 10_000 });
    await page.mouse.click(720, 400);
    await page.waitForTimeout(200);
    await shot(page, "09-update-banner");
    await page.close();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    await mkdir(OUT_DIR, { recursive: true });

    let server: ChildProcess | null = null;

    if (noServer) {
        try {
            const res = await fetch(BASE_URL);
            if (!res.ok && res.status !== 304 && res.status !== 200) {
                throw new Error(`Server returned ${res.status}`);
            }
            console.log(`Using existing server at ${BASE_URL}`);
        } catch {
            throw new Error(`--no-server was set but no server is reachable at ${BASE_URL}`);
        }
    } else {
        let serverAlreadyRunning = false;
        try {
            const res = await fetch(BASE_URL);
            if (res.ok || res.status === 304 || res.status === 200) {
                serverAlreadyRunning = true;
                console.log(`Using existing server at ${BASE_URL}`);
            }
        } catch {
            /* need to start one */
        }

        if (!serverAlreadyRunning) server = await startServer();
    }

    const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({ deviceScaleFactor: DEVICE_SCALE_FACTOR });

    try {
        console.log("\nCapturing screenshots…\n");
        await scenarioEditor(context);
        await scenarioFeedback(context);
        await scenarioAnnotations(context);
        await scenarioCommentActive(context);
        await scenarioRevisionActive(context);
        await scenarioLibrary(context);
        await scenarioRevisionModal(context);
        await scenarioFullUi(context);
        await scenarioDictionary(context);
        await scenarioUpdateBanner(context);
        await scenarioAutoAIBubble(context);
        await scenarioAutoAICard(context);
        if (significantChanges) {
            console.log(`\nDone. Screenshots saved to ./${OUT_DIR}/`);
        } else {
            console.log("\nDone. No significant visual changes detected — no files updated.");
        }
    } finally {
        await context.close();
        await browser.close();
        if (server) server.kill();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
