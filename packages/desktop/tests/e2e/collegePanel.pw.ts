import { type Page, expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

const panel = (page: Page) => page.locator('[data-panel-id="college"]');
const savedKey = "mock-college-setup:doc-test-1:tab-test-1";
async function openCollege(page: Page): Promise<void> {
    const collapsed = page.locator("#ai-tab-college");
    if (await collapsed.isVisible()) await collapsed.click();
    else
        await page.locator('#ai-sidebar button[aria-label="College applications"]:visible').click();
    await expect(
        panel(page).getByRole("heading", { name: "College applications", exact: true }),
    ).toBeVisible();
}
async function applyPreview(page: Page): Promise<void> {
    await panel(page).getByRole("button", { name: "Review setup", exact: true }).click();
    await panel(page).getByRole("button", { name: "Use this prompt", exact: true }).click();
    await expect(
        panel(page).getByRole("button", { name: "Edit setup", exact: true }),
    ).toBeVisible();
}

test("credential-free setup, cancel, reload, independent tab briefs, and removal preserve notes", async ({
    page,
}) => {
    const q = new QuilliumPage(page, { apiKey: null });
    const providerRequests: string[] = [];
    page.on("request", (request) => {
        if (
            /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.deepseek\.com/.test(
                request.url(),
            )
        )
            providerRequests.push(request.url());
    });
    await q.setup();
    await page.addInitScript(() => {
        localStorage.setItem("mock-writer-brief:doc-test-1", "Keep my family context private.");
        localStorage.setItem("mock-editorial-decisions:doc-test-1", '["Keep the ending open."]');
    });
    await q.goto();
    await openCollege(page);
    await panel(page).getByRole("button", { name: "UC PIQ", exact: true }).click();
    await expect(panel(page).getByLabel("Application cycle")).toBeHidden();
    await expect(panel(page).getByLabel("Voice latitude")).toBeHidden();
    await panel(page)
        .getByLabel("What I want to convey")
        .fill("My responsibility to my community.");
    await panel(page).getByRole("button", { name: "Review setup", exact: true }).click();
    await expect(panel(page).getByRole("checkbox")).toHaveCount(0);
    await page.screenshot({ path: "../../docs/assets/issue-422/setup-preview.png" });
    await panel(page).getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.evaluate((key) => localStorage.getItem(key), savedKey)).toBeNull();
    await panel(page).getByRole("button", { name: "UC PIQ", exact: true }).click();
    await applyPreview(page);
    await page.screenshot({ path: "../../docs/assets/issue-422/college-panel.png" });
    const first = await page.evaluate((key) => localStorage.getItem(key), savedKey);
    expect(JSON.parse(first!).feedbackReaders).toBe(false);
    expect(JSON.parse(first!).readers.filter((r: { enabled: boolean }) => r.enabled)).toHaveLength(
        1,
    );
    await page.reload();
    await expect(q.editor).toBeVisible();
    await openCollege(page);
    await panel(page).getByText("More options", { exact: true }).click();
    await expect(
        panel(page).getByText("Keep my family context private.", { exact: true }),
    ).toBeVisible();
    await expect(
        panel(page).getByRole("button", { name: "Edit setup", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await openCollege(page);
    await expect(panel(page).getByRole("button", { name: "UC PIQ", exact: true })).toBeVisible();
    await panel(page).getByRole("button", { name: "UC PIQ", exact: true }).click();
    await panel(page).getByLabel("Choose a prompt").selectOption("1");
    await applyPreview(page);
    expect(await page.evaluate((key) => localStorage.getItem(key), savedKey)).toBe(first);
    await page.locator('[data-tab-id="tab-test-1"]').click();
    await openCollege(page);
    await expect(panel(page).getByText(/Explain how your leadership/)).toBeVisible();
    await panel(page).getByText("More options", { exact: true }).click();
    await panel(page).getByRole("button", { name: "Remove setup…", exact: true }).click();
    await expect(panel(page).getByLabel("Remove setup preview")).toContainText("saved decisions");
    await panel(page).getByRole("button", { name: "Remove setup", exact: true }).click();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), savedKey)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("mock-writer-brief:doc-test-1"))).toBe(
        "Keep my family context private.",
    );
    expect(
        await page.evaluate(() => localStorage.getItem("mock-editorial-decisions:doc-test-1")),
    ).toBe('["Keep the ending open."]');
    expect(providerRequests).toEqual([]);
    q.expectNoPageErrors();
});

