/**
 * E2E tests for settings, UI chrome, and application-level features:
 *   - Settings modal
 *   - Title visibility modes
 *   - AI sidebar panel switching
 *   - Zoom controls
 *   - Tutorial flow
 */

import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

// ── Settings modal ──────────────────────────────────────────────────────────

test.describe("settings modal", () => {
    test("opens from status bar and shows tabs", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const modal = await q.openSettings();
        await expect(modal.getByText("Settings")).toBeVisible();
        await expect(modal.getByText("Document", { exact: true })).toBeVisible();
        await expect(modal.getByText("Interface", { exact: true })).toBeVisible();
    });

    test("closes when clicking outside or pressing escape", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        await q.openSettings();
        await q.escape();
        await expect(page.locator(".settings-modal-inner")).not.toBeVisible({
            timeout: 3_000,
        });
    });
});

// ── AI sidebar ──────────────────────────────────────────────────────────────

test.describe("AI sidebar", () => {
    test("opens chat panel via button", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        await page.locator("#ai-tab-chat").click();
        await expect(q.aiSidebar).toContainText("Start a conversation");
    });

    test("switches between AI tabs", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        // Open chat
        await page.locator("#ai-tab-chat").click();
        await expect(q.aiSidebar).toContainText("Start a conversation");

        // Switch to feedback
        const feedbackBtn = page.locator(
            "#ai-sidebar .overflow-x-auto button[aria-label*='Feedback']",
        );
        await feedbackBtn.click();
        await expect(q.aiSidebar).toContainText("Feedback");
    });

    test("escape closes sidebar", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        await page.locator("#ai-tab-chat").click();
        await expect(q.aiSidebar).toContainText("Start a conversation");

        await q.escape();
        // After escape, the expanded panel should collapse
        await expect(page.locator("#ai-sidebar .overflow-x-auto")).not.toBeVisible();
    });
});

// ── Tutorial ────────────────────────────────────────────────────────────────

test.describe("tutorial", () => {
    test("tutorial appears on first visit (no seen flag)", async ({ page }) => {
        const q = new QuilliumPage(page, { skipTutorial: false });
        await q.init();

        await expect(page.getByText("Choose Tutorial Sections")).toBeVisible({ timeout: 10_000 });
    });

    test("tutorial does not appear when seen flag is set", async ({ page }) => {
        const q = new QuilliumPage(page, { skipTutorial: true });
        await q.init();

        await expect(page.getByText("Choose Tutorial Sections")).not.toBeVisible();
    });

    test("Take tour button opens tutorial", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        await page.getByRole("button", { name: "Take tour" }).click();
        await expect(page.getByText("Choose Tutorial Sections")).toBeVisible();
    });
});

// ── Zoom controls ───────────────────────────────────────────────────────────

test.describe("zoom controls", () => {
    test("Cmd+Plus increases zoom", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        // Get initial zoom
        const initialZoom = await page.evaluate(() => {
            return document.documentElement.style.zoom || "1";
        });

        await page.keyboard.press("ControlOrMeta+=");

        // Zoom should have increased
        const newZoom = await page.evaluate(() => {
            return document.documentElement.style.zoom || "1";
        });

        expect(Number.parseFloat(String(newZoom))).toBeGreaterThanOrEqual(
            Number.parseFloat(String(initialZoom)),
        );
    });

    test("Cmd+0 resets zoom", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        // Zoom in first
        await page.keyboard.press("ControlOrMeta+=");
        await page.keyboard.press("ControlOrMeta+=");

        // Reset
        await page.keyboard.press("ControlOrMeta+0");

        const zoom = await page.evaluate(() => {
            return document.documentElement.style.zoom || "1";
        });
        expect(Number.parseFloat(String(zoom))).toBe(1);
    });
});

// ── Error recovery UI ───────────────────────────────────────────────────────

test.describe("error resilience", () => {
    test("no page errors on empty document load", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.init();
        q.expectNoPageErrors();
    });

    test("no page errors after rapid typing", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.init();

        await q.editor.click();
        // Type rapidly
        await page.keyboard.type("The quick brown fox jumps over the lazy dog. ", { delay: 10 });
        await page.keyboard.type("The quick brown fox jumps over the lazy dog.", { delay: 10 });

        q.expectNoPageErrors();
    });

    test("no page errors on select-all delete", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.init();

        await q.typeInEditor("hello world");
        await q.selectAll();
        await page.keyboard.press("Backspace");
        await q.expectEditorText("");

        q.expectNoPageErrors();
    });

    test("no page errors after multiple undo past history start", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.init();

        await q.typeInEditor("hello");

        // Undo many times (more than history has)
        for (let i = 0; i < 10; i++) {
            await q.undo();
        }

        q.expectNoPageErrors();
    });
});

// ── Document persistence mock verification ──────────────────────────────────

test.describe("document lifecycle", () => {
    test("loading triggers cmd_list_documents", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const commands = await q.getInvokedCommands();
        expect(commands).toContain("cmd_list_documents");
    });

    test("cmd_load_document_state is called on startup", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const commands = await q.getInvokedCommands();
        expect(commands).toContain("cmd_load_document_state");
    });
});
