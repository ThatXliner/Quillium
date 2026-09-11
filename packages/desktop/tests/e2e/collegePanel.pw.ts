import { type Page, expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

const panel = (page: Page) => page.locator('[data-panel-id="college"]');
async function openCollege(page: Page): Promise<void> {
    if (await panel(page).isVisible()) return;
    if (!(await page.locator("#ai-tab-college").count())) {
        await page.locator('button[aria-label="AI Settings"]:visible').first().click();
        await page
            .getByRole("region", { name: "College applications setup" })
            .getByRole("button", { name: "UC PIQ", exact: true })
            .click();
    } else {
        await page.locator('button[aria-label="College applications"]:visible').first().click();
    }
    await expect(panel(page)).toBeVisible();
}
async function createSupplement(page: Page): Promise<string> {
    await openCollege(page);
    await panel(page).getByRole("button", { name: "School supplement", exact: true }).click();
    await panel(page).getByLabel("School (optional)").fill("Example University");
    await panel(page).getByLabel("Prompt", { exact: true }).fill("What matters to you?");
    await panel(page).getByLabel("Length limit (optional)").fill("69");
    await expect(panel(page).getByRole("button", { name: "Apply to existing tab" })).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Create essay tab", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Example University", exact: true })).toBeVisible();
    await openCollege(page);
    await expect(panel(page).getByRole("button", { name: "Add another prompt" })).toBeVisible();
    const tabId = await page
        .getByRole("tab", { name: "Example University", exact: true })
        .getAttribute("data-tab-id");
    return `mock-college-setup:doc-test-1:${tabId}`;
}
async function addPrompt(page: Page): Promise<void> {
    await panel(page).getByRole("button", { name: "Add another prompt" }).click();
    await panel(page).getByLabel("Prompt", { exact: true }).fill("Tell us about your community");
    await panel(page).getByLabel("Length limit (optional)").fill("150");
    await panel(page).getByRole("button", { name: "Add prompt to this tab" }).click();
    await expect(panel(page).getByRole("button", { name: "Add another prompt" })).toBeVisible();
}

test("creates independent essay tabs with prompt headings and no provider traffic", async ({
    page,
}) => {
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await openCollege(page);
    await panel(page).getByRole("checkbox", { name: /PIQ 1/ }).check();
    await panel(page).getByRole("checkbox", { name: /PIQ 7/ }).check();
    await panel(page).getByRole("button", { name: "Create 2 essay tabs" }).click();
    await expect(page.getByRole("tab", { name: /PIQ 1/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /PIQ 7/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Main", exact: true })).toBeVisible();
    await expect.poll(() => q.cmText()).toContain("(350 words)");
    await openCollege(page);
    await expect(panel(page).getByLabel("Essay length")).toHaveText("0 / 350 words");
    await page.getByRole("tab", { name: /PIQ 7/ }).click();
    await openCollege(page);
    await expect(panel(page).getByText("PIQ 7 · Community", { exact: true }).first()).toBeVisible();
    q.expectNoPageErrors();
});

test("shows the verbatim Common App prompt and opens its official source natively", async ({
    page,
}) => {
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await openCollege(page);
    await panel(page).getByRole("button", { name: "Common App", exact: true }).click();
    const growth = panel(page).getByRole("checkbox", { name: /Growth/ });
    await expect(
        panel(page).getByText(
            /Discuss an accomplishment, event, or realization that sparked a period of personal growth/,
        ),
    ).toBeVisible();
    await growth.check();
    await panel(page).getByRole("button", { name: "Create essay tab", exact: true }).click();
    await openCollege(page);
    const source = panel(page).getByRole("link", { name: "View official prompt source" });
    await expect(source).toHaveAttribute(
        "href",
        "https://www.commonapp.org/blog/announcing-2026-2027-common-app-essay-prompts/",
    );
    await source.click();
    await expect.poll(() => q.countInvocations("plugin:opener|open_url")).toBe(1);
    q.expectNoPageErrors();
});

test("adds a prompt as an undoable H1, preserves the answer, and detects pasted sections", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1800, height: 1000 });
    const q = new QuilliumPage(page, { apiKey: null, settings: { editorMode: "plain" } });
    await q.init();
    const savedKey = await createSupplement(page);
    const initial = "# What matters to you? (69 words)\n\nMaking things accessible matters to me.";
    await q.typeInEditor(initial);
    await openCollege(page);
    await expect(panel(page).getByLabel("Essay length")).toHaveText("6 / 69 words");
    await addPrompt(page);
    const withSecond = await q.cmText();
    expect(withSecond).toContain(initial);
    expect(withSecond).toContain("# Tell us about your community (150 words)");
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(panel(page).getByLabel("Essay length")).toHaveText([
        "6 / 69 words",
        "0 / 150 words",
    ]);
    await expect(panel(page).getByRole("button", { name: /Undo/ })).toHaveCount(0);
    await q.editor.click();
    await q.undo();
    await expect.poll(() => q.cmText()).toBe(initial);
    await openCollege(page);
    await expect(panel(page).getByLabel("Essay length")).toHaveText("6 / 69 words");
    await q.editor.click();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => q.cmText()).toBe(withSecond);
    await q.typeInEditor(
        `${withSecond}\nOur library became a place to belong.\n\n# A third question\n\nA short answer.`,
    );
    await openCollege(page);
    await expect(panel(page).getByLabel("Essay length")).toHaveText([
        "6 / 69 words",
        "7 / 150 words",
        "3 words · no limit",
    ]);
    const recoveryNotice = page.getByRole("button", { name: "Dismiss error banner" });
    if (await recoveryNotice.isVisible()) {
        await recoveryNotice.click();
        await expect(panel(page)).toBeHidden();
        await openCollege(page);
    }
    await page.screenshot({ path: "/tmp/quillium-college-sections.png", animations: "disabled" });
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), savedKey);
    expect(stored.sectionMode).toBe(true);
    expect(stored.prompts).toHaveLength(2);
    q.expectNoPageErrors();
});

