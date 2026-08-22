/**
 * scripts/changelog-shot.ts — Reproducible changelog-image harness
 *
 * Captures a focused, modal-sized PNG of a feature and writes it to
 * `static/changelog/<version>.png` so the "What's New" modal can load it
 * (anything under static/ is served at the web root, e.g.
 * `/changelog/0.20.png`).
 *
 * WHY THIS EXISTS
 * ---------------
 * When writing a changelog entry, an agent should NOT have to reinvent how
 * to boot the app, mock Tauri, seed realistic state, and crop a clean image
 * every release. That boilerplate is codified here once. The agent only
 * supplies the two ad-hoc decisions per release: WHICH scene to show and
 * WHAT to crop to. Everything else is reproducible.
 *
 * The Tauri mock and scene bridge mirror scripts/screenshots.ts (the proven
 * IPC contract the app expects in a non-Tauri browser). It is intentionally
 * duplicated rather than imported so changelog captures stay stable even when
 * the marketing-screenshot script is refactored.
 *
 * TWO WAYS TO USE IT
 * ------------------
 * 1. CLI (covers the common case — one built-in scene):
 *
 *      bun run changelog:shot --version 0.20 --scene authorship-playback
 *
 *    --scene values map to the SCENES map below. --crop is a CSS selector
 *    (the element's bounding box is captured, + optional --pad px); omit it
 *    to capture the full viewport. For full-screen scenes, the scene picks a
 *    compact viewport so a full capture has no dead space — override with
 *    --width/--height if needed. Use --no-server with `tauri dev` already
 *    running on :1420. Example with an element crop:
 *
 *      bun run changelog:shot --version 0.21 --scene editor \
 *          --crop "#editor-document" --pad 24
 *
 * 2. Helper API (when the scene needs custom steps the CLI scenes don't
 *    cover — write a tiny throwaway driver and delete it after):
 *
 *      import { boot, cropShot, shutdown } from "./changelog-shot";
 *      const h = await boot({ fakeApiKey: true });
 *      await applyDebugScenario(h.page, "screenshot-full-ui");
 *      await h.page.evaluate(() => (window as any).__goToAuthorship__());
 *      await h.page.locator(".provenance-scrubber").fill("6");
 *      await cropShot(h.page, { version: "0.20", crop: ".provenance-viewer", pad: 24 });
 *      await shutdown(h);
 *
 * Output is sized for the 480px-wide changelog modal: captured at
 * deviceScaleFactor 2 (crisp on retina), cropped to the feature, never the
 * whole 1440px app chrome.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { type Browser, type BrowserContext, type Page, chromium } from "@playwright/test";

// ── Config ──────────────────────────────────────────────────────────────────────

const SCREENSHOT_PORT = Number(process.env.SCREENSHOT_PORT) || 4173;
const VIEWPORT = { width: 1440, height: 900 };
const DEVICE_SCALE_FACTOR = 2;
/** Where the app can load images from — anything in static/ is served at "/". */
const OUT_DIR = "static/changelog";

const PROSE_SHORT =
    "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.";

// ── Authorship-playback mock data (mirrors screenshots.ts) ────────────────────────
//
// A curated provenance-stamped doc_change stream — replaying it rebuilds a
// short paragraph with a mix of origins (typed / paste / ai-revision) and an
// idle gap, giving the playback viewer a realistic, legible timeline.
function buildAuthorshipEvents() {
    const base = Date.now() - 1000 * 60 * 60 * 2;
    const steps: Array<[string, string, string | undefined, number]> = [
        ["The argument for ", "type", "input.type", 0],
        ["renewable energy ", "type", "input.type", 1400],
        ["rests on three ", "type", "input.type", 1700],
        ["pillars. ", "type", "input.type", 1500],
        [
            "As one widely cited report notes, “the transition to clean power is now the cheapest path to new electricity generation across two-thirds of the world.” ",
            "paste",
            "input.paste",
            1000 * 60 * 8,
        ],
        ["But cost alone ", "type", "input.type", 2100],
        ["does not settle ", "type", "input.type", 1600],
        ["the debate. ", "type", "input.type", 1500],
        [
            "Reliability, land use, and grid resilience each demand a closer look.",
            "ai-revision",
            undefined,
            4200,
        ],
    ];
    let pos = 0;
    let when = base;
    return steps.map(([text, origin, userEvent, gap], i) => {
        when += gap;
        const from = pos;
        pos += text.length;
        const payload = {
            type: "doc_change",
            changes: [{ from, to: from, insert: text }],
            selection: { ranges: [{ anchor: pos, head: pos }], main: 0 },
            provenance: { origin, userEvent, insertedChars: text.length, removedChars: 0 },
        };
        return {
            id: i + 1,
            eventType: "doc_change",
            payload: JSON.stringify(payload),
            createdAt: when,
        };
    });
}

