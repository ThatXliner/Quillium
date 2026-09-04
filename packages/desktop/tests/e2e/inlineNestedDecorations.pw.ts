import { type Locator, type Page, expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

async function pressWithFallback(
    page: Page,
    shortcut: string,
    fallbackShortcut: string,
    didWork: () => Promise<boolean>,
): Promise<void> {
    await page.keyboard.press(shortcut);
    if (await didWork()) return;
    await page.keyboard.press(fallbackShortcut);
}

async function createFullRevision(q: QuilliumPage, text: string): Promise<void> {
    await q.typeInEditor(text);
    await q.selectAll();
    await pressWithFallback(q.page, "ControlOrMeta+Alt+k", "Control+Alt+k", async () =>
        q.inlineEditor.isVisible({ timeout: 2_000 }).catch(() => false),
    );
    await q.expectInlineText(text);
}

async function createNestedComment(q: QuilliumPage, inlineEditor: Locator): Promise<void> {
    await inlineEditor.click();
    await q.home();
    await q.selectRight(5);
    await pressWithFallback(q.page, "ControlOrMeta+Shift+c", "Control+Shift+c", async () =>
        q.modalEditor.isVisible({ timeout: 2_000 }).catch(() => false),
    );
}

test.describe("inline nested annotation decorations", () => {
    test("nested comment decoration returns after switching parent versions back", async ({
        page,
    }) => {
        const q = new QuilliumPage(page, {
            settings: {
                showNestedEditor: true,
                atomicRevisions: true,
                aiEnabled: true,
                autoVersionOnRevisionCreate: false,
            },
        });
        q.capturePageErrors();
        await q.init();

        await createFullRevision(q, "hello world");

        const inlineEditor = q.inlineEditor;
        await createNestedComment(q, inlineEditor);
        await expect(q.modalEditor.locator(".cm-comment")).toBeVisible({ timeout: 5_000 });

        // The first Escape dismisses the pending comment composer and restores
        // focus to the modal editor; the second closes the revision modal.
        await q.escape();
        await q.escape();
        await expect(q.modalEditor).toBeHidden({ timeout: 5_000 });
        await expect(inlineEditor.locator(".cm-comment")).toBeVisible({ timeout: 5_000 });

        await page.getByRole("button", { name: /^New Version/i }).click();
        await q.expectInlineText("");

        await page.getByRole("button", { name: /^hello world$/i }).click();
        await q.expectInlineText("hello world");
        await expect(inlineEditor.locator(".cm-comment")).toBeVisible({ timeout: 5_000 });

        q.expectNoPageErrors();
    });
});
