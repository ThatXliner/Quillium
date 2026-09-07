import { type Page, expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

const panel = (page: Page) => page.locator('[data-panel-id="college"]');
const savedKey = "mock-college-setup:doc-test-1:tab-test-1";
async function openCollege(page: Page): Promise<void> {
    if (await panel(page).isVisible()) return;
    if (!(await page.locator('#ai-tab-college').count())) {
        await page.locator('button[aria-label="AI Settings"]:visible').first().click();
        await page.getByRole("region", { name: "College applications setup" }).getByRole("button", { name: "UC PIQ", exact: true }).click();
    } else {
        await page.locator('button[aria-label="College applications"]:visible').first().click();
    }
    await expect(panel(page)).toBeVisible();
}
async function selectPrompt(page: Page, name: string): Promise<void> {
    await panel(page)
        .getByRole("checkbox", { name: new RegExp(name) })
        .check();
}

test("selected prompts create independent named tabs and context without provider traffic", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    const q = new QuilliumPage(page, { apiKey: null });
    const requests: string[] = [];
    page.on("request", (r) => {
        if (/api\.openai|api\.anthropic|generativelanguage/.test(r.url())) requests.push(r.url());
    });
    await q.init();
    await openCollege(page);
    await selectPrompt(page, "PIQ 1");
    await selectPrompt(page, "PIQ 7");
    await expect(panel(page).getByRole("button", { name: "Apply to existing tab" })).toBeDisabled();
    await panel(page)
        .getByRole("heading", { name: "Which prompts are you answering?" })
        .scrollIntoViewIfNeeded();
    await page.screenshot({
        animations: "disabled",
        path: "../../docs/assets/issue-422/setup-preview.png",
    });
    await panel(page).getByRole("button", { name: "Create 2 essay tabs" }).click();
    const leadership = page.getByRole("tab", { name: /PIQ 1/ });
    const community = page.getByRole("tab", { name: /PIQ 7/ });
    await expect(leadership).toBeVisible();
    await expect(community).toBeVisible();
    await expect(page.getByRole("tab", { name: "Main", exact: true })).toBeVisible();
    await openCollege(page);
    await expect(
        panel(page).getByText("PIQ 1 · Leadership", { exact: true }).first(),
    ).toBeVisible();
    await community.click();
    await openCollege(page);
    await expect(panel(page).getByText("PIQ 7 · Community", { exact: true }).first()).toBeVisible();
    const id = await community.getAttribute("data-tab-id");
    const saved = await page.evaluate(
        (id) => JSON.parse(localStorage.getItem(`mock-college-setup:doc-test-1:${id}`)!),
        id,
    );
    expect(saved.prompts).toHaveLength(1);
    expect(saved.feedbackReaders).toBe(false);
    await page.reload();
    await expect(q.editor).toBeVisible();
    await openCollege(page);
    await expect(panel(page).getByRole("button", { name: "Change prompt" })).toBeVisible();
    await expect
        .poll(async () => (await page.locator("#ai-sidebar").boundingBox())!.height)
        .toBeLessThan(450);
    await page.screenshot({
        animations: "disabled",
        path: "../../docs/assets/issue-422/college-panel.png",
    });
    expect(requests).toEqual([]);
    q.expectNoPageErrors();
});

test("workspace selection can cancel or apply to the active tab without changing prose or shared notes", async ({
    page,
}) => {
    const q = new QuilliumPage(page, { apiKey: null });
    await q.setup();
    await page.addInitScript(() => {
        localStorage.setItem("mock-writer-brief:doc-test-1", "Private family context.");
        localStorage.setItem("mock-editorial-decisions:doc-test-1", '["Keep the ending open."]');
    });
    await q.goto();
    await q.typeInEditor("We organized a weekend workshop.");
    const text = await q.editor.innerText();
    await openCollege(page);
    await selectPrompt(page, "PIQ 1");
    await panel(page).getByRole("button", { name: "Apply to existing tab" }).click();
    const target = page.getByLabel("Choose a tab for this prompt");
    await expect(target).toBeVisible();
    await target.getByRole("button", { name: "Cancel" }).click();
    expect(await page.evaluate((key) => localStorage.getItem(key), savedKey)).toBeNull();
    await openCollege(page);
    await selectPrompt(page, "PIQ 1");
    await panel(page).getByRole("button", { name: "Apply to existing tab" }).click();
    await page.locator('[data-tab-id="tab-test-1"]').click();
    await expect(target).toHaveCount(0);
    await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), savedKey))
        .not.toBeNull();
    expect(await q.editor.innerText()).toBe(text);
    await expect(page.getByRole("tab", { name: "Main", exact: true })).toBeVisible();
    await openCollege(page);
    await panel(page).getByRole("button", { name: "Change prompt" }).click();
    await panel(page).getByRole("radio", { name: /PIQ 7/ }).check();
    await panel(page).getByRole("button", { name: "Use this prompt" }).click();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), savedKey);
    expect(saved.prompts).toHaveLength(1);
    expect(saved.prompts[0].label).toContain("PIQ 7");
    await panel(page).getByText("Sources and settings", { exact: true }).click();
    await panel(page).getByRole("button", { name: "Remove setup…" }).click();
    await panel(page).getByRole("button", { name: "Remove setup", exact: true }).click();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), savedKey)).toBeNull();
    expect(await q.editor.innerText()).toBe(text);
    expect(await page.evaluate(() => localStorage.getItem("mock-writer-brief:doc-test-1"))).toBe(
        "Private family context.",
    );
    expect(
        await page.evaluate(() => localStorage.getItem("mock-editorial-decisions:doc-test-1")),
    ).toBe('["Keep the ending open."]');
    q.expectNoPageErrors();
});

