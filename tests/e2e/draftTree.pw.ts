/**
 * E2E tests for the per-tab draft panel (#160):
 *   - Panel renders the root draft
 *   - Iterate makes the next version and locks the superseded source
 *   - Branch makes a different take and locks nothing (and not off main)
 *   - Deleting a draft is soft and undoable from the toast
 *   - The locked banner's "Edit anyway" unlocks
 */

import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

// The draft panel hides below 1280px viewport width.
test.use({ viewport: { width: 1440, height: 900 } });

test.describe("Draft panel", () => {
    test("panel renders the root draft on load", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        await expect(panel).toBeVisible();
        await expect(panel.getByText("main")).toBeVisible();
    });

    test("main offers Iterate but not Branch (a top-level take is a new tab)", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        await panel.getByText("main").hover();
        await expect(panel.locator('button[aria-label="Iterate main"]')).toBeVisible();
        await expect(panel.locator('button[aria-label="Branch from main"]')).toHaveCount(0);
    });

    test("iterating makes the next version and locks the superseded source", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        await panel.getByText("main").hover();
        await panel.locator('button[aria-label="Iterate main"]').click();

        // A second row appears and becomes the active tip.
        await expect(panel.locator("button[aria-current='true']")).toHaveCount(1, {
            timeout: 5_000,
        });
        expect(await q.countInvocations("cmd_iterate_draft")).toBe(1);

        // The source (main) is now locked/superseded.
        await panel.getByText("main").hover();
        await expect(panel.locator('button[aria-label="Unlock main"]')).toBeVisible();
        await panel.getByText("main").click();
        await expect(page.getByText("This is an older version.", { exact: true })).toBeVisible({
            timeout: 5_000,
        });
    });

    test("branching makes a different take and locks nothing", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        // Iterate once so we have a non-root draft to branch from.
        await panel.getByText("main").hover();
        await panel.locator('button[aria-label="Iterate main"]').click();
        await expect(panel.locator("button[aria-current='true']")).toHaveCount(1, {
            timeout: 5_000,
        });
        const tip = page.locator('[aria-label="Draft tree"] button[aria-current="true"]');
        const tipLabel = (await tip.innerText()).trim();

        await tip.hover();
        await panel.locator(`button[aria-label="Branch from ${tipLabel}"]`).click();
        await expect(panel.locator("button[aria-current='true']")).toHaveCount(1, {
            timeout: 5_000,
        });
        expect(await q.countInvocations("cmd_branch_draft")).toBe(1);

        // The branch source stays editable (no lock banner on it).
        await panel.getByText(tipLabel).first().click();
        await expect(page.getByText("This draft is locked.", { exact: true })).toBeHidden({
            timeout: 5_000,
        });
    });

    test("deleting a draft shows an undo toast that restores it", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        await panel.getByText("main").hover();
        await panel.locator('button[aria-label="Iterate main"]').click();
        await expect(panel.locator("button[aria-current='true']")).toHaveCount(1, {
            timeout: 5_000,
        });
        const tipLabel = (
            await page.locator('[aria-label="Draft tree"] button[aria-current="true"]').innerText()
        ).trim();

        // Delete the iteration we are on — the editor falls back to main.
        await panel.getByText(tipLabel).first().hover();
        await panel.locator(`button[aria-label="Delete ${tipLabel}"]`).click();
        await expect(panel.getByText(tipLabel)).toBeHidden({ timeout: 5_000 });
        expect(await q.countInvocations("cmd_delete_draft")).toBe(1);

        // Undo from the toast brings it back.
        await page.getByRole("button", { name: "Undo" }).click();
        await expect(panel.getByText(tipLabel)).toBeVisible({ timeout: 5_000 });
        expect(await q.countInvocations("cmd_restore_draft")).toBe(1);
    });

    test("deleting a parent prompts orphan vs cascade; orphan keeps the child", async ({
        page,
    }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        // main → v1: main is now a parent with a live child.
        await panel.getByText("main").hover();
        await panel.locator('button[aria-label="Iterate main"]').click();
        await expect(panel.locator("button[aria-current='true']")).toHaveCount(1, {
            timeout: 5_000,
        });
        const childLabel = (
            await page.locator('[aria-label="Draft tree"] button[aria-current="true"]').innerText()
        ).trim();

        // main auto-locked when v1 superseded it; unlock so it's deletable.
        await panel.getByText("main").hover();
        await panel.locator('button[aria-label="Unlock main"]').click();

        // Deleting main opens the orphan/cascade prompt rather than deleting.
        await panel.getByText("main").hover();
        await panel.locator('button[aria-label="Delete main"]').click();
        const modal = page.locator('[aria-label="Delete draft"]');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Keep the children: main goes, the child survives (now a run head).
        await modal.getByText("Keep the children").click();
        await expect(panel.getByText("main")).toBeHidden({ timeout: 5_000 });
        await expect(panel.getByText(childLabel)).toBeVisible();
        expect(await q.countInvocations("cmd_orphan_and_delete_draft")).toBe(1);

        // Undo restores main and re-parents the child back under it.
        await page.getByRole("button", { name: "Undo" }).click();
        await expect(panel.getByText("main")).toBeVisible({ timeout: 5_000 });
        expect(await q.countInvocations("cmd_restore_draft")).toBe(1);
        expect(await q.countInvocations("cmd_reparent_draft")).toBe(1);
    });

    test("deleting a parent with cascade removes the whole subtree", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        // Build main → v1 → v2. Cascade-deleting v1 removes {v1, v2} while main
        // survives, so the tab keeps a live draft (cascade off the root would
        // empty the tab and is refused).
        await panel.getByText("main").hover();
        await panel.locator('button[aria-label="Iterate main"]').click();
        await expect(panel.locator("button[aria-current='true']")).toHaveCount(1, {
            timeout: 5_000,
        });
        const midLabel = (
            await page.locator('[aria-label="Draft tree"] button[aria-current="true"]').innerText()
        ).trim();
        await panel.getByText(midLabel).hover();
        await panel.locator(`button[aria-label="Iterate ${midLabel}"]`).click();
        await expect(panel.locator('[aria-current="true"]')).toHaveCount(1, { timeout: 5_000 });
        const tipLabel = (
            await page.locator('[aria-label="Draft tree"] button[aria-current="true"]').innerText()
        ).trim();

        // v1 (mid) is now a locked, superseded parent — unlock it so it's
        // deletable, then delete it to open the prompt.
        await panel.getByText(midLabel).hover();
        await panel.locator(`button[aria-label="Unlock ${midLabel}"]`).click();
        await panel.getByText(midLabel).hover();
        await panel.locator(`button[aria-label="Delete ${midLabel}"]`).click();
        const modal = page.locator('[aria-label="Delete draft"]');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // "Delete all N" cascades the {v1, v2} subtree away; main remains.
        await modal.getByRole("button", { name: /Delete all/ }).click();
        await expect(panel.getByText(midLabel)).toBeHidden({ timeout: 5_000 });
        await expect(panel.getByText(tipLabel)).toBeHidden();
        await expect(panel.getByText("main")).toBeVisible();
        expect(await q.countInvocations("cmd_cascade_delete_draft")).toBe(1);
    });

    test("manually locking the open draft shows the plain lock banner", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        const panel = page.locator('[aria-label="Draft tree"]');
        await panel.getByText("main").hover();
        await panel.locator('button[aria-label="Lock main"]').click();

        // main has no newer iteration, so the lock is manual: plain copy.
        await expect(page.getByText("This draft is locked.", { exact: true })).toBeVisible({
            timeout: 5_000,
        });
        expect(await q.countInvocations("cmd_set_draft_locked")).toBe(1);

        // Unlock again from the banner.
        await page.getByRole("button", { name: "Edit anyway" }).click();
        await expect(page.getByText("This draft is locked.", { exact: true })).toBeHidden({
            timeout: 5_000,
        });
    });
});