test("deleting all headings detaches prompts and normal undo restores them", async ({ page }) => {
    const q = new QuilliumPage(page, { apiKey: null, settings: { editorMode: "plain" } });
    await q.init();
    const savedKey = await createSupplement(page);
    const heading = await q.cmText();
    await q.editor.click();
    await q.selectAll();
    await page.keyboard.press("Backspace");
    await openCollege(page);
    await expect(panel(page).getByText(/No prompt headings found/)).toBeVisible();
    await expect(panel(page).getByLabel("Essay length")).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), savedKey)).not.toBeNull();
    await q.editor.click();
    await q.undo();
    await expect.poll(() => q.cmText()).toBe(heading);
    await openCollege(page);
    await expect(panel(page).getByLabel("Essay length")).toHaveText("0 / 69 words");
    q.expectNoPageErrors();
});

test("failed prompt save leaves prose unchanged and allows retry", async ({ page }) => {
    const q = new QuilliumPage(page, { apiKey: null, settings: { editorMode: "plain" } });
    await q.init();
    await createSupplement(page);
    const initial = await q.cmText();
    await page.evaluate(() => localStorage.setItem("mock-college-save-error", "1"));
    await panel(page).getByRole("button", { name: "Add another prompt" }).click();
    await panel(page).getByLabel("Prompt", { exact: true }).fill("Second question");
    await panel(page).getByRole("button", { name: "Add prompt to this tab" }).click();
    await expect(panel(page).getByRole("alert")).toBeVisible();
    expect(await q.cmText()).toBe(initial);
    await page.evaluate(() => localStorage.removeItem("mock-college-save-error"));
    await panel(page).getByRole("button", { name: "Add prompt to this tab" }).click();
    await expect.poll(() => q.cmText()).toContain("# Second question");
    q.expectNoPageErrors();
});

test("batch save failure leaves no new tabs and keeps selection for retry", async ({ page }) => {
    const q = new QuilliumPage(page, { apiKey: null, settings: { editorMode: "plain" } });
    await q.init();
    await openCollege(page);
    await panel(page).getByRole("checkbox", { name: /PIQ 1/ }).check();
    await panel(page).getByRole("checkbox", { name: /PIQ 2/ }).check();
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

test("narrow layout can create and add prompts", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    const q = new QuilliumPage(page, { apiKey: null, settings: { editorMode: "plain" } });
    await q.init();
    await createSupplement(page);
    await addPrompt(page);
    const box = await q.aiSidebar.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(288);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    q.expectNoPageErrors();
});

test("reopening and toggling AI preserves the prompt setup", async ({ page }) => {
    const q = new QuilliumPage(page, { apiKey: null, settings: { editorMode: "plain" } });
    await q.init();
    const key = await createSupplement(page);
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.reload();
    await expect(q.editor).toBeVisible();
    await openCollege(page);
    await expect(panel(page).getByLabel("Essay length")).toHaveText("0 / 69 words");
    async function toggleAi(): Promise<void> {
        const settings = await q.openSettings();
        await settings.getByRole("button", { name: "Advanced", exact: true }).click();
        await settings.getByLabel("Toggle AI features").click();
        await settings.getByRole("button", { name: "Save", exact: true }).click();
    }
    await toggleAi();
    await expect(page.locator("#ai-sidebar")).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(saved);
    await toggleAi();
    await openCollege(page);
    await expect(panel(page).getByRole("button", { name: "Add another prompt" })).toBeVisible();
    q.expectNoPageErrors();
});

test("detects, adds, and selects all prompts beyond twelve sections", async ({ page }) => {
    const q = new QuilliumPage(page, { apiKey: null, settings: { editorMode: "plain" } });
    await q.init();
    await createSupplement(page);
    const prose = Array.from(
        { length: 13 },
        (_, index) => `# Question ${index + 1}\n\nAnswer ${index + 1}.`,
    ).join("\n\n");
    await q.typeInEditor(prose);
    await openCollege(page);
    await expect(panel(page).getByLabel("Essay length")).toHaveCount(13);
    await addPrompt(page);
    await expect(panel(page).getByLabel("Essay length")).toHaveCount(14);
    await expect.poll(() => q.cmText()).toContain("# Question 13");
    await panel(page)
        .getByRole("button", { name: "Research this school's prompts", exact: true })
        .click();
    const choices = panel(page).getByRole("group", { name: "Prompts to research", exact: true });
    await expect(choices.getByRole("checkbox")).toHaveCount(14);
    await expect(choices.getByRole("checkbox", { checked: true })).toHaveCount(14);
    await expect(choices.getByRole("checkbox").nth(12)).toBeEnabled();
    await choices.getByRole("checkbox").first().uncheck();
    await expect(choices.getByRole("checkbox", { checked: true })).toHaveCount(13);
    await choices.getByRole("checkbox").first().check();
    await expect(choices.getByRole("checkbox", { checked: true })).toHaveCount(14);
    await expect(choices.getByRole("checkbox").nth(12)).toBeChecked();
    q.expectNoPageErrors();
});
