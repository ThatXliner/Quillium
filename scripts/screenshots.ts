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
 */

import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";

// ── Config ────────────────────────────────────────────────────────────────────

const noServer = process.argv.includes("--no-server");
const BASE_URL = noServer ? "http://localhost:1420" : "http://localhost:4173";
const OUT_DIR = "screenshots";
const VIEWPORT = { width: 1440, height: 900 };
const DEVICE_SCALE_FACTOR = 2;

// ── Content ───────────────────────────────────────────────────────────────────

// Public domain — opening of A Tale of Two Cities (Dickens)
const PROSE_SHORT =
    "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.";

// ── Tauri mock ────────────────────────────────────────────────────────────────

type TauriMockOptions = {
    loadResponse: string | null;
    fakeApiKey: boolean;
};

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
    if (ok) await page.waitForTimeout(800);
    return ok;
}

/**
 * Place the CodeMirror cursor inside the first occurrence of targetText,
 * activating the annotation card whose range covers that position.
 */
async function activateAnnotation(page: Page, targetText: string): Promise<void> {
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
            focus(): void;
        };
        const pos = view.state.doc.toString().indexOf(target);
        if (pos === -1) return;
        // Place cursor mid-word so it falls squarely inside the annotation range
        view.focus();
        view.dispatch({ selection: { anchor: pos + Math.floor(target.length / 2) } });
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

// ── Screenshot helper ─────────────────────────────────────────────────────────

async function shot(page: Page, name: string): Promise<void> {
    const path = `${OUT_DIR}/${name}.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`  ✓ ${path}`);
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
    await page.locator("#ai-tab-feedback").click({ force: true });
    await page.locator("#ai-sidebar").waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    await page
        .locator("#ai-sidebar .overflow-x-auto button[aria-label='Feedback']")
        .click({ force: true })
        .catch(() => {});
    await page.waitForTimeout(300);
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
        console.log(`\nDone. Screenshots saved to ./${OUT_DIR}/`);
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