const AUTHORSHIP_EVENTS = buildAuthorshipEvents();

// ── Tauri mock ────────────────────────────────────────────────────────────────────
//
// Faithful trim of scripts/screenshots.ts: just the IPC commands a single
// editor/playback scene exercises. If a new scene needs a command that returns
// null here, add it the same way it appears in screenshots.ts.

type TauriMockOptions = {
    fakeApiKey: boolean;
    /** When true, cmd_list_draft_events returns the AUTHORSHIP_EVENTS stream. */
    authorshipEvents: boolean;
    /** When true, cmd_list_tab_drafts/cmd_list_drafts return a multi-draft
     *  run + branch (0.22 resizable drafts panel demo) instead of one draft,
     *  and the panel opens pre-widened to its full-rail width. */
    draftPanelDemo: boolean;
};

/** A short iteration run plus one branch, with long enough labels to show
 *  why widening the drafts panel matters. Mirrors the shape layoutDraftRows
 *  expects: parentDraftId chains iterations flat, branchedFrom indents. */
function buildDraftPanelDemoDrafts(documentId: string, tabId: string) {
    const base = Date.now() - 1000 * 60 * 60;
    return [
        {
            id: "draft-0",
            documentId,
            label: "Café opening",
            createdAt: base,
            isActive: false,
            tabId,
            parentDraftId: null,
            branchedFrom: null,
            locked: false,
        },
        {
            // Kept as "draft-1" so it matches the mock's fixed cmd_get_active_draft return.
            id: "draft-1",
            documentId,
            label: "After Elena's edit",
            createdAt: base + 1000 * 60 * 20,
            isActive: true,
            tabId,
            parentDraftId: "draft-0",
            branchedFrom: null,
            locked: false,
        },
        {
            id: "draft-2",
            documentId,
            label: "Dog walker's take",
            createdAt: base + 1000 * 60 * 40,
            isActive: false,
            tabId,
            parentDraftId: null,
            branchedFrom: "draft-0",
            locked: false,
        },
    ];
}

