import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test("outline navigates, refreshes after edits and undo, and closes at narrow widths", async ({ page }) => {
    const doc = `# Opening\n\n${"A paragraph of prose.\n\n".repeat(100)}## Ending`;
    const q = new QuilliumPage(page, { initialDoc: doc });
    await q.init();
    await page.getByRole("button", { name: "Expand outline", exact: true }).click();
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
    await outline.getByRole("button", { name: "Collapse outline" }).click();
    await expect(outline.getByRole("button", { name: "Expand outline" })).toBeVisible();
    await expect(outline.getByRole("button", { name: "Ending", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Expand outline", exact: true }).click();
    await expect(outline.getByRole("button", { name: "Ending", exact: true })).toBeVisible();
});

test("outline explains how to add headings in an empty draft", async ({ page }) => {
    const q = new QuilliumPage(page);
    await q.init();
    await page.getByRole("button", { name: "Expand outline", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Document outline" })).toContainText("Add headings with the Format menu");
});

test("drafts and outline collapse independently and restore all combinations", async ({ page, context }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const initialDoc = "# The road home\n\nThe station was quiet when Mara arrived. Beyond the platform, the hills held the last of the evening light.\n\n## A familiar place\n\nShe had been away for seven years, long enough for the streets to change and the old names to become stories.\n\n### The station\n\nA blue door stood open beside the ticket window. Someone had left a lamp burning inside.\n\n### The letter\n\nOn the bench was an envelope, addressed in handwriting she knew before she read the name.\n\n## Walking home\n\nMara folded the letter into her coat pocket and took the path along the river.";
    await new QuilliumPage(page, { initialDoc, settings: { grammarCheckEnabled: false } }).init();
    await page.getByRole("button", { name: "Expand outline", exact: true }).click();
    await page.mouse.move(800, 950);
    await page.screenshot({ path: "/tmp/quillium-navigation-expanded.png" });

    for (const [showDrafts, showDocumentOutline] of [[true, true], [false, true], [false, false], [true, false]]) {
        const draftToggle = page.getByRole("button", { name: /^(Expand|Collapse) drafts$/ });
        const outlineToggle = page.getByRole("button", { name: /^(Expand|Collapse) outline$/ });
        if ((await draftToggle.getAttribute("aria-expanded")) !== String(showDrafts)) {
            await draftToggle.focus();
            await page.keyboard.press("Enter");
        }
        if ((await outlineToggle.getAttribute("aria-expanded")) !== String(showDocumentOutline)) {
            await outlineToggle.focus();
            await page.keyboard.press("Space");
        }
        await expect(draftToggle).toHaveAttribute("aria-expanded", String(showDrafts));
        await expect(outlineToggle).toHaveAttribute("aria-expanded", String(showDocumentOutline));
        await expect(page.getByLabel("Draft tree", { exact: true }).getByRole("button", { name: "main", exact: true })).toHaveCount(showDrafts ? 1 : 0);
        await expect(page.getByRole("navigation", { name: "Document outline" }).getByRole("button", { name: "The road home", exact: true })).toHaveCount(showDocumentOutline ? 1 : 0);
        if (!showDrafts && showDocumentOutline) {
            await page.screenshot({ path: "/tmp/quillium-drafts-collapsed.png" });
        }
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("quillium-app-settings")!));
        expect(saved).toMatchObject({ showDrafts, showDocumentOutline });

        // The mock seeds storage on load; carry the actual saved preferences
        // into a fresh page to exercise settings initialization.
        const reopened = await context.newPage();
        await reopened.setViewportSize({ width: 1600, height: 1000 });
        await new QuilliumPage(reopened, { initialDoc, settings: saved }).init();
        await expect(reopened.getByRole("button", { name: /^(Expand|Collapse) drafts$/ })).toHaveAttribute("aria-expanded", String(showDrafts));
        await expect(reopened.getByRole("button", { name: /^(Expand|Collapse) outline$/ })).toHaveAttribute("aria-expanded", String(showDocumentOutline));
        await reopened.close();
    }
});
