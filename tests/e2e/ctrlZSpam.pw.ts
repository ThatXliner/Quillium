import { expect, test } from "@playwright/test";
import { installTauriMock, getCmText } from "./utils";

test.describe("rapid ctrl+z spam resilience", () => {
    test.beforeEach(async ({ page }) => {
        await installTauriMock(page);
        await page.goto("/");
        await expect(
            page.locator("#editor-document .cm-content"),
        ).toBeVisible();
    });

    test("spamming ctrl+z after typing does not crash the editor", async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
            errors.push(error.message ?? String(error));
        });

        const editor = page
            .locator("#editor-document .cm-content")
            .first();
        await editor.click();

        // Type several words so there is undo history to chew through
        await page.keyboard.type("One ");
        await page.keyboard.type("Two ");
        await page.keyboard.type("Three ");
        await page.keyboard.type("Four ");
        await page.keyboard.type("Five");

        // Spam ctrl+z as fast as possible (20 rapid presses)
        const mod = process.platform === "darwin" ? "Meta" : "Control";
        for (let i = 0; i < 20; i++) {
            await page.keyboard.press(`${mod}+z`, { delay: 0 });
        }

        // Editor should be empty (all typing undone) and no errors
        await expect
            .poll(() => getCmText(editor), { timeout: 5000 })
            .toBe("");
        expect(errors).toHaveLength(0);
    });

    test("spamming ctrl+z after adding a comment does not crash", async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
            errors.push(error.message ?? String(error));
        });

        const editor = page
            .locator("#editor-document .cm-content")
            .first();
        await editor.click();
        await page.keyboard.type("Hello world!");

        // Select all and add a comment annotation
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.press("ControlOrMeta+Alt+k");

        // Type some more after the comment
        await editor.click();
        await page.keyboard.press("End");
        await page.keyboard.type(" More text here.");

        // Now spam ctrl+z rapidly
        const mod = process.platform === "darwin" ? "Meta" : "Control";
        for (let i = 0; i < 30; i++) {
            await page.keyboard.press(`${mod}+z`, { delay: 0 });
        }

        // No crashes — exact text state depends on undo granularity
        expect(errors).toHaveLength(0);

        // Editor should still be functional after the spam
        await editor.click();
        await page.keyboard.type("Still works!");
        const text = await getCmText(editor);
        expect(text).toContain("Still works!");
    });

    test("spamming ctrl+z after deleting annotated text does not crash", async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
            errors.push(error.message ?? String(error));
        });

        const editor = page
            .locator("#editor-document .cm-content")
            .first();
        await editor.click();

        // Create text with a comment
        await page.keyboard.type("Annotated text here");
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.press("ControlOrMeta+Alt+k");

        // Delete all the annotated text
        await editor.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.press("Backspace");

        await expect.poll(() => getCmText(editor)).toBe("");

        // Now spam ctrl+z to undo the deletion AND the comment AND the typing
        const mod = process.platform === "darwin" ? "Meta" : "Control";
        for (let i = 0; i < 30; i++) {
            await page.keyboard.press(`${mod}+z`, { delay: 0 });
        }

        // Wait for any deferred microtask cleanup
        await page.waitForTimeout(500);

        // The editor must still be present (no ErrorBanner crash)
        await expect(
            page.locator("#editor-document .cm-content"),
        ).toBeVisible({ timeout: 5000 });
        expect(errors).toHaveLength(0);

        // Editor should still be functional after the spam
        await editor.click();
        await page.keyboard.type("Still works!");
        const text = await getCmText(editor);
        expect(text).toContain("Still works!");
    });

    test("interleaved ctrl+z and ctrl+shift+z spam does not crash", async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
            errors.push(error.message ?? String(error));
        });

        const editor = page
            .locator("#editor-document .cm-content")
            .first();
        await editor.click();

        await page.keyboard.type("Hello world!");
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.press("ControlOrMeta+Alt+k");
        await editor.click();
        await page.keyboard.press("End");
        await page.keyboard.type(" Extra text.");

        // Rapidly alternate undo and redo
        const mod = process.platform === "darwin" ? "Meta" : "Control";
        for (let i = 0; i < 40; i++) {
            if (i % 3 === 0) {
                await page.keyboard.press(`${mod}+Shift+z`, {
                    delay: 0,
                });
            } else {
                await page.keyboard.press(`${mod}+z`, { delay: 0 });
            }
        }

        // No crashes — content state doesn't matter, just stability
        expect(errors).toHaveLength(0);

        // Editor should still be functional
        await editor.click();
        await page.keyboard.type("Still works!");
        const text = await getCmText(editor);
        expect(text).toContain("Still works!");
    });
});
