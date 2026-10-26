/**
 * E2E tests for comment submission, cancellation, and thread replies.
 *
 * Regression: the Send button was impossible to click because
 * `sendActive` required `isFocused && hasText`. Clicking the
 * button triggers blur on the textarea before the click event
 * fires, so `isFocused` was already false by the time onclick ran.
 */

import { type Page, expect, test } from "@playwright/test";
import { installTauriMock } from "./utils";

/**
 * Select a passage and open the new-comment composer.
 */
async function setupPendingComment(page: Page) {
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
    return preComment;
}

async function setupCommentWithReply(page: Page) {
    const preComment = await setupPendingComment(page);
    await preComment.fill("This needs work");
    await preComment.press("Meta+Enter");

    // The comment card with Thread should now be visible. Scope to the
    // annotation card so a bare text=Comment doesn't match the AI context
    // sidebar's hidden "…comments and suggestions" hint.
    const commentCard = page.locator(".annotation-card", { hasText: "Comment" }).first();
    await expect(commentCard).toBeVisible({ timeout: 5000 });
    return commentCard;
}

test.describe("comment composers", () => {
    let pageErrors: string[];

    test.beforeEach(async ({ page }) => {
        pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await installTauriMock(page);
        await page.goto("/");
        // Match the editor-mount budget the QuilliumPage harness uses; the
        // default 5s is too tight for the initial load under parallel runs.
        await expect(page.locator("#editor-document .cm-content")).toBeVisible({
            timeout: 20_000,
        });
    });

    test.afterEach(() => {
        // Submission can save the comment before throwing during draft cleanup.
        // Merely checking that the comment appeared would miss that crash.
        expect(pageErrors).toEqual([]);
    });

    test("Command+Enter submits a new comment and clears its reply draft", async ({ page }) => {
        await setupCommentWithReply(page);
        const replyBox = page.getByPlaceholder("Reply…");
        await expect(page.getByText("This needs work", { exact: true })).toBeVisible();
        await expect(replyBox).toHaveValue("");

        await replyBox.fill("Keyboard reply");
        await replyBox.press("Meta+Enter");
        await expect(page.getByText("Keyboard reply", { exact: true })).toBeVisible();
        await expect(replyBox).toHaveValue("");
    });

    test("cancel clears the pending comment draft without a crash", async ({ page }) => {
        const preComment = await setupPendingComment(page);
        await preComment.fill("Discard this draft");
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(preComment).toHaveCount(0);
        await expect(page.locator(".annotation-card")).toHaveCount(0);

        // Undo restores the annotation; its canceled composer text stays cleared.
        await page.locator("#editor-document .cm-content").click();
        await page.keyboard.press("ControlOrMeta+z");
        await expect(preComment).toBeVisible();
        await expect(preComment).toHaveValue("");
        await page.keyboard.press("Escape");
        await page.keyboard.press("ControlOrMeta+Shift+z");
        await expect(preComment).toHaveCount(0);
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