test("batch save failure leaves no new tabs and keeps the selection for retry", async ({
    page,
}) => {
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await openCollege(page);
    await selectPrompt(page, "PIQ 1");
    await selectPrompt(page, "PIQ 2");
    await page.evaluate(() => localStorage.setItem("mock-college-save-error", "1"));
    await panel(page).getByRole("button", { name: "Create 2 essay tabs" }).click();
    await expect(panel(page).getByRole("alert")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(panel(page).getByRole("checkbox", { name: /PIQ 1/ })).toBeChecked();
    await page.evaluate(() => localStorage.removeItem("mock-college-save-error"));
    await panel(page).getByRole("button", { name: "Create 2 essay tabs" }).click();
    await expect(page.getByRole("tab")).toHaveCount(3);
    q.expectNoPageErrors();
});

test("a school supplement keeps its character limit and applies to an inactive workspace tab", async ({
    page,
}) => {
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await openCollege(page);
    await panel(page).getByRole("button", { name: "School supplement", exact: true }).click();
    await panel(page).getByLabel("School", { exact: true }).fill("Example University");
    await panel(page).getByLabel("Prompt", { exact: true }).fill("Why this program?");
    await panel(page).getByLabel("Length limit (optional)").fill("500");
    await panel(page).getByLabel("Count in").selectOption("characters");
    await panel(page).getByRole("button", { name: "Apply to existing tab" }).click();
    await page.locator('[data-tab-id="tab-test-1"]').click();
    await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), savedKey))
        .not.toBeNull();
    await openCollege(page);
    await expect(panel(page).getByLabel("Essay length")).toContainText("/ 500 characters");
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), savedKey);
    expect(saved.prompts).toHaveLength(1);
    expect(saved.prompts[0].constraints[0]).toMatchObject({ unit: "characters", max: 500 });
    q.expectNoPageErrors();
});

test("narrow layout supports keyboard selection of the active workspace tab", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await openCollege(page);
    await selectPrompt(page, "PIQ 1");
    await panel(page).getByRole("button", { name: "Apply to existing tab" }).click();
    const tab = page.locator('[data-tab-id="tab-test-1"]');
    await expect(tab).toBeFocused();
    await page.keyboard.press("Enter");
    await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), savedKey))
        .not.toBeNull();
    await openCollege(page);
    await expect(panel(page).getByRole("button", { name: "Change prompt" })).toBeVisible();
    const box = await q.aiSidebar.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(288);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    q.expectNoPageErrors();
});

test("toggling AI hides College and preserves saved setup", async ({ page }) => {
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await openCollege(page);
    await selectPrompt(page, "PIQ 1");
    await panel(page).getByRole("button", { name: "Apply to existing tab" }).click();
    await page.locator('[data-tab-id="tab-test-1"]').click();
    await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), savedKey))
        .not.toBeNull();
    const saved = await page.evaluate((key) => localStorage.getItem(key), savedKey);

    async function toggleAi(): Promise<void> {
        const settings = await q.openSettings();
        await settings.getByRole("button", { name: "Advanced", exact: true }).click();
        await settings.getByLabel("Toggle AI features").click();
        await settings.getByRole("button", { name: "Save", exact: true }).click();
    }

    await toggleAi();
    await expect(page.locator("#ai-sidebar")).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    await page.keyboard.press("Control+Shift+4");
    await expect(page.locator("#ai-sidebar")).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), savedKey)).toBe(saved);

    await toggleAi();
    await expect(page.locator("#ai-tab-college")).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await openCollege(page);
    await expect(panel(page).getByRole("button", { name: "Change prompt" })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), savedKey)).toBe(saved);
    q.expectNoPageErrors();
});
