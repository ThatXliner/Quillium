/**
 * scripts/screenshots.ts — Automated demo screenshot capture
 *
 * Starts the Vite preview server, seeds realistic content, stages
 * each UI scenario, and writes PNG files to screenshots/.
 *
 * Usage:
 *   bun run screenshots              # auto-start dev server on :4173 if needed
 *   bun run screenshots --no-server  # use already-running server on :1420 (tauri dev)
 *
 * Output: screenshots/
 *   editor-default.png
 *   editor-with-text.png
 *   ai-sidebar-chat.png
 *   ai-sidebar-feedback.png
 *   annotations-panel.png
 *   comment-thread.png
 *   revision-expanded.png
 *   full-ui.png
 */

import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";

// ── Config ────────────────────────────────────────────────────────────────────

const noServer = process.argv.includes("--no-server");
const BASE_URL = noServer ? "http://localhost:1420" : "http://localhost:4173";
const OUT_DIR = "screenshots";
const VIEWPORT = { width: 1440, height: 900 };
// 2× device scale factor for crisp retina-quality screenshots
const DEVICE_SCALE_FACTOR = 2;

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

            // Mutable saved state — updated by "save" so "load" returns the
            // latest value (needed for the scenario reload cycle).
            let savedState: string | null = payload.loadResponse;

            (window as unknown as Record<string, unknown>).__TAURI_MOCK__ = {
                invokeCalls,
            };

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
    await page.locator("#editor-document").waitFor({
        state: "attached",
        timeout: 15_000,
    });
    await page.locator("#editor-document .cm-editor").waitFor({
        state: "visible",
        timeout: 15_000,
    });
    await page.waitForTimeout(200);
}

/**
 * Replace all editor content with the given text by selecting all
 * and typing the replacement. Uses clipboard for speed on long text.
 */
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
 * Click text inside a CodeMirror annotation highlight to move the cursor
 * into that range, activating the annotation card.
 *
 * Finds the first `.cm-annotation` mark (or any decorated span) whose
 * text content contains the target substring and clicks it.
 */
async function clickAnnotatedText(page: Page, targetSubstring: string): Promise<void> {
    const clicked = await page.evaluate((target: string) => {
        // CodeMirror renders annotation highlights as spans inside .cm-content.
        // They may have class names like cm-annotation-comment, cm-annotation-revision, etc.
        const spans = Array.from(
            document.querySelectorAll<HTMLElement>(
                ".cm-content span[class*='cm-annotation'], .cm-content mark",
            ),
        );
        const match = spans.find((el) => el.textContent?.includes(target));
        if (match) {
            match.click();
            return true;
        }
        // Fallback: search all text nodes in cm-content
        const content = document.querySelector(".cm-content");
        if (!content) return false;
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
            if (node.textContent?.includes(target) && node.parentElement) {
                node.parentElement.click();
                return true;
            }
        }
        return false;
    }, targetSubstring);

    if (!clicked) {
        // Last resort: use the editor's find-text mechanism via CodeMirror
        await page.evaluate((target: string) => {
            const cmEl = document.querySelector(".cm-editor") as HTMLElement & {
                [k: string | symbol]: unknown;
            };
            if (!cmEl) return;
            const sym = Object.getOwnPropertySymbols(cmEl).find(
                (s) => s.toString() === "Symbol(cmView)",
            );
            if (!sym) return;
            const view = cmEl[sym] as {
                state: { doc: { toString(): string } };
                dispatch(tr: object): void;
            };
            const text = view.state.doc.toString();
            const pos = text.indexOf(target);
            if (pos !== -1) view.dispatch({ selection: { anchor: pos + 5 } });
        }, targetSubstring);
    }
}

/**
 * Apply a debug scenario by ID using the window.__runScenario__ bridge.
 *
 * The debug panel (available in dev/preview builds) exposes this global
 * after the editor mounts. Returns true if the scenario ran successfully.
 */
