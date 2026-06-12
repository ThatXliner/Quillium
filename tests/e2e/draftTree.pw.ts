/**
 * E2E tests for the per-tab draft tree (#160):
 *   - Panel renders the root draft
 *   - Branching creates a child draft and locks the parent
 *   - Switching back to the locked parent shows the lock banner
 *   - "Edit anyway" unlocks the draft
 */

import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

// The draft tree panel hides below 1240px viewport width.
test.use({ viewport: { width: 1440, height: 900 } });

test.describe("Draft tree", () => {
    test("panel renders the root draft on load", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        await expect(panel).toBeVisible();
        await expect(panel.getByText("main")).toBeVisible();
    });

    test("branching creates a child draft and locks the parent", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        // Hover the root row so its actions appear, then branch.
        await panel.getByText("main").hover();
        await panel.locator('button[aria-label="Branch from main"]').click();

        // A second row appears and is selected (amber dot lives on active row).
        await expect(panel.locator("button[aria-current='true']")).toHaveCount(1, {
            timeout: 5_000,
        });
        expect(await q.countInvocations("cmd_fork_draft")).toBe(1);

        // Parent is now locked: an unlock action exists for it.
        await panel.getByText("main").hover();
        await expect(panel.locator('button[aria-label="Unlock main"]')).toBeVisible();
    });

    test("opening a locked parent shows the lock banner; Edit anyway unlocks", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        await panel.getByText("main").hover();
        await panel.locator('button[aria-label="Branch from main"]').click();
        await expect(panel.locator("button[aria-current='true']")).toHaveCount(1, {
            timeout: 5_000,
        });

        // Switch back to the locked parent.
        await panel.getByText("main").click();
        await expect(page.getByText("Locked — this draft has branches")).toBeVisible({
            timeout: 5_000,
        });

        // Unlock from the banner.
        await page.getByRole("button", { name: "Edit anyway" }).click();
        await expect(page.getByText("Locked — this draft has branches")).toBeHidden({
            timeout: 5_000,
        });
        expect(await q.countInvocations("cmd_set_draft_locked")).toBeGreaterThanOrEqual(1);
    });
});