test("supplemental brief has multiple prompts and independent word and character constraints", async ({
    page,
}) => {
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await openCollege(page);
    await panel(page).getByRole("button", { name: "Supplemental", exact: true }).click();
    await panel(page).getByLabel("School or application system").fill("Example University");
    await panel(page)
        .getByLabel("Prompt", { exact: true })
        .fill("What interests you about this program?");
    await panel(page).getByLabel("Constraint unit").first().selectOption("words");
    await panel(page).getByLabel("Maximum", { exact: true }).fill("200");
    await panel(page).getByText("More options", { exact: true }).click();
    await panel(page).getByRole("button", { name: "Add another prompt", exact: true }).click();
    await panel(page)
        .getByLabel("Prompt", { exact: true })
        .nth(1)
        .fill("Describe a community you care about.");
    await panel(page).getByLabel("Constraint unit").nth(1).selectOption("characters");
    await panel(page).getByLabel("Maximum", { exact: true }).nth(1).fill("500");
    await applyPreview(page);
    const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), savedKey))!);
    expect(saved.prompts).toHaveLength(2);
    expect(saved.prompts[0].constraints[0]).toMatchObject({ unit: "words", max: 200 });
    expect(saved.prompts[1].constraints[0]).toMatchObject({ unit: "characters", max: 500 });
    await page.locator('#ai-sidebar button[aria-label^="Document Context"][aria-pressed]').click();
    await expect(
        page.locator('[data-panel-id="context"]').getByLabel("Tab college context"),
    ).toContainText("Describe a community you care about.");
    q.expectNoPageErrors();
});

test("failed save retains accepted setup and device reader defaults", async ({ page }) => {
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await openCollege(page);
    const defaults = await page.evaluate(() => localStorage.getItem("quillium-readers-settings"));
    await panel(page).getByRole("button", { name: "Personal statement", exact: true }).click();
    await applyPreview(page);
    const original = await page.evaluate((key) => localStorage.getItem(key), savedKey);
    await panel(page).getByRole("button", { name: "Edit setup", exact: true }).click();
    await panel(page).getByLabel("What I want to convey").fill("Changed but unsaved");
    await page.evaluate(() => localStorage.setItem("mock-college-save-error", "1"));
    await panel(page).getByRole("button", { name: "Review setup", exact: true }).click();
    await panel(page).getByRole("button", { name: "Use this prompt", exact: true }).click();
    await expect(panel(page).getByRole("alert")).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), savedKey)).toBe(original);
    expect(await page.evaluate(() => localStorage.getItem("quillium-readers-settings"))).toBe(
        defaults,
    );
    q.expectNoPageErrors();
});

test("setup scrolls within a narrow panel with keyboard access and reduced motion", async ({
    page,
}) => {
    await page.setViewportSize({ width: 320, height: 600 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const q = new QuilliumPage(page, { apiKey: null });
    await q.init();
    await openCollege(page);
    await panel(page).getByRole("button", { name: "UC PIQ", exact: true }).click();
    await panel(page).getByRole("button", { name: "Review setup", exact: true }).click();
    await panel(page).getByRole("button", { name: "Back", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
        panel(page).getByRole("button", { name: "Use this prompt", exact: true }),
    ).toBeFocused();
    const box = await q.aiSidebar.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(288);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    await panel(page).getByRole("button", { name: "Use this prompt", exact: true }).click();
    await expect(
        panel(page).getByRole("button", { name: "Edit setup", exact: true }),
    ).toBeVisible();
    q.expectNoPageErrors();
});

test("AI disabled keeps local college setup and hides AI actions and panel links", async ({
    page,
}) => {
    const q = new QuilliumPage(page, {
        apiKey: null,
        settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: false },
    });
    await q.init();
    await openCollege(page);
    await panel(page).getByRole("button", { name: "UC PIQ", exact: true }).click();
    await applyPreview(page);
    await expect(panel(page).getByText(/Explain how your leadership/)).toBeVisible();
    await expect(panel(page).getByLabel("College writing actions")).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "Context", exact: true })).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "Readers", exact: true })).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
    await expect(
        panel(page).getByRole("button", { name: "Edit setup", exact: true }),
    ).toBeVisible();
    q.expectNoPageErrors();
});
