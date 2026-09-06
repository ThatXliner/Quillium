/**
 * E2E tests for the DocumentTabs feature (#160):
 *   - Tab bar renders on load
 *   - Creating a new tab via + button
 *   - Switching tabs calls cmd_set_active_tab
 *   - Renaming a tab via double-click
 *   - Closing a tab via × button
 */

import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test.describe("DocumentTabs", () => {
    test("tab bar renders the default tab on load", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const tablist = page.getByRole("tablist");
        await expect(tablist).toBeVisible();
        await expect(tablist.getByRole("tab", { name: "Main" })).toBeVisible();
    });

    test("clicking + creates a new tab and switches to it", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        await page.locator('button[aria-label="New tab"]').click();

        await expect(page.getByRole("tab")).toHaveCount(2, { timeout: 5_000 });
        await expect(page.getByRole("tab", { name: "Tab 2" })).toHaveAttribute(
            "aria-selected",
            "true",
            { timeout: 5_000 },
        );

        expect(await q.countInvocations("cmd_create_tab")).toBeGreaterThanOrEqual(1);
    });

    test("Command/Ctrl+T creates a new tab", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        await page.keyboard.press("ControlOrMeta+T");

        await expect(page.getByRole("tab")).toHaveCount(2, { timeout: 5_000 });
        expect(await q.countInvocations("cmd_create_tab")).toBeGreaterThanOrEqual(1);
    });

    test("clicking a non-active tab calls cmd_set_active_tab", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        // Create a second tab first (auto-switches to it)
        await page.locator('button[aria-label="New tab"]').click();
        await expect(page.getByRole("tab")).toHaveCount(2, { timeout: 5_000 });

        // Click back to the first tab
        const tabs = page.getByRole("tab");
        await tabs.nth(0).click();
        await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true", { timeout: 5_000 });

        expect(await q.countInvocations("cmd_set_active_tab")).toBeGreaterThanOrEqual(1);
    });

    test("double-clicking a tab label and pressing Enter renames it", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const tab = page.getByRole("tab", { name: "Main" });

        await tab.dblclick();
        const renameInput = page.locator('input[aria-label="Rename tab"]');
        await expect(renameInput).toBeVisible({ timeout: 5_000 });
        await renameInput.fill("My Doc");
        await page.keyboard.press("Enter");

        await expect(page.getByRole("tab", { name: "My Doc" })).toBeVisible({ timeout: 5_000 });

        expect(await q.countInvocations("cmd_rename_tab")).toBeGreaterThanOrEqual(1);
    });

    test("clicking × removes the tab", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        // Create a second tab so the first tab gets a close button
        await page.locator('button[aria-label="New tab"]').click();
        await expect(page.getByRole("tab")).toHaveCount(2, { timeout: 5_000 });

        // Hover the first tab to reveal the close button, then click it
        const firstTab = page.getByRole("tab").first();
        await firstTab.hover();
        const closeBtn = page.locator('[aria-label="Close tab"]').first();
        await expect(closeBtn).toBeVisible({ timeout: 2_000 });
        await closeBtn.click();

        await expect(page.getByRole("tab")).toHaveCount(1, { timeout: 5_000 });

        expect(await q.countInvocations("cmd_delete_tab")).toBeGreaterThanOrEqual(1);
    });
});

test("tab menu renames an inactive tab and closes it with Undo", async ({ page }, testInfo) => {
    const q = new QuilliumPage(page);
    await q.init();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    const main = page.getByRole("tab", { name: "Main", exact: true });
    await expect(main).toHaveAttribute("aria-selected", "false");
    await main.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Actions for Main" });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    const tabBox = await main.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(tabBox!.x);
    expect(box!.y).toBeGreaterThanOrEqual(tabBox!.y);
    await testInfo.attach("Tab context menu", {
        body: await page.screenshot(),
        contentType: "image/png",
    });
    await page.getByRole("menuitem", { name: "Rename tab" }).click();
    const input = page.getByRole("textbox", { name: "Rename tab" });
    await expect(input).toBeFocused();
    await input.fill("Notes");
    await input.press("Enter");
    const notes = page.getByRole("tab", { name: "Notes", exact: true });
    await expect(notes).toHaveAttribute("aria-selected", "false");
    expect(await q.countInvocations("cmd_rename_tab")).toBe(1);
    await notes.focus();
    await notes.press("Shift+F10");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(notes).toHaveCount(0);
    expect(await q.countInvocations("cmd_delete_tab")).toBe(1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(notes).toBeVisible();
    expect(await q.countInvocations("cmd_restore_tab")).toBe(1);
});

test("tab menu stays in the viewport and dismisses without selecting its tab", async ({ page }) => {
    const q = new QuilliumPage(page);
    await q.init();
    await page.setViewportSize({ width: 600, height: 500 });
    for (let i = 0; i < 5; i++) {
        await page.getByRole("button", { name: "New tab", exact: true }).click();
        await expect(page.getByRole("tab")).toHaveCount(i + 2);
    }
    const active = page.getByRole("tab", { name: "Tab 6", exact: true });
    await active.click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(8);
    expect(box!.x + box!.width).toBeLessThanOrEqual(592);
    expect(box!.y + box!.height).toBeLessThanOrEqual(492);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(active).toBeFocused();
    await active.press("Shift+F10");
    await page.mouse.click(580, 460);
    await expect(menu).toHaveCount(0);
    await expect(active).toHaveAttribute("aria-selected", "true");
});
