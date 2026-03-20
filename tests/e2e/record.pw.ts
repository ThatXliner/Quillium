import { test } from "@playwright/test";
import { installTauriMock } from "./utils";

test("record", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await page.locator("#editor-document .cm-content").waitFor();
    await page.pause();
});
