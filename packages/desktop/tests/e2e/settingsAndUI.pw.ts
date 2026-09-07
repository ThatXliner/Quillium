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

    test("previews appearance, cancels without saving, and persists on Save", async ({ page }) => {
        const q = new QuilliumPage(page, { settings: { docFontSize: 18 } });
        await q.init();
        const persisted = await page.evaluate(() => localStorage.getItem("quillium-app-settings"));
        let modal = await q.openSettings();
        const fontSize = () =>
            modal
                .locator(".setting-row")
                .filter({
                    has: page.locator(".setting-title", { hasText: /^Font size$/ }),
                })
                .getByRole("slider");
        await fontSize().fill("22");
        await expect(page.locator("html")).toHaveCSS("--doc-font-size", "22px");
        expect(await page.evaluate(() => localStorage.getItem("quillium-app-settings"))).toBe(
            persisted,
        );
        await modal.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(page.locator("html")).toHaveCSS("--doc-font-size", "18px");
        expect(await page.evaluate(() => localStorage.getItem("quillium-app-settings"))).toBe(
            persisted,
        );

        modal = await q.openSettings();
        await fontSize().fill("21");
        await modal.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("html")).toHaveCSS("--doc-font-size", "21px");
        expect(
            await page.evaluate(
                () => JSON.parse(localStorage.getItem("quillium-app-settings") ?? "{}").docFontSize,
            ),
        ).toBe(21);
        q.expectNoPageErrors();
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

test("annotation panel previews a drag and saves only on release", async ({ page }) => {
    await page.setViewportSize({ width: 2000, height: 900 });
    const q = new QuilliumPage(page, {
        settings: { annotationLayout: "single", annotationPanelWidth: 280 },
        initialDoc: "A sentence with a comment.",
    });
    await q.init();
    await q.selectRange(0, 10);
    await q.createComment();
    await q.submitComment("A note.");
    const handle = page.getByRole("separator", { name: "Resize annotations panel" });
    const panel = page.locator(".annotation-scroll-container");
    await expect(panel).toHaveCSS("width", "280px");
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const storedWidth = () =>
        page.evaluate(
            () =>
                JSON.parse(localStorage.getItem("quillium-app-settings") ?? "{}")
                    .annotationPanelWidth,
        );
    // Only the inner edge of the handle is inside the scroll container clip.
    await page.mouse.move(box!.x + 1, box!.y + 30);
    await page.mouse.down();
    await expect(handle).toHaveClass(/is-resizing/);
    await page.mouse.move(box!.x + 41, box!.y + 30);
    await expect(panel).toHaveCSS("width", "320px");
    expect(await storedWidth()).toBe(280);
    await page.mouse.up();
    expect(await storedWidth()).toBe(320);
    q.expectNoPageErrors();
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
        await expect
            .poll(async () => (await q.aiSidebar.boundingBox())?.height ?? 0)
            .toBeGreaterThan(580);
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
        await expect
            .poll(async () => (await q.aiSidebar.boundingBox())?.height ?? 0)
            .toBeGreaterThan(580);

        // Switch to feedback
        const feedbackBtn = page.locator(
            "#ai-sidebar .overflow-x-auto button[aria-label*='Feedback']",
        );
        await feedbackBtn.click();
        await expect(q.aiSidebar).toContainText("Feedback");
        await expect
            .poll(async () => (await q.aiSidebar.boundingBox())?.height ?? 0)
            .toBeGreaterThan(580);

        // Switch to revise
        const reviseBtn = page.locator("#ai-sidebar .overflow-x-auto button[aria-label*='Revise']");
        await reviseBtn.click();
        await expect(q.aiSidebar).toContainText("Revise");
        await expect
            .poll(async () => (await q.aiSidebar.boundingBox())?.height ?? 0)
            .toBeGreaterThan(580);
    });

    test("shows typed outline and exact-compression recipes", async ({ page }) => {
        const draft = "One two three four five six seven eight nine ten eleven twelve.";
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
            initialDoc: draft,
        });
        await q.init();

        await page.locator("#ai-tab-chat").click();
        await expect(q.aiSidebar.getByRole("button", { name: /Reverse outline/ })).toBeVisible();

        await q.selectRange(0, draft.length);
        await page.locator("#ai-sidebar .overflow-x-auto button[aria-label*='Revise']").click();
        await expect(q.aiSidebar.getByRole("button", { name: /Cut to 9 words/ })).toBeVisible();
        await expect(q.aiSidebar).toContainText("Exact target from 12 words");
    });

    test("saves and restores document editorial decisions", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
            initialDoc: "A draft with an intentionally unresolved ending.",
        });
        await q.init();

        await page.locator("#ai-tab-context").click();
        const decisionInput = q.aiSidebar.getByLabel("New editorial decision");
        await decisionInput.fill("Keep the ending unresolved.");
        await decisionInput.press("Enter");
        await expect(q.aiSidebar.getByText("Keep the ending unresolved.")).toBeVisible();

        await expect
            .poll(() =>
                page.evaluate(() => localStorage.getItem("mock-editorial-decisions:doc-test-1")),
            )
            .toBe('["Keep the ending unresolved."]');

        await page.reload();
        await expect(q.editor).toBeVisible({ timeout: 40_000 });
        await page.locator("#ai-tab-context").click();
        await expect(q.aiSidebar.getByText("Keep the ending unresolved.")).toBeVisible();

        await q.aiSidebar
            .getByRole("button", { name: "Remove decision: Keep the ending unresolved." })
            .click();
        await expect(q.aiSidebar.getByText("No decisions saved yet.")).toBeVisible();
    });

    test("hides starter suggestions after first chat action", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: {
                showNestedEditor: true,
                atomicRevisions: true,
                aiEnabled: true,
                customQuickActions: [
                    { panel: "chat", label: "Make punchy", prompt: "Make this punchier" },
                ],
            },
            initialDoc: "A short draft with enough context for the AI sidebar.",
        });
        await q.init();

        await page.locator("#ai-tab-chat").click();
        await expect(q.aiSidebar).not.toContainText("AI can see this draft");
        await expect(
            q.aiSidebar.getByRole("button", { name: /Context: AI can see this draft/ }),
        ).toBeVisible();
        await expect(q.aiSidebar).toContainText("Your custom chips");
        await expect(q.aiSidebar).toContainText("Make punchy");

        await q.aiSidebar.getByRole("button", { name: /Reverse outline/ }).click();

        await expect(q.aiSidebar).not.toContainText("Reverse outline");
        await expect(q.aiSidebar).not.toContainText("Find missing context");
        await expect(q.aiSidebar).not.toContainText("Make punchy");
        await expect(q.aiSidebar.getByRole("button", { name: "Actions" })).toBeVisible();
        await expect(q.aiSidebar.getByRole("button", { name: "New chat" })).toBeVisible();
    });

    test("custom chip settings link opens quick actions", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: {
                showNestedEditor: true,
                atomicRevisions: true,
                aiEnabled: true,
                customQuickActions: [
                    { panel: "chat", label: "Make punchy", prompt: "Make this punchier" },
                ],
            },
            initialDoc: "A short draft with enough context for the AI sidebar.",
        });
        await q.init();

        await page.locator("#ai-tab-chat").click();
        await q.aiSidebar.getByRole("button", { name: "Edit in settings" }).click();

        const settingsModal = page.locator(".settings-modal-inner");
        await expect(settingsModal).toBeVisible();
        await expect(settingsModal).toContainText("Quick Actions");
        await expect(settingsModal).toContainText("Make punchy");
    });

    test("uses context lens instead of selection banner", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
            initialDoc: "This draft has a selected passage for the AI sidebar.",
        });
        await q.init();
        await q.selectRange(17, 33);

        await page.locator("#ai-tab-chat").click();

        await expect(q.aiSidebar).toContainText("AI can see your selection");
        await expect(q.aiSidebar).not.toContainText("Context:");
    });

    test("keeps draft notes context collapsed by default", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();
        await q.createCommentOnRange("This draft has a note for the AI sidebar.", 17, 21);
        await q.submitComment("Remember this note.");
        await q.editor.click();
        await q.end();

        await page.locator("#ai-tab-chat").click();

        await expect(q.aiSidebar).not.toContainText("AI can see this draft");
        await expect(q.aiSidebar).toContainText("Prioritize notes");
        await expect(
            q.aiSidebar.getByRole("button", {
                name: /Context: AI can see this draft.*Open annotations are included too/,
            }),
        ).toBeVisible();
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

    test("AutoAI widget opens AI settings through the external event path", async ({ page }) => {
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        await page.getByRole("button", { name: "AutoAI — add an API key to enable" }).click();
        await page.getByRole("button", { name: "Add an API key", exact: true }).click();

        await expect(q.aiSidebar).toContainText("AI Settings");
    });

    test("editorial approach preferences persist across reloads", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: "test-key",
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        await page.getByRole("button", { name: "AI Settings", exact: true }).click();
        await expect(q.aiSidebar.getByText("Editorial approach", { exact: true })).toBeVisible();

        const stance = q.aiSidebar.getByLabel("Stance");
        const density = q.aiSidebar.getByLabel("Feedback density");
        const voice = q.aiSidebar.getByLabel("Voice latitude");

        await expect(stance).toHaveValue("author-first");
        await expect(density).toHaveValue("focused");
        await expect(voice).toHaveValue("preserve");

        await stance.selectOption("exploratory");
        await density.selectOption("thorough");
        await voice.selectOption("transform");

        await expect
            .poll(() =>
                page.evaluate(() =>
                    JSON.parse(localStorage.getItem("quillium-ai-editorial-preferences") ?? "null"),
                ),
            )
            .toEqual({
                stance: "exploratory",
                feedbackDensity: "thorough",
                voiceLatitude: "transform",
            });

        await page.reload();
        await expect(q.editor).toBeVisible({ timeout: 40_000 });
        await page.getByRole("button", { name: "AI Settings", exact: true }).click();

        await expect(q.aiSidebar.getByLabel("Stance")).toHaveValue("exploratory");
        await expect(q.aiSidebar.getByLabel("Feedback density")).toHaveValue("thorough");
        await expect(q.aiSidebar.getByLabel("Voice latitude")).toHaveValue("transform");
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
