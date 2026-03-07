/**
 * scripts/screenshots.ts — Automated demo screenshot capture
 *
 * Starts the Vite preview server, seeds realistic content, stages
 * each UI scenario, and writes PNG files to screenshots/.
 *
 * Usage:
 *   bun run screenshots
 *
 * Output: screenshots/
 *   editor-default.png
 *   editor-with-text.png
 *   ai-sidebar-chat.png
 *   ai-sidebar-feedback.png
 *   annotations-panel.png
 *   full-ui.png
 */

import { chromium, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "http://127.0.0.1:4173";
const OUT_DIR = "screenshots";
const VIEWPORT = { width: 1440, height: 900 };

// ── Content ───────────────────────────────────────────────────────────────────

// Public domain — opening of A Tale of Two Cities (Dickens)
const PROSE_SHORT =
    "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.";

const PROSE_LONG = `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair.

We had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way. There were a king with a large jaw and a queen with a plain face, on the throne of England; there were a king with a large jaw and a queen with a fair face, on the throne of France.

It was the year of Our Lord one thousand seven hundred and seventy-five. Spiritual revelations were conceded to England at that favoured period, as at this. Mrs. Southcott had recently attained her five-and-twentieth blessed birthday, of whom a prophetic private in the Life Guards had heralded the sublime appearance by announcing that arrangements were made for the swallowing up of London and Westminster.`;

// ── Tauri mock ────────────────────────────────────────────────────────────────

type TauriMockOptions = {
    loadResponse: string | null;
    /** Return a fake non-empty API key from get_api_key so hasApiKey() is true */
    fakeApiKey: boolean;
};

/**
 * Installs the Tauri API mock, same pattern as tests/e2e/app.smoke.pw.ts.
 * Sets the tutorial-seen flag so the overlay never appears.
 *
 * Set fakeApiKey=true for scenarios that need the AI sidebar to open
 * chat/feedback panels (instead of redirecting to settings).
 */
async function installTauriMock(
    page: Page,
    options: Partial<TauriMockOptions> = {},
): Promise<void> {
    const loadResponse = options.loadResponse ?? null;
    const fakeApiKey = options.fakeApiKey ?? false;

    await page.addInitScript(
        (payload: { loadResponse: string | null; fakeApiKey: boolean }) => {
            localStorage.setItem("quillium_tutorial_seen", "1");

            let nextCallbackId = 1;
            const callbacks = new Map<number, (...args: unknown[]) => unknown>();
            const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

            (window as unknown as Record<string, unknown>).__TAURI_MOCK__ = {
                invokeCalls,
            };

            (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
                invoke: async (cmd: string, args: unknown) => {
                    invokeCalls.push({ cmd, args });
                    if (cmd === "load") return payload.loadResponse;
                    if (cmd === "save") return true;
                    if (cmd === "get_api_key") return payload.fakeApiKey ? "sk-demo-key" : null;
                    if (cmd === "set_api_key") return null;
                    if (cmd === "plugin:event|listen") return 1;
                    if (cmd === "plugin:event|unlisten") return null;
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
        { loadResponse, fakeApiKey },
    );
}

// ── Editor helpers ────────────────────────────────────────────────────────────

/**
 * Wait for the CodeMirror editor to be visible and ready.
 */
async function waitForEditor(page: Page): Promise<void> {
    await page.locator("#editor-document .cm-content").waitFor({
        state: "visible",
        timeout: 15_000,
    });
}

/**
 * Replace all editor content with the given text by selecting all
 * and typing the replacement. Uses clipboard for speed on long text.
 */
async function setEditorText(page: Page, text: string): Promise<void> {
    const editor = page.locator("#editor-document .cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    // Use clipboard for multi-line content to avoid slow character-by-character typing
    await page.evaluate((t: string) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", t);
        document.activeElement?.dispatchEvent(
            new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }),
        );
    }, text);
    // Small pause for CodeMirror to process the paste
    await page.waitForTimeout(300);
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

async function startServer(): Promise<ChildProcess> {
    console.log("Starting preview server…");

    // Build first, then preview
    const server = spawn("bun", ["run", "vite", "preview", "--port", "4173", "--strictPort"], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
    });

    server.stdout?.on("data", (chunk: Buffer) => {
        process.stdout.write(`[server] ${chunk}`);
    });
    server.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[server] ${chunk}`);
    });

    // Poll until the server responds
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
            // not ready yet
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

// ── Screenshot helpers ────────────────────────────────────────────────────────

async function shot(page: Page, name: string): Promise<void> {
    const path = `${OUT_DIR}/${name}.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`  ✓ ${path}`);
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

/**
 * 1. editor-default — Clean editor, short prose, status bar visible,
 *    AI sidebar in collapsed pill state (default on load).
 */
async function scenarioEditorDefault(
    browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<void> {
    const page = await browser.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);

    // Replace the default "Hello World" text with short prose
    await setEditorText(page, PROSE_SHORT);

    // Click somewhere neutral to deselect
    await page.mouse.click(720, 800);
    await page.waitForTimeout(200);

    await shot(page, "editor-default");
    await page.close();
}

/**
 * 2. editor-with-text — Longer fiction passage, scrolled to show
 *    the full document card with its shadow.
 */
async function scenarioEditorWithText(
    browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<void> {
    const page = await browser.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);

    await setEditorText(page, PROSE_LONG);

    // Scroll slightly to show the document card in full
    await page.mouse.click(720, 800);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo({ top: 0 }));

    await shot(page, "editor-with-text");
    await page.close();
}

/**
 * 3. ai-sidebar-chat — AI sidebar open on the Chat tab.
 *    Shows the empty "Start a conversation" state (no API key needed
 *    for the screenshot — the settings panel redirects, so we click
 *    force to bypass the hasApiKey guard for display purposes).
 */
async function scenarioAiSidebarChat(
    browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<void> {
    const page = await browser.newPage();
    await page.setViewportSize(VIEWPORT);
    // fakeApiKey=true so hasApiKey() returns true and the sidebar opens chat
    await installTauriMock(page, { fakeApiKey: true });
    await page.goto(BASE_URL);
    await waitForEditor(page);

    await setEditorText(page, PROSE_SHORT);

    // Open chat panel
    await page.locator("#ai-tab-chat").click({ force: true });
    await page.locator("#ai-sidebar").waitFor({ state: "visible" });
    // Wait for the expanded state to animate in
    await page.waitForTimeout(500);

    await shot(page, "ai-sidebar-chat");
    await page.close();
}

/**
 * 4. ai-sidebar-feedback — AI sidebar open on the Feedback tab.
 */
async function scenarioAiSidebarFeedback(
    browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<void> {
    const page = await browser.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page, { fakeApiKey: true });
    await page.goto(BASE_URL);
    await waitForEditor(page);

    await setEditorText(page, PROSE_SHORT);

    // Open feedback panel
    await page.locator("#ai-tab-feedback").click({ force: true });
    await page.locator("#ai-sidebar").waitFor({ state: "visible" });
    await page.waitForTimeout(500);

    // Switch to Feedback tab inside the expanded sidebar
    await page
        .locator("#ai-sidebar .overflow-x-auto button[aria-label='Feedback']")
        .click({ force: true });
    await page.waitForTimeout(300);

    await shot(page, "ai-sidebar-feedback");
    await page.close();
}

/**
 * 5. annotations-panel — Editor with prose and a highlighted comment
 *    annotation visible beside the document.
 *
 *    We seed the annotation by typing the text, selecting a phrase,
 *    then using the keyboard shortcut to open a comment (Mod+Shift+C
 *    or whatever the keymap defines — we use the UI menu if needed).
 *    For simplicity we select text and dispatch the CodeMirror effect
 *    directly via evaluate().
 */
async function scenarioAnnotationsPanel(
    browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<void> {
    const page = await browser.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);

    await setEditorText(page, PROSE_LONG);

    // Select the first sentence to annotate it
    const editor = page.locator("#editor-document .cm-content");
    await editor.click();

    // Use triple-click to select the first line, then create a comment
    await editor.click({ clickCount: 3 });
    await page.waitForTimeout(100);

    // Dispatch CodeMirror addAnnotation effect via evaluate
    const annotated = await page.evaluate(() => {
        // Find the CodeMirror view on the DOM
        const cmEditor = document.querySelector(".cm-editor") as HTMLElement & {
            [key: string | symbol]: unknown;
        };
        if (!cmEditor) return false;

        // CodeMirror stores the EditorView on the DOM node
        const viewSymbol = Object.getOwnPropertySymbols(cmEditor).find(
            (s) => s.toString() === "Symbol(cmView)",
        );
        if (!viewSymbol) return false;

        const view = cmEditor[viewSymbol] as {
            state: {
                selection: {
                    main: { from: number; to: number; empty: boolean };
                };
                field(f: unknown): unknown;
                doc: { toString(): string };
            };
            dispatch(tr: object): void;
        };

        const { from, to } = view.state.selection.main;
        if (from === to) return false;

        // Access the addAnnotation StateEffect from window if the app exposes it.
        // The app doesn't expose StateEffects globally, so we fire a custom event.
        // The app can intercept it or we can trigger the keyboard shortcut.
        // Since we can't import CodeMirror internals here, store selection info
        // and trigger via keyboard shortcut instead.
        (window as unknown as Record<string, unknown>).__screenshot_selection__ = { from, to };
        return true;
    });

    if (annotated) {
        // Trigger the comment shortcut (Mod+Shift+C based on CM keymaps)
        // Mod-Alt-m is the keybinding for createCommentCommand (annotationKeymap)
        await page.keyboard.press("Meta+Alt+m");
        await page.waitForTimeout(500);
    }

    // Deselect by clicking elsewhere, then wait for annotation card to appear
    await page.mouse.click(720, 800);
    await page.waitForTimeout(600);

    await shot(page, "annotations-panel");
    await page.close();
}

/**
 * 6. full-ui — Wide shot showing all three panels simultaneously:
 *    collapsed AI sidebar pill, editor with text, and annotation card.
 */
async function scenarioFullUi(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<void> {
    const page = await browser.newPage();
    // Extra-wide viewport to show all panels
    await page.setViewportSize({ width: 1600, height: 900 });
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);

    await setEditorText(page, PROSE_LONG);

    // Select first paragraph to annotate
    const editor = page.locator("#editor-document .cm-content");
    await editor.click();
    await editor.click({ clickCount: 3 });
    await page.waitForTimeout(100);

    await page.evaluate(() => {
        const cmEditor = document.querySelector(".cm-editor") as HTMLElement & {
            [key: string | symbol]: unknown;
        };
        if (!cmEditor) return;
        const viewSymbol = Object.getOwnPropertySymbols(cmEditor).find(
            (s) => s.toString() === "Symbol(cmView)",
        );
        if (!viewSymbol) return;
        (window as unknown as Record<string, unknown>).__screenshot_selection__ = true;
    });

    // Mod-Alt-m is the keybinding for createCommentCommand (annotationKeymap)
    await page.keyboard.press("Meta+Alt+m");
    await page.waitForTimeout(500);

    await page.mouse.click(800, 700);
    await page.waitForTimeout(400);

    await shot(page, "full-ui");
    await page.close();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    await mkdir(OUT_DIR, { recursive: true });

    // Try connecting to an already-running server before launching one
    let server: ChildProcess | null = null;
    let serverAlreadyRunning = false;

    try {
        const res = await fetch(BASE_URL);
        if (res.ok || res.status === 304 || res.status === 200) {
            serverAlreadyRunning = true;
            console.log(`Using existing server at ${BASE_URL}`);
        }
    } catch {
        // Need to start one
    }

    if (!serverAlreadyRunning) {
        server = await startServer();
    }

    const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    try {
        console.log("\nCapturing screenshots…\n");

        await scenarioEditorDefault(browser);
        await scenarioEditorWithText(browser);
        await scenarioAiSidebarChat(browser);
        await scenarioAiSidebarFeedback(browser);
        await scenarioAnnotationsPanel(browser);
        await scenarioFullUi(browser);

        console.log(`\nDone. Screenshots saved to ./${OUT_DIR}/`);
    } finally {
        await browser.close();
        if (server) {
            server.kill();
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
