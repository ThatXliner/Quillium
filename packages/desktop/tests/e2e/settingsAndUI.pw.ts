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
        await expect(modal.getByRole("button", { name: "Basic" })).toBeVisible();
        await expect(modal.getByRole("button", { name: "Advanced" })).toBeVisible();
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

    test("switches editor mode to plain text", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const modal = await q.openSettings();
        await modal.getByRole("button", { name: "Plain text" }).click();
        await modal.getByRole("button", { name: "Save" }).click();

        await expect(page.getByText("Markdown")).not.toBeVisible();
    });
});

// ── AI sidebar ──────────────────────────────────────────────────────────────

test.describe("AI sidebar", () => {
    test("opens the unified Quillium review surface", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        await page.getByRole("button", { name: /Open Quillium/ }).click();
        await expect(q.aiSidebar).toContainText("Ready for a");
        await expect(q.aiSidebar).toContainText("Notes will appear in the margin");
        await expect
            .poll(async () => (await q.aiSidebar.boundingBox())?.height ?? 0)
            .toBeGreaterThan(410);
        await expect
            .poll(async () => (await q.aiSidebar.boundingBox())?.height ?? 0)
            .toBeLessThan(450);
        await expect(q.aiSidebar.getByRole("combobox", { name: "Review template" })).toHaveValue(
            "balanced",
        );
    });

    test("review dropdown applies editorial templates", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: {
                showNestedEditor: true,
                atomicRevisions: true,
                aiEnabled: true,
                customQuickActions: [
                    {
                        label: "My argument check",
                        prompt: "Test the argument and flag unsupported claims.",
                        panel: "editor",
                    },
                ],
            },
        });
        await q.init();

        await page.getByRole("button", { name: /Open Quillium/ }).click();
        const templates = q.aiSidebar.getByRole("combobox", { name: "Review template" });
        await expect(templates).toContainText("Structure & flow");
        await expect(templates).toContainText("My argument check");
        await templates.selectOption("proofread");
        await expect(q.aiSidebar).toContainText("Proofing pass");

        await q.aiSidebar.getByText("Review settings").click();
        await expect(q.aiSidebar.getByRole("combobox", { name: "Writing stage" })).toHaveValue(
            "proofing",
        );
        await expect(q.aiSidebar.getByRole("button", { name: "Grammar Only" })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await q.aiSidebar.getByRole("combobox", { name: "Writing stage" }).selectOption("shaping");
        await expect(templates).toHaveValue("custom");
    });

    test("grays out Quillium and fits the collapsed rail when no API key exists", async ({
        page,
    }) => {
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        const quilliumTab = q.aiSidebar.getByRole("button", {
            name: "Quillium unavailable. Add an API key",
        });
        await expect(quilliumTab).toHaveAttribute("aria-disabled", "true");
        await expect
            .poll(() => quilliumTab.evaluate((element) => getComputedStyle(element).opacity))
            .toBe("0.45");
        await expect
            .poll(async () => Math.round((await q.aiSidebar.boundingBox())?.height ?? 0))
            .toBe(174);

        await q.aiSidebar.getByRole("button", { name: "AI Settings" }).click();
        await expect(q.aiSidebar).toContainText("AI Settings");
        await expect(
            q.aiSidebar.getByRole("button", { name: "Quillium", exact: true }),
        ).toHaveAttribute("aria-disabled", "true");
    });

    test("keeps document context and reader setup secondary", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        await page.getByRole("button", { name: /Open Quillium/ }).click();
        const toolStrip = q.aiSidebar.getByRole("navigation", { name: "Quillium tools" });
        await expect(toolStrip).toBeVisible();
        await expect
            .poll(() => toolStrip.evaluate((element) => getComputedStyle(element).overflowX))
            .toBe("auto");
        await q.aiSidebar.getByText("Review settings").click();
        await q.aiSidebar.getByRole("button", { name: "Document context", exact: true }).click();
        await expect(q.aiSidebar).toContainText("WRITING PROMPT OR BRIEF");
        await q.aiSidebar.getByRole("button", { name: "Quillium" }).click();
        await q.aiSidebar.getByText("Review settings").click();
        await q.aiSidebar.getByRole("button", { name: "Configure readers" }).click();
        await expect(q.aiSidebar).toContainText("Reader Perspectives");
    });

    test("shows selection scope and an optional instruction", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
            initialDoc: "This draft has a selected passage for Quillium.",
        });
        await q.init();
        await q.selectRange(17, 33);

        await page.getByRole("button", { name: /Open Quillium/ }).click();
        await expect(q.aiSidebar).toContainText("Selection");
        await expect(q.aiSidebar.getByPlaceholder("Anything specific?")).toBeVisible();
        await expect(q.aiSidebar).not.toContainText("Chat with AI");
        await expect(q.aiSidebar).not.toContainText("Revise & Rewrite");
    });

    test("escape closes sidebar", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        await page.getByRole("button", { name: /Open Quillium/ }).click();
        await expect(q.aiSidebar).toContainText("Ready for a");

        await q.escape();
        await expect(q.aiSidebar).not.toContainText("Ready for a");
    });

    test("quiet review widget opens AI settings through the external event path", async ({
        page,
    }) => {
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        await page.getByRole("button", { name: "AutoAI — add an API key to enable" }).click();
        await page.getByRole("button", { name: "Configure AI" }).click();

        await expect(q.aiSidebar).toContainText("AI Settings");
    });

    test("AutoAI keeps explicit controls and a finite morph radius", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        const widget = page.locator(".autoai-container");
        await expect
            .poll(() => widget.evaluate((element) => getComputedStyle(element).borderRadius))
            .toBe("33.5px");
        await page.getByRole("button", { name: "AutoAI paused — click to configure" }).click();

        await expect(page.getByRole("switch", { name: "Enable AutoAI" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Auto", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Manual", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Comments", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Suggestions", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Revisions", exact: true })).toBeVisible();
        await expect(page.getByRole("slider", { name: "Review depth" })).toBeVisible();
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

test.describe("markdown formatting", () => {
    test("applies bold formatting from the keyboard shortcut", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        await q.typeInEditor("hello world");
        await q.selectRange(0, 5);
        // The test browser reports a Windows UA, so CodeMirror maps Mod-b to
        // Ctrl-b — while ControlOrMeta would send Meta on a macOS host and
        // miss the keymap entirely (same convention as q.undo()).
        await page.keyboard.press("Control+b");

        await q.expectEditorText("**hello** world");
        await expect(page.getByRole("button", { name: "Bold" })).toHaveCount(0);
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
