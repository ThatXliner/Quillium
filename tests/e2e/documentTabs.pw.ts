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
