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
 *   01-editor.png           — clean editor, focused writing environment
 *   03b-annotations-no-ai.png — comment and revision only (no AI suggestion)
 *   03-annotations.png      — all three annotation types collapsed beside the doc
 *   04-comment-active.png   — comment card active: full thread + reply input visible
 *   05-revision-active.png  — revision card active: version pills + nested editor open
 *   06-library.png          — document library with multiple documents and preview panel
 *   07-revision-modal.png   — revision full-screen modal editor open
 *   10-dictionary.png       — dictionary/thesaurus panel open with word selected
 *   12-nested-revision.png  — doubly-nested revision: outer modal with inner revision open
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
 * 03b. annotations-no-ai — Comment and revision only (no AI suggestion),
 *    beside the document in their collapsed/resting state.
 */
async function scenarioAnnotationsNoAi(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-annotations-no-ai");
    if (!applied) {
        await setEditorText(page, PROSE_SHORT);
    }
    await page.mouse.click(720, 800);
    await page.waitForTimeout(400);
    await shot(page, "03b-annotations-no-ai");
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
 * 12. nested-revision — A revision modal open over the main editor, with a
 *    second inner revision created inside it — showing the doubly-nested
 *    editing capability.
 */
async function scenarioNestedRevision(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);
    const applied = await applyDebugScenario(page, "screenshot-nested-revision");
    if (!applied) {
        await page.close();
        return;
    }
    // Activate the outer revision card
    await activateAnnotation(page, "running his fingers along the brass gears");
    await page.waitForTimeout(400);
    // Push the outer revision modal, with a pending nested revision command
    // that selects "the way a pianist runs scales before the hall fills" inside
    // the Extended version text.
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
        const revisionId = Number.parseInt(revisionIdStr, 10);
        if (Number.isNaN(revisionId)) return;
        const versionText =
            "running his fingers along the brass gears, feeling each tooth engage with the precision of something built to outlast its maker — the way a pianist runs scales before the hall fills";
        const innerTarget = "the way a pianist runs scales before the hall fills";
        const from = versionText.indexOf(innerTarget);
        const to = from + innerTarget.length;
        stack.push({
            type: "revision",
            revisionId,
            parentView: view,
            label: "Extended",
            pendingNestedCommand: { type: "revision", selectionFrom: from, selectionTo: to },
        });
    });
    // Wait for the outer modal to mount and create the inner nested revision
    await page.waitForTimeout(800);
    // Push a second modal for the inner nested revision.
    // __modalEditors__[0] is the outer modal's nested EditorView, exposed by
    // RevisionModal's DEV bridge. The inner revision card's id comes from the DOM.
    await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const stack = w.__modalStack__ as { push(entry: object): void } | undefined;
        const modalEditors = w.__modalEditors__ as Record<number, unknown> | undefined;
        if (!stack || !modalEditors) return;
        const nestedView = modalEditors[0];
        if (!nestedView) return;
        // The inner revision card is the last one in the document
        const revCards = document.querySelectorAll("[data-tutorial-role='revision-card']");
        const innerCard = revCards[revCards.length - 1];
        if (!innerCard) return;
        const revisionIdStr = innerCard.getAttribute("data-revision-id");
        if (!revisionIdStr) return;
        const revisionId = Number.parseInt(revisionIdStr, 10);
        if (Number.isNaN(revisionId)) return;
        stack.push({
            type: "revision",
            revisionId,
            parentView: nestedView,
            label: "Pianist image",
        });
    });
    await page.waitForTimeout(600);
    await shot(page, "12-nested-revision");
    await page.close();
}

/**
 * 10. dictionary — The floating Dictionary & Thesaurus popover open in
 *    "Look up word" mode, with "wisdom" selected in the editor and
 *    auto-populated into the popover via the keyboard shortcut (⌘B / Ctrl+B).
 */
async function scenarioDictionary(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
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
        const target = "wisdom";
        const from = doc.indexOf(target);
        if (from === -1) return;
        v.focus();
        v.dispatch({ selection: { anchor: from, head: from + target.length } });
    });
    await page.waitForTimeout(300);

    // Open the dictionary/thesaurus popover via the keyboard shortcut (⌘B / Ctrl+B).
    // The sidebar Dictionary tab was removed in favour of the floating popover.
    const dictionaryShortcut = process.platform === "darwin" ? "Meta+B" : "Control+B";
    await page.keyboard.press(dictionaryShortcut);
    await page.waitForTimeout(500);

    await shot(page, "10-dictionary");
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
                // Verify it's a Vite dev server, not `vite preview`. The preview
                // build strips import.meta.env.DEV so __runScenario__ is never
                // exposed and annotation scenarios silently fall back to plain text.
                // /@vite/client is injected only by the dev server, not preview.
                const devCheck = await fetch(`${BASE_URL}/@vite/client`).catch(() => null);
                if (!devCheck || !devCheck.ok) {
                    throw new Error(
                        `A server is running at ${BASE_URL} but it does not appear to be a Vite dev server (/@vite/client returned ${devCheck?.status ?? "network error"}). ` +
                        `This is likely \`vite preview\`, which runs the production build where __runScenario__ is unavailable. ` +
                        `Stop it and re-run, or use --no-server to point at a running tauri dev instance on port 1420.`,
                    );
                }
                serverAlreadyRunning = true;
                console.log(`Using existing dev server at ${BASE_URL}`);
            }
        } catch (e) {
            if (e instanceof Error && e.message.includes("/@vite/client")) throw e;
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
        await scenarioAnnotationsNoAi(context);
        await scenarioAnnotations(context);
        await scenarioCommentActive(context);
        await scenarioRevisionActive(context);
        await scenarioLibrary(context);
        await scenarioRevisionModal(context);
        await scenarioNestedRevision(context);
        await scenarioDictionary(context);
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
