/**
 * E2E tests for annotation lifecycle: creation → interaction → deletion
 * for all three annotation types, plus overlapping annotations and
 * undo/redo across the full lifecycle.
 */

import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

// ── Comment lifecycle ───────────────────────────────────────────────────────

test.describe("comment lifecycle", () => {
    test.beforeEach(async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
    });

    test("create comment → submit text → card appears", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.typeInEditor("hello world");
        await q.selectRange(6, 11); // "world"
        await q.createComment();
        await q.submitComment("This needs work");

        // Comment card should be visible in sidebar
        const card = page.locator("text=Comment").first();
        await expect(card).toBeVisible({ timeout: 5_000 });
    });

    test("reply to comment shows in thread", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.typeInEditor("hello world");
        await q.selectRange(6, 11);
        await q.createComment();
        await q.submitComment("Needs revision");

        // Reply
        const replyBox = page.locator("textarea[placeholder='Reply…']");
        await expect(replyBox).toBeVisible({ timeout: 5_000 });
        await replyBox.fill("I agree");
        const sendButton = page.locator("button.rounded-full", {
            hasText: "Send",
        });
        await sendButton.click();

        await expect(page.locator("text=I agree")).toBeVisible({
            timeout: 5_000,
        });
    });

    test("deleting commented text removes comment from sidebar", async ({
        page,
    }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.typeInEditor("hello world");
        await q.selectRange(6, 11);
        await q.createComment();
        await q.submitComment("Note");

        // Now select and delete the commented text
        await q.editor.click();
        await q.selectRange(6, 11);
        await page.keyboard.press("Backspace");

        // Comment card should disappear (range collapsed)
        await expect(page.locator(".annotation-card-inline")).toHaveCount(0, {
            timeout: 5_000,
        });
    });
});

// ── Revision lifecycle ──────────────────────────────────────────────────────

test.describe("revision lifecycle", () => {
    test.beforeEach(async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
    });

    test("create revision → card appears in sidebar", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createFullRevision("hello world");
        await expect(q.annotationCards.first()).toBeVisible({
            timeout: 5_000,
        });
    });

    test("revision inline editor shows correct text", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createFullRevision("hello world");
        await q.expectInlineText("hello world");
    });

    test("editing in inline editor updates parent doc", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createFullRevision("hello world");
        const inline = q.inlineEditor;
        await expect(inline).toBeVisible({ timeout: 8_000 });

        await inline.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");
        await q.expectInlineText("hello world!");
    });

    test("revision modal shows correct text", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createRevisionAndOpenModal("hello world");
        await q.expectModalText("hello world");
    });

    test("editing in modal updates content", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        const modal = await q.createRevisionAndOpenModal("hello world");
        await modal.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");
        await q.expectModalText("hello world!");

        q.expectNoPageErrors();
    });

    test("escape closes revision modal", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createRevisionAndOpenModal("hello world");
        await q.escape();
        await expect(q.modalEditor).not.toBeVisible({ timeout: 3_000 });
    });

    test("deleting revision text and undoing restores revision", async ({
        page,
    }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        await q.typeInEditor("hello world");
        await q.selectAll();
        await q.createRevision();

        // Delete all text
        await q.editor.click();
        await q.selectAll();
        await page.keyboard.press("Backspace");
        await q.expectEditorText("");

        // Undo — text and revision should be restored
        await q.undo();
        await q.expectEditorText("hello world");

        q.expectNoPageErrors();
    });
});

// ── Revision with nested annotations ────────────────────────────────────────

test.describe("revision with nested annotations", () => {
    test("create comment inside modal editor", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        const modal = await q.createRevisionAndOpenModal("hello world");

        // Select "hello" in the modal
        await modal.click();
        await page.keyboard.press("Home");
        await q.selectRight(5);
        await q.createComment();

        // Annotation card should appear in the modal's sidebar
        await expect(q.modalAnnotationCards.first()).toBeVisible({
            timeout: 5_000,
        });

        q.expectNoPageErrors();
    });

    test("create nested revision inside modal", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        const modal = await q.createRevisionAndOpenModal("hello world");

        // Select "world" in the modal
        await modal.click();
        await page.keyboard.press("End");
        await q.selectLeft(5);
        await q.createRevision();

        await page.waitForTimeout(500);

        // Nested annotation card should appear
        await expect(q.modalAnnotationCards.first()).toBeVisible({
            timeout: 5_000,
        });

        q.expectNoPageErrors();
    });
});

