import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test("College is an explicit saved document opt-in through AI Settings", async ({ page }) => {
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await expect(page.locator('#ai-tab-college')).toHaveCount(0);
    await page.locator('button[aria-label="AI Settings"]:visible').first().click();
    const invitation = page.getByRole('region', { name: 'College applications setup' });
    await expect(invitation.getByText('Writing college applications?')).toBeVisible();
    await invitation.screenshot({ path: '/tmp/quillium-college-opt-in.png' });
    await invitation.getByRole('button', { name: 'Supplemental', exact: true }).click();
    const panel = page.locator('[data-panel-id="college"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel('School')).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('mock-college-enabled:doc-test-1'))).toBe('true');
    await page.reload();
    await expect(q.editor).toBeVisible();
    await expect(page.locator('#ai-tab-college')).toHaveCount(1);
    q.expectNoPageErrors();
});

test("failed opt-in keeps College hidden and offers a retry", async ({ page }) => {
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await page.evaluate(() => localStorage.setItem('mock-college-activation-error', 'true'));
    await page.locator('button[aria-label="AI Settings"]:visible').first().click();
    const invitation = page.getByRole('region', { name: 'College applications setup' });
    await invitation.getByRole('button', { name: 'UC PIQ', exact: true }).click();
    await expect(invitation.getByRole('alert')).toBeVisible();
    await expect(page.locator('#ai-tab-college')).toHaveCount(0);
    await page.evaluate(() => localStorage.removeItem('mock-college-activation-error'));
    await invitation.getByRole('button', { name: 'UC PIQ', exact: true }).click();
    await expect(page.locator('[data-panel-id="college"]')).toBeVisible();
});
