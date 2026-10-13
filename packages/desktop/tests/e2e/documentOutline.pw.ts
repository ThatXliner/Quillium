import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test("outline navigates, refreshes after edits and undo, and closes at narrow widths", async ({ page }) => {
    const doc = `# Opening\n\n${"A paragraph of prose.\n\n".repeat(100)}## Ending`;
    const q = new QuilliumPage(page, { initialDoc: doc });
    await q.init();
    await page.getByRole("button", { name: "Show document outline", exact: true }).click();
    const outline = page.getByRole("navigation", { name: "Document outline" });
    await expect(page.getByLabel("Draft tree", { exact: true })).toBeVisible();
    await expect(outline).toBeVisible();
    await outline.getByRole("button", { name: "Ending", exact: true }).click();
    await expect(outline.getByRole("button", { name: "Ending", exact: true })).toHaveAttribute("aria-current", "location");
    await expect(q.editor).toBeFocused();
    await page.keyboard.type("Intro ");
    await expect(outline.getByRole("button", { name: "Ending", exact: true })).toHaveCount(0);
    await q.undo();
    await expect(outline.getByRole("button", { name: "Ending", exact: true })).toBeVisible();
    await page.screenshot({ path: "/tmp/quillium-outline-desktop.png" });
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.getByLabel("Draft tree", { exact: true })).toBeVisible();
    await expect(outline).toBeVisible();
    await page.screenshot({ path: "/tmp/quillium-outline-narrow.png" });
    await outline.getByRole("button", { name: "Hide document outline" }).click();
    await expect(outline).toHaveCount(0);
    await page.getByRole("button", { name: "Show document outline", exact: true }).click();
    await expect(outline.getByRole("button", { name: "Ending", exact: true })).toBeVisible();
});

test("outline explains how to add headings in an empty draft", async ({ page }) => {
    const q = new QuilliumPage(page);
    await q.init();
    await page.getByRole("button", { name: "Show document outline", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Document outline" })).toContainText("Add headings with the Format menu");
});

test("remembers both open and closed outline preferences across editor sessions", async ({ page, context }) => {
    const q = new QuilliumPage(page);
    await q.init();
    await page.getByRole("button", { name: "Show document outline", exact: true }).click();
    const savedOpen = await page.evaluate(() => JSON.parse(localStorage.getItem("quillium-app-settings")!));
    expect(savedOpen.showDocumentOutline).toBe(true);

    // The mock seeds settings on every load, so carry the actual saved settings
    // into each fresh page to exercise startup restoration.
    const reopened = await context.newPage();
    await new QuilliumPage(reopened, { settings: savedOpen }).init();
    const outline = reopened.getByRole("navigation", { name: "Document outline" });
    await expect(outline).toBeVisible();
    await outline.getByRole("button", { name: "Hide document outline", exact: true }).click();
    const savedClosed = await reopened.evaluate(() => JSON.parse(localStorage.getItem("quillium-app-settings")!));
    expect(savedClosed.showDocumentOutline).toBe(false);

    const closedSession = await context.newPage();
    await new QuilliumPage(closedSession, { settings: savedClosed }).init();
    await expect(closedSession.getByRole("navigation", { name: "Document outline" })).toHaveCount(0);
    await expect(closedSession.getByRole("button", { name: "Show document outline", exact: true })).toBeVisible();
});