// ── Undo/redo with annotations ──────────────────────────────────────────────

test.describe("annotation undo/redo", () => {
    test("undo revision creation removes annotation card", async ({
        page,
    }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createFullRevision("hello world");
        await expect(q.annotationCards.first()).toBeVisible({
            timeout: 5_000,
        });

        await q.undo();
        await expect(q.annotationCards).toHaveCount(0, { timeout: 5_000 });
    });

    test("redo after undo of revision creation restores card", async ({
        page,
    }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createFullRevision("hello world");
        await q.undo();
        await q.redo();

        await expect(q.annotationCards.first()).toBeVisible({
            timeout: 5_000,
        });
    });

    test("undo in modal editor delegates to parent correctly", async ({
        page,
    }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        const modal = await q.createRevisionAndOpenModal("hello world");

        // Edit in modal
        await modal.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");
        await q.expectModalText("hello world!");

        // Undo from modal
        await q.undo();
        await q.expectModalText("hello world");

        // Redo
        await q.redo();
        await q.expectModalText("hello world!");

        q.expectNoPageErrors();
    });

    test("type in nested editor, delete, undo restores (the reported bug)", async ({
        page,
    }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        const modal = await q.createRevisionAndOpenModal("hello world");

        // Type " my b" after "hello"
        await modal.click();
        await page.keyboard.press("Home");
        await q.moveCursorRight(5);
        await page.keyboard.type(" my b");
        await q.expectModalText("hello my b world");

        await q.waitForUndoGroup();

        // Delete " my b"
        await q.backspace(5);
        await q.expectModalText("hello world");

        // Undo deletion
        await q.undo();
        await q.expectModalText("hello my b world");

        q.expectNoPageErrors();
    });
});

// ── Deep nesting ────────────────────────────────────────────────────────────

test.describe("deep modal nesting", () => {
    test("three levels of nesting: open, edit, close back", async ({
        page,
    }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        // Level 1: create revision and open modal
        const modal1 = await q.createRevisionAndOpenModal("hello world");
        await q.expectModalText("hello world");

        // Level 2: create nested revision in modal on "hello"
        await modal1.click();
        await page.keyboard.press("Home");
        await q.selectRight(5);
        await q.createRevision();
        await page.waitForTimeout(500);

        // Open the nested revision's modal
        const nestedExpand = page
            .locator(
                "dialog[open] [data-tutorial-action='expand-revision-modal']",
            )
            .first();
        await expect(nestedExpand).toBeVisible({ timeout: 5_000 });
        await nestedExpand.click();

        const modal2 = page
            .locator("dialog[open] .revision-modal-editor .cm-content")
            .first();
        await expect(modal2).toBeVisible({ timeout: 8_000 });

        // Edit in level 2
        await modal2.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");

        // Close level 2
        await q.escape();
        await page.waitForTimeout(500);

        // Back to level 1 — text should show "hello!" for that range
        const parentModal = page
            .locator("dialog[open] .revision-modal-editor .cm-content")
            .first();
        await expect(parentModal).toBeVisible({ timeout: 5_000 });

        q.expectNoPageErrors();
    });
});

// ── Multiple annotations ────────────────────────────────────────────────────

test.describe("multiple annotations", () => {
    test("create two revisions on non-overlapping ranges", async ({
        page,
    }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        await q.typeInEditor("hello world");

        // Revision on "hello" [0,5]
        await q.selectRange(0, 5);
        await q.createRevision();
        await page.waitForTimeout(500);

        // Revision on "world" [6,11]
        await q.editor.click();
        await q.selectRange(6, 11);
        await q.createRevision();

        // Should have 2 annotation cards
        await expect(q.annotationCards).toHaveCount(2, { timeout: 5_000 });

        q.expectNoPageErrors();
    });

    test("comment + revision on different ranges", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        await q.typeInEditor("hello world");

        // Comment on "hello"
        await q.selectRange(0, 5);
        await q.createComment();
        await q.submitComment("Note about hello");

        // Revision on "world"
        await q.editor.click();
        await q.selectRange(6, 11);
        await q.createRevision();

        await expect(q.annotationCards).toHaveCount(2, { timeout: 5_000 });

        q.expectNoPageErrors();
    });
});
