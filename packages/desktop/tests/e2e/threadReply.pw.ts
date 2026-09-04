/**
 * E2E tests for the Thread reply send button.
 *
 * Regression: the Send button was impossible to click because
 * `sendActive` required `isFocused && hasText`. Clicking the
 * button triggers blur on the textarea before the click event
 * fires, so `isFocused` was already false by the time onclick ran.
 */

import { type Page, expect, test } from "@playwright/test";
import { installTauriMock } from "./utils";

/**
 * Type some text, select it, create a comment with a message,
 * then click on the comment card to activate it (showing the
 * reply input). Returns a locator for the annotation card.
 */
async function setupCommentWithReply(page: Page) {
    const editor = page.locator("#editor-document .cm-content");
    await editor.click();
    await page.keyboard.type("hello world");
    // Select "world"
    await page.keyboard.press("End");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
    // Create comment (Cmd+Shift+C)
    await page.keyboard.press("Control+Shift+c");

    // The PreComment composer should appear — type a comment and submit
    const preComment = page.locator("textarea[placeholder='Add a comment…']");
    await expect(preComment).toBeVisible({ timeout: 5000 });
    await preComment.fill("This needs work");
    await page.keyboard.press("ControlOrMeta+Enter");

    // The comment card with Thread should now be visible. Scope to the
    // annotation card so a bare text=Comment doesn't match the AI context
    // sidebar's hidden "…comments and suggestions" hint.
    const commentCard = page.locator(".annotation-card", { hasText: "Comment" }).first();
    await expect(commentCard).toBeVisible({ timeout: 5000 });
    return commentCard;
}

test.describe("thread reply send button", () => {
    test.beforeEach(async ({ page }) => {
        await installTauriMock(page);
        await page.goto("/");
        // Match the editor-mount budget the QuilliumPage harness uses; the
        // default 5s is too tight for the initial load under parallel runs.
        await expect(page.locator("#editor-document .cm-content")).toBeVisible({
            timeout: 20_000,
        });
    });

    test("clicking Send button submits reply text", async ({ page }) => {
        await setupCommentWithReply(page);

        // The Thread reply textarea should be visible (card is active)
        const replyBox = page.locator("textarea[placeholder='Reply…']");
        await expect(replyBox).toBeVisible({ timeout: 5000 });

        // Type a reply
        await replyBox.fill("I agree, let me fix it");

        // Click the Send button — this was previously impossible due
        // to the blur race condition
        const sendButton = page.locator("button.rounded-full", { hasText: "Send" });
        await sendButton.click();

        // The reply should appear in the thread
        await expect(page.locator("text=I agree, let me fix it")).toBeVisible({ timeout: 5000 });

        // The textarea should be cleared after sending
        await expect(replyBox).toHaveValue("");
    });
});