async function applyDebugScenario(page: Page, scenarioId: string): Promise<boolean> {
    // __runScenario__ is async — evaluate() can await a Promise returned
    // from the page context, so we return the promise directly.
    const ok = await page.evaluate(async (id: string) => {
        const fn = (window as unknown as Record<string, unknown>).__runScenario__;
        if (typeof fn !== "function") return false;
        return (fn as (id: string) => Promise<boolean>)(id);
    }, scenarioId);
    // Extra wait for setState + Svelte reactivity + annotation decorations to render
    if (ok) await page.waitForTimeout(800);
    return ok;
}

/**
 * Fallback annotation injection when the debug bridge isn't available.
 *
 * Selects the first paragraph via triple-click and fires the
 * Cmd+Alt+M shortcut to create a pending comment annotation.
 */
async function addFallbackAnnotation(page: Page): Promise<void> {
    const editor = page.locator("#editor-document .cm-content");
    await editor.click();
    await editor.click({ clickCount: 3 });
    await page.waitForTimeout(100);
    await page.keyboard.press("Meta+Alt+m");
    await page.waitForTimeout(600);
    await page.mouse.click(720, 800);
    await page.waitForTimeout(400);
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

async function startServer(): Promise<ChildProcess> {
    console.log("Starting dev server…");

    const server = spawn(
        "bun",
        ["run", "dev", "--", "--host", "localhost", "--port", "4173", "--strictPort"],
        {
            stdio: ["ignore", "pipe", "pipe"],
            detached: false,
        },
    );

    server.stdout?.on("data", (chunk: Buffer) => {
        process.stdout.write(`[server] ${chunk}`);
    });
    server.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[server] ${chunk}`);
    });

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
 *    AI sidebar in collapsed pill state.
 */
async function scenarioEditorDefault(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);

    await setEditorText(page, PROSE_SHORT);

    await page.mouse.click(720, 800);
    await page.waitForTimeout(200);

    await shot(page, "editor-default");
    await page.close();
}

/**
 * 2. editor-with-text — Longer fiction passage showing the full document
 *    card with shadow and the status bar.
 */
async function scenarioEditorWithText(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);

    await setEditorText(page, PROSE_LONG);

    await page.mouse.click(720, 800);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo({ top: 0 }));

    await shot(page, "editor-with-text");
    await page.close();
}

/**
 * 3. ai-sidebar-chat — AI sidebar open on the Chat tab (empty state).
 *    fakeApiKey=true so the panel opens instead of redirecting to settings.
 */
async function scenarioAiSidebarChat(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page, { fakeApiKey: true });
    await page.goto(BASE_URL);
    await waitForEditor(page);

    await setEditorText(page, PROSE_SHORT);

    // Open chat panel
    await page.locator("#ai-tab-chat").click({ force: true });
    await page.locator("#ai-sidebar").waitFor({ state: "visible" });
    await page.waitForTimeout(500);

    await shot(page, "ai-sidebar-chat");
    await page.close();
}

/**
 * 4. ai-sidebar-feedback — AI sidebar open on the Feedback tab (empty state).
 */
async function scenarioAiSidebarFeedback(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
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
        .click({ force: true })
        .catch(() => {});
    await page.waitForTimeout(300);

    await shot(page, "ai-sidebar-feedback");
    await page.close();
}

/**
 * 5. annotations-panel — Editor with prose and realistic annotation cards
 *    (comments, suggestion, revision) visible beside the document.
 *
 *    Uses the "mixed-annotations" debug scenario which seeds a comment,
 *    a suggestion, and a revision across the text. Falls back to a single
 *    keyboard-shortcut comment if the debug bridge isn't available.
 */
async function scenarioAnnotationsPanel(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);

    // The scenario sets its own doc (Dickens) via the reload cycle.
    // No need to paste text first — it will be overwritten.
    const applied = await applyDebugScenario(page, "screenshot-annotations");
    if (!applied) {
        await setEditorText(page, PROSE_LONG);
        await addFallbackAnnotation(page);
    }

    await page.mouse.click(720, 800);
    await page.waitForTimeout(600);

    await shot(page, "annotations-panel");
    await page.close();
}

/**
 * 7. comment-thread — A comment card in its active/expanded state with
 *    a realistic multi-message back-and-forth thread visible.
 *    Achieved by loading the scenario then clicking the highlighted
 *    text in the editor to move the cursor into the annotated range.
 */
async function scenarioCommentThread(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);

    const applied = await applyDebugScenario(page, "screenshot-comment-thread");
    if (!applied) {
        await setEditorText(page, PROSE_LONG);
        await addFallbackAnnotation(page);
    }

    // Click inside the highlighted (annotated) text in the editor to
    // move the cursor there, which sets it as the active annotation and
    // expands the thread in the card.
    await clickAnnotatedText(page, "it was the age of wisdom");
    await page.waitForTimeout(400);

    await shot(page, "comment-thread");
    await page.close();
}

/**
 * 8. revision-expanded — A revision card in its active state, showing
 *    version pills and the inline nested editor open with the version text.
 */
async function scenarioRevisionExpanded(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORT);
    await installTauriMock(page);
    await page.goto(BASE_URL);
    await waitForEditor(page);

    const applied = await applyDebugScenario(page, "screenshot-revision-active");
    if (!applied) {
        await setEditorText(page, PROSE_LONG);
        await addFallbackAnnotation(page);
    }

    // Click the revision's highlighted text to activate the card and
    // open the nested editor.
    await clickAnnotatedText(page, "Spiritual revelations were conceded");
    await page.waitForTimeout(600); // nested editor needs a moment to mount

    await shot(page, "revision-expanded");
    await page.close();
}

/**
 * 6. full-ui — All three panels simultaneously: AI sidebar expanded on
 *    the Chat tab (left), editor with text (centre), annotation cards
 *    (right). Uses a wider viewport so nothing is squeezed.
 */
async function scenarioFullUi(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    // Wide enough that editor + both sidebars are comfortably visible
    await page.setViewportSize({ width: 1600, height: 900 });
    await installTauriMock(page, { fakeApiKey: true });
    await page.goto(BASE_URL);
    await waitForEditor(page);

    // Seed annotations first (sets the doc too)
    const applied = await applyDebugScenario(page, "screenshot-annotations");
    if (!applied) {
        await setEditorText(page, PROSE_LONG);
        await addFallbackAnnotation(page);
    }

    // Now open the AI sidebar on the Chat tab
    await page.locator("#ai-tab-chat").click({ force: true });
    await page.locator("#ai-sidebar").waitFor({ state: "visible" });
    await page.waitForTimeout(500);

    // Deselect so no text is highlighted
    await page.mouse.click(900, 600);
    await page.waitForTimeout(300);

    await shot(page, "full-ui");
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
            throw new Error(
                `--no-server was set but no server is reachable at ${BASE_URL}`,
            );
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
            // Need to start one
        }

        if (!serverAlreadyRunning) {
            server = await startServer();
        }
    }

    const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    // Create a shared browser context with 2× device scale factor for
    // retina-quality screenshots (crisp text and UI at the saved size).
    const context = await browser.newContext({
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
    });

    try {
        console.log("\nCapturing screenshots…\n");

        await scenarioEditorDefault(context);
        await scenarioEditorWithText(context);
        await scenarioAiSidebarChat(context);
        await scenarioAiSidebarFeedback(context);
        await scenarioAnnotationsPanel(context);
        await scenarioCommentThread(context);
        await scenarioRevisionExpanded(context);
        await scenarioFullUi(context);

        console.log(`\nDone. Screenshots saved to ./${OUT_DIR}/`);
    } finally {
        await context.close();
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
