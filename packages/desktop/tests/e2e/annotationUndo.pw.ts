import { expect, test } from "@playwright/test";
import { getCmText, installTauriMock } from "./utils";

test.describe("annotation undo state safety", () => {
    test.beforeEach(async ({ page }) => {
        await installTauriMock(page);
        await page.goto("/");
        await expect(page.locator("#editor-document .cm-content")).toBeVisible();
    });

    test("deleting annotated text and undoing does not trigger state_unsafe_mutation", async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
            errors.push(error.message ?? String(error));
        });

        const editor = page.locator("#editor-document .cm-content").first();
        await editor.click();
        await page.keyboard.type("Hello world!");
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.press("Control+Alt+k");
        await editor.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.press("Backspace");
        await expect.poll(() => getCmText(editor)).toBe("");
        await page.keyboard.press("Control+z");
        await expect.poll(() => getCmText(editor)).toBe("Hello world!");
        expect(errors).toHaveLength(0);
    });
});