async function installTauriMock(
    page: Page,
    options: Partial<TauriMockOptions> = {},
): Promise<void> {
    const fakeApiKey = options.fakeApiKey ?? false;
    const authorshipEvents = options.authorshipEvents ?? false;
    const draftPanelDemo = options.draftPanelDemo ?? false;
    const draftPanelDemoDrafts = draftPanelDemo
        ? buildDraftPanelDemoDrafts("doc-1", "tab-1")
        : null;

    await page.addInitScript(
        (payload: {
            fakeApiKey: boolean;
            authorshipEvents: boolean;
            authorshipEventsData: typeof AUTHORSHIP_EVENTS;
            draftPanelDemoDrafts: ReturnType<typeof buildDraftPanelDemoDrafts> | null;
        }) => {
            (window as unknown as Record<string, unknown>).__QUILLIUM_SCREENSHOT_AUTH_ONLINE__ =
                true;
            localStorage.setItem("quillium_tutorial_seen", "1");
            localStorage.setItem("quillium_beta_accepted", "true");
            // Suppress the real "What's New" modal so it never blocks the shot.
            localStorage.setItem("quillium_changelog_seen", "99.99");
            if (payload.fakeApiKey) localStorage.setItem("quillium-has-api-key", "1");
            document.addEventListener("DOMContentLoaded", () => {
                const style = document.createElement("style");
                style.textContent = "[aria-label='Open debug panel'] { display: none !important; }";
                document.head.appendChild(style);
            });
            localStorage.setItem(
                "quillium-app-settings",
                JSON.stringify({
                    docFontFamily: "Georgia, serif",
                    docFontSize: 18,
                    ...(payload.fakeApiKey ? { aiEnabled: true } : {}),
                    // Pre-widen the drafts panel toward its full-rail max (0.22 demo)
                    // so the resize handle and full-width toggle read clearly.
                    ...(payload.draftPanelDemoDrafts ? { draftPanelWidth: 280 } : {}),
                }),
            );

            let nextCallbackId = 1;
            const callbacks = new Map<number, (...args: unknown[]) => unknown>();
            let savedState: string | null = null;

            (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
                metadata: {
                    currentWindow: { label: "main" },
                    currentWebview: { windowLabel: "main", label: "main" },
                },
                invoke: async (cmd: string, args: unknown) => {
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
                    if (cmd === "cmd_list_documents") return [];
                    if (cmd === "cmd_list_trashed_documents") return [];
                    if (cmd === "cmd_get_trash_retention") return 30;
                    if (cmd === "cmd_purge_expired_trash") return 0;
                    if (cmd === "cmd_get_document") return null;
                    if (cmd === "cmd_create_document") return "doc-new";
                    if (cmd === "cmd_update_document_meta") return null;
                    if (cmd === "cmd_reset_db") {
                        savedState = null;
                        return null;
                    }
                    if (cmd === "cmd_register_open_doc") return null;
                    if (cmd === "cmd_deregister_open_doc") return null;
                    if (cmd === "cmd_list_drafts")
                        return (
                            payload.draftPanelDemoDrafts ?? [
                                {
                                    id: "draft-1",
                                    documentId: (args as { documentId: string }).documentId,
                                    label: "Main",
                                    createdAt: Date.now(),
                                    isActive: true,
                                    tabId: "tab-1",
                                    parentDraftId: null,
                                    branchedFrom: null,
                                    locked: false,
                                },
                            ]
                        );
                    if (cmd === "cmd_create_draft") return "draft-1";
                    if (cmd === "cmd_list_tabs")
                        return [
                            {
                                id: "tab-1",
                                documentId: (args as { docId: string }).docId,
                                tabType: "draft",
                                label: "Draft",
                                position: 0,
                                createdAt: Date.now(),
                            },
                        ];
                    if (cmd === "cmd_create_tab")
                        return {
                            id: "tab-1",
                            documentId: (args as { docId: string }).docId,
                            tabType: "draft",
                            label: "Draft",
                            position: 0,
                            createdAt: Date.now(),
                        };
                    if (cmd === "cmd_get_active_tab") return "tab-1";
                    if (cmd === "cmd_set_active_tab") return null;
                    if (cmd === "cmd_reorder_tabs") return null;
                    if (cmd === "cmd_list_tab_drafts")
                        return (
                            payload.draftPanelDemoDrafts ?? [
                                {
                                    id: "draft-1",
                                    documentId: "doc-1",
                                    label: "Main",
                                    createdAt: Date.now(),
                                    isActive: true,
                                    tabId: (args as { tabId: string }).tabId,
                                    parentDraftId: null,
                                    branchedFrom: null,
                                    locked: false,
                                },
                            ]
                        );
                    if (cmd === "cmd_get_active_draft") return "draft-1";
                    if (cmd === "cmd_set_active_draft") return null;
                    if (cmd === "cmd_list_doc_events") return [];
                    if (cmd === "cmd_append_event")
                        return { eventId: Math.floor(Math.random() * 100000) };
                    if (cmd === "cmd_create_snapshot") {
                        savedState = (args as { stateJson: string }).stateJson;
                        return null;
                    }
                    if (cmd === "cmd_load_document_state")
                        return { snapshotStateJson: savedState, eventsSince: [] };
                    if (cmd === "cmd_list_draft_events")
                        return payload.authorshipEvents ? payload.authorshipEventsData : [];
                    if (cmd === "cmd_list_snapshots") return [];
                    if (cmd === "cmd_load_snapshot_state") return savedState;
                    if (cmd === "cmd_get_snapshot_retention") return null;
                    if (cmd === "cmd_get_snapshot_storage_size") return 524288;
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
        {
            fakeApiKey,
            authorshipEvents,
            authorshipEventsData: AUTHORSHIP_EVENTS,
            draftPanelDemoDrafts,
        },
    );
}

// ── Editor + scene bridges (DEV globals exposed by the app) ───────────────────────

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
 * Run a debug scenario via window.__runScenario__ (DEV bridge in +page.svelte).
 * `scenarioId` is one of the "screenshot-*" ids in src/lib/debug/scenarios.ts.
 * Exported so helper-API drivers can seed arbitrary state.
 */
export async function applyDebugScenario(page: Page, scenarioId: string): Promise<boolean> {
    const ok = await page.evaluate(async (id: string) => {
        const fn = (window as unknown as Record<string, unknown>).__runScenario__;
        if (typeof fn !== "function") return false;
        return (fn as (id: string) => Promise<boolean>)(id);
    }, scenarioId);
    if (ok) await page.waitForTimeout(1200);
    return ok;
}

// ── Harness lifecycle ─────────────────────────────────────────────────────────────

export type Harness = {
    page: Page;
    context: BrowserContext;
    browser: Browser;
    server: ChildProcess | null;
    baseUrl: string;
};

export type BootOptions = {
    /** Use an already-running `tauri dev` server on :1420 instead of starting one. */
    noServer?: boolean;
    fakeApiKey?: boolean;
    authorshipEvents?: boolean;
    draftPanelDemo?: boolean;
    /**
     * Viewport size. Defaults to 1440×900. Full-screen scenes (e.g. the
     * authorship viewer) render to fill the viewport, so a shorter height
     * here removes dead whitespace from a full-viewport capture.
     */
    viewport?: { width: number; height: number };
};

/** Start (or reuse) the dev server, launch a mocked page, and return to the app shell. */
export async function boot(options: BootOptions = {}): Promise<Harness> {
    const baseUrl = options.noServer
        ? "http://localhost:1420"
        : `http://localhost:${SCREENSHOT_PORT}`;

    let server: ChildProcess | null = null;
    if (options.noServer) {
        await pollUntilReady(baseUrl, 3_000).catch(() => {
            throw new Error(`--no-server set but no server reachable at ${baseUrl}`);
        });
        console.log(`Using existing server at ${baseUrl}`);
    } else {
        const running = await isViteDevServer(baseUrl);
        if (running) console.log(`Using existing dev server at ${baseUrl}`);
        else server = await startServer(baseUrl);
    }

    const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const viewport = options.viewport ?? VIEWPORT;
    const context = await browser.newContext({ deviceScaleFactor: DEVICE_SCALE_FACTOR });
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    await installTauriMock(page, {
        fakeApiKey: options.fakeApiKey,
        authorshipEvents: options.authorshipEvents,
        draftPanelDemo: options.draftPanelDemo,
    });
    await page.goto(baseUrl);
    return { page, context, browser, server, baseUrl };
}

export async function shutdown(h: Harness): Promise<void> {
    await h.context.close();
    await h.browser.close();
    if (h.server) h.server.kill();
}

// ── Cropping + capture ────────────────────────────────────────────────────────────

export type CropShotOptions = {
    /** Version key, e.g. "0.20" — output goes to static/changelog/<version>.png. */
    version: string;
    /** CSS selector to frame; omit to capture the full viewport. */
    crop?: string;
    /** Extra padding (px, pre-scale) around the cropped element. Default 0. */
    pad?: number;
};

/**
 * Capture a modal-sized PNG of the current page state. With `crop`, screenshots
 * just that element's bounding box (+ `pad`); without it, the full viewport.
 * Writes to static/changelog/<version>.png and returns the web path.
 */
export async function cropShot(page: Page, options: CropShotOptions): Promise<string> {
    await mkdir(OUT_DIR, { recursive: true });
    const filePath = `${OUT_DIR}/${options.version}.png`;

    let bytes: Buffer;
    if (options.crop) {
        const el = page.locator(options.crop).first();
        await el.waitFor({ state: "visible", timeout: 10_000 });
        const pad = options.pad ?? 0;
        if (pad > 0) {
            const box = await el.boundingBox();
            if (!box) throw new Error(`No bounding box for selector: ${options.crop}`);
            const clip = {
                x: Math.max(0, box.x - pad),
                y: Math.max(0, box.y - pad),
                width: Math.min(VIEWPORT.width, box.width + pad * 2),
                height: box.height + pad * 2,
            };
            bytes = await page.screenshot({ clip });
        } else {
            bytes = await el.screenshot();
        }
    } else {
        bytes = await page.screenshot({ fullPage: false });
    }

    await writeFile(filePath, bytes);
    const webPath = `/changelog/${options.version}.png`;
    console.log(`  ✓ ${filePath}  (embed as: ![…](${webPath}))`);
    return webPath;
}

// ── Built-in scenes (the --scene values) ──────────────────────────────────────────
//
// Each scene leaves the page in a captureable state. Add a scene here when a
// feature recurs across releases; for one-off shots use the helper API instead.

type Scene = (page: Page) => Promise<void>;

/**
 * Turn on a gated feature for this page. Flags fail closed in the app, so a
 * scene behind one captures the unavailable state without this.
 */
async function enableFeatureFlag(page: Page, flag: string): Promise<void> {
    const enabled = await page.evaluate(async (key) => {
        const { default: posthog } = await import("/src/lib/posthog.ts");
        posthog.init("phc_changelog_shot", {
            api_host: "http://127.0.0.1:9",
            disable_session_recording: true,
        });
        posthog.featureFlags.override({ [key]: true }, true);
        return posthog.getFeatureFlag(key) === true;
    }, flag);
    if (!enabled) throw new Error(`Unable to enable the ${flag} changelog-shot flag`);
    await page.waitForTimeout(500);
}

const SCENES: Record<string, { needs: BootOptions; run: Scene }> = {
    /** The writing-provenance playback viewer mid-scrub (0.20 authorship feature). */
    "authorship-playback": {
        // Narrow + short viewport so the capture is squarish, not a wide
        // letterbox, and the document card (min-h-full) hugs its content
        // instead of leaving dead space below the sample paragraph.
        needs: { authorshipEvents: true, viewport: { width: 900, height: 470 } },
        run: async (page) => {
            await waitForEditor(page);
            // Seed currentDocumentId/currentDraftId via the real scenario flow,
            // then client-navigate so those stores survive (goto would reset them).
            await applyDebugScenario(page, "screenshot-full-ui");
            await enableFeatureFlag(page, "authorship-provenance");
            await page.evaluate(() => {
                (window as unknown as { __goToAuthorship__?: () => void }).__goToAuthorship__?.();
            });
            await page.locator("text=Authorship Playback").first().waitFor({ timeout: 10_000 });
            const scrubber = page.locator(".provenance-scrubber");
            await scrubber.waitFor({ timeout: 10_000 });
            await scrubber.fill("6");
            await page.waitForTimeout(700);
        },
    },

    /** Clean editor on sample prose — a generic fallback scene. */
    editor: {
        needs: {},
        run: async (page) => {
            await waitForEditor(page);
            await setEditorText(page, PROSE_SHORT);
            await page.mouse.click(720, 800);
            await page.waitForTimeout(300);
        },
    },

    /** Editor showing a markdown thematic break rendered as a horizontal rule
        (0.21). Cursor is clicked off the divider line so the `---` renders as a
        rule rather than revealing its raw markers. */
    "horizontal-rule": {
        // Compact viewport so the centered document card hugs its content and a
        // #editor-document crop has little dead space above/below the sections.
        needs: { viewport: { width: 1000, height: 540 } },
        run: async (page) => {
            await waitForEditor(page);
            await setEditorText(
                page,
                "# The Argument\n\nRenewable energy rests on three pillars: cost, reliability, and resilience. Each has moved decisively in its favor over the past decade.\n\n---\n\n# The Cost\n\nThe cheapest path to new electricity is now also the cleanest across two-thirds of the world.",
            );
            // Click well below the text so the caret leaves the divider line and
            // the rule renders instead of its raw `---` markers.
            await page.mouse.click(500, 500);
            await page.waitForTimeout(400);
        },
    },

    /** Editor with a revision card open (version pills + nested editor). */
    "revision-active": {
        needs: {},
        run: async (page) => {
            await waitForEditor(page);
            const ok = await applyDebugScenario(page, "screenshot-revision-active");
            if (!ok) await setEditorText(page, PROSE_SHORT);
            await page.waitForTimeout(600);
        },
    },

    /** The resizable drafts panel (0.22): a run + branch with long labels,
        pre-widened toward its full-rail max so the drag handle and
        full-width toggle read clearly. Crop with:
          --crop "div:has(> .draft-panel-resize-controls)" --pad 16 */
    "drafts-panel-resize": {
        needs: { draftPanelDemo: true, viewport: { width: 1440, height: 700 } },
        run: async (page) => {
            await waitForEditor(page);
            await setEditorText(page, PROSE_SHORT);
            const controls = page.locator(".draft-panel-resize-controls");
            await controls.waitFor({ timeout: 10_000 });
            // The resize handle and full-width toggle only reveal on hover/focus.
            await controls.hover();
            await page.waitForTimeout(400);
        },
    },
};

// ── Server lifecycle ──────────────────────────────────────────────────────────────

async function startServer(baseUrl: string): Promise<ChildProcess> {
    console.log("Starting dev server…");
    const server = spawn(
        "bun",
        [
            "run",
            "dev",
            "--",
            "--host",
            "localhost",
            "--port",
            String(SCREENSHOT_PORT),
            "--strictPort",
        ],
        {
            stdio: ["ignore", "pipe", "pipe"],
            detached: false,
            env: {
                ...process.env,
                PUBLIC_RELAY_URL: process.env.PUBLIC_RELAY_URL || "ws://localhost:1234",
            },
        },
    );
    server.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[server] ${chunk}`));
    server.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[server] ${chunk}`));
    await pollUntilReady(baseUrl);
    console.log("Server ready.");
    return server;
}

async function isViteDevServer(baseUrl: string): Promise<boolean> {
    try {
        const res = await fetch(baseUrl);
        if (!(res.ok || res.status === 304)) return false;
        const dev = await fetch(`${baseUrl}/@vite/client`).catch(() => null);
        return Boolean(dev?.ok);
    } catch {
        return false;
    }
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

// ── CLI ───────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
    const out: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
            out[key] = next;
            i++;
        } else {
            out[key] = true;
        }
    }
    return out;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const version = args.version as string | undefined;
    const sceneName = args.scene as string | undefined;

    if (!version || !sceneName) {
        console.error(
            `Usage: bun scripts/changelog-shot.ts --version <x.y> --scene <name> [--crop <selector>] [--pad <px>] [--width <px>] [--height <px>] [--no-server]

Available scenes: ${Object.keys(SCENES).join(", ")}
  --crop          CSS selector to frame (omit = full viewport)
  --width/--height override the scene's viewport (trims dead space on full-screen scenes)

For a custom scene, import { boot, cropShot, shutdown } from this file.`,
        );
        process.exit(1);
    }
    const scene = SCENES[sceneName];
    if (!scene) {
        console.error(`Unknown scene "${sceneName}". Available: ${Object.keys(SCENES).join(", ")}`);
        process.exit(1);
    }

    // --width/--height override the scene's viewport (handy for tuning the crop
    // of a full-screen scene without editing the SCENES map).
    const viewport =
        args.width || args.height
            ? {
                  width: args.width ? Number(args.width) : (scene.needs.viewport?.width ?? 1440),
                  height: args.height ? Number(args.height) : (scene.needs.viewport?.height ?? 900),
              }
            : scene.needs.viewport;

    const h = await boot({
        ...scene.needs,
        viewport,
        noServer: Boolean(args["no-server"]),
    });
    try {
        await scene.run(h.page);
        await cropShot(h.page, {
            version,
            crop: args.crop as string | undefined,
            pad: args.pad ? Number(args.pad) : undefined,
        });
    } finally {
        await shutdown(h);
    }
}

// Only run the CLI when invoked directly, not when imported as a helper module.
if (import.meta.main) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
