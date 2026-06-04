/**
 * E2E tests for nested editor and modal editor interactions:
 *   - Inline editor open/close lifecycle
 *   - Modal editor open/close/flush
 *   - Version switching
 *   - Undo/redo across modal boundaries
 *   - Deep nesting (3+ levels)
 *   - Cursor position after modal operations
 */

import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

// ── Inline editor lifecycle ─────────────────────────────────────────────────

test.describe("inline editor lifecycle", () => {
    test.beforeEach(async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
    });

    test("inline editor opens when revision becomes active", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createRevisionOnRange("hello world", 6, 11);
        await expect(q.inlineEditor).toBeVisible({ timeout: 8_000 });
        await q.expectInlineText("world");
    });

    test("inline editor closes when cursor moves outside revision", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createRevisionOnRange("hello world", 6, 11);
        await expect(q.inlineEditor).toBeVisible({ timeout: 8_000 });

        // Click at the very start of the editor (on "hello")
        await q.clickEditorStart();
        await expect(q.inlineEditor).toBeHidden({ timeout: 3_000 });
    });

    test("clicking back on revision text reopens inline editor", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createRevisionOnRange("hello world", 6, 11);
        await expect(q.inlineEditor).toBeVisible({ timeout: 8_000 });

        // Click outside
        await q.clickEditorStart();
        await expect(q.inlineEditor).toBeHidden({ timeout: 3_000 });

        // Click back on "world"
        await q.clickAt(q.editor, 0.8);
        await expect(q.inlineEditor).toBeVisible({ timeout: 8_000 });
    });

    test("typing in inline editor updates parent doc", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createFullRevision("hello");
        await expect(q.inlineEditor).toBeVisible({ timeout: 8_000 });

        await q.inlineEditor.click();
        await page.keyboard.press("End");
        await page.keyboard.type(" world");
        await q.expectInlineText("hello world");
    });
});

// ── Modal editor lifecycle ──────────────────────────────────────────────────

test.describe("modal editor lifecycle", () => {
    test("modal opens via expand button and shows correct text", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createRevisionAndOpenModal("hello world");
        await q.expectModalText("hello world");
    });

    test("escape closes modal", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.setup();
        await q.goto();

        await q.createRevisionAndOpenModal("hello world");
        await q.escape();
        await expect(q.modalEditor).not.toBeVisible({ timeout: 3_000 });
    });

    test("modal flush: edits persist after close", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        const modal = await q.createRevisionAndOpenModal("hello world");
        await modal.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");
        await q.expectModalText("hello world!");

        // Close modal — text should flush to parent
        await q.escape();
        await page.waitForTimeout(500);

        // Reopen — should show the edited text
        await q.openRevisionModal();
        await q.expectModalText("hello world!");

        q.expectNoPageErrors();
    });

    test("undo in modal delegates to parent", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        const modal = await q.createRevisionAndOpenModal("hello world");

        // Type
        await modal.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");
        await q.expectModalText("hello world!");

        // Undo from modal (delegates to parent)
        await q.undo();
        await q.expectModalText("hello world");

        // Redo
        await q.redo();
        await q.expectModalText("hello world!");

        q.expectNoPageErrors();
    });
});

// ── Undo/redo across modal boundaries ───────────────────────────────────────

test.describe("undo/redo across modal boundaries", () => {
    test("edit in modal, close, undo from main editor", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        const modal = await q.createRevisionAndOpenModal("hello");
        await modal.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");
        await q.expectModalText("hello!");

        // Close modal
        await q.escape();
        await page.waitForTimeout(500);

        // Undo from main editor
        await q.editor.click();
        await q.undo();

        // Reopen to verify undo took effect
        await q.openRevisionModal();
        await q.expectModalText("hello");

        q.expectNoPageErrors();
    });

    test("multiple edits in modal, close, undo all from main editor", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        const modal = await q.createRevisionAndOpenModal("abc");

        // First edit
        await modal.click();
        await page.keyboard.press("End");
        await page.keyboard.type("1");
        await q.expectModalText("abc1");
        await q.waitForUndoGroup();

        // Second edit
        await page.keyboard.type("2");
        await q.expectModalText("abc12");

        // Close
        await q.escape();
        await page.waitForTimeout(500);

        // Undo both from main editor
        await q.editor.click();
        await q.undo();
        await q.undo();

        // Verify
        await q.openRevisionModal();
        await q.expectModalText("abc");

        q.expectNoPageErrors();
    });
});

// ── Deep nesting ────────────────────────────────────────────────────────────

test.describe("deep nesting", () => {
    test("nested annotations survive parent modal close/reopen", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        // Create and open level 1 modal
        const modal1 = await q.createRevisionAndOpenModal("hello world");

        // Create two nested revisions
        await modal1.click();
        await page.keyboard.press("Home");
        await q.selectRight(5);
        await q.createRevision();
        await page.waitForTimeout(500);

        await modal1.click();
        await page.keyboard.press("End");
        await q.selectLeft(5);
        await q.createRevision();

        await expect(q.modalAnnotationCards).toHaveCount(2, {
            timeout: 5_000,
        });

        // Open nested modal (first card)
        const nestedExpand = page
            .locator("dialog[open] [data-tutorial-action='expand-revision-modal']")
            .first();
        await expect(nestedExpand).toBeVisible({ timeout: 3_000 });
        await nestedExpand.click();

        const nestedModal = page.locator("dialog[open] .revision-modal-editor .cm-content").first();
        await expect(nestedModal).toBeVisible({ timeout: 5_000 });

        // Close nested modal
        await q.escape();
        await page.waitForTimeout(500);

        // Parent modal should reopen with both annotations
        const parentModal = page.locator("dialog[open] .revision-modal-editor .cm-content").first();
        await expect(parentModal).toBeVisible({ timeout: 5_000 });

        const parentCards = page.locator("dialog[open] .annotation-card-inline");
        await expect(parentCards).toHaveCount(2, { timeout: 5_000 });

        q.expectNoPageErrors();
    });

    test("edit at level 2, undo at level 2, verify at level 1", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        // Level 1
        const modal1 = await q.createRevisionAndOpenModal("hello world");

        // Create nested revision on "hello"
        await modal1.click();
        await page.keyboard.press("Home");
        await q.selectRight(5);
        await q.createRevision();
        await page.waitForTimeout(500);

        // Open level 2
        const expand = page
            .locator("dialog[open] [data-tutorial-action='expand-revision-modal']")
            .first();
        await expect(expand).toBeVisible({ timeout: 5_000 });
        await expand.dispatchEvent("click");

        const modal2 = page.locator("dialog[open] .revision-modal-editor .cm-content").first();
        await expect(modal2).toBeVisible({ timeout: 8_000 });

        // Edit at level 2
        await modal2.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");

        // Undo at level 2
        await q.undo();

        // Close level 2
        await q.escape();
        await page.waitForTimeout(500);

        // Level 1 should show "hello world" unchanged
        const parentModal = page.locator("dialog[open] .revision-modal-editor .cm-content").first();
        await expect(parentModal).toBeVisible({ timeout: 5_000 });

        const text = await q.cmText(parentModal);
        expect(text).toBe("hello world");

        q.expectNoPageErrors();
    });
});

// ── No-error scenarios ──────────────────────────────────────────────────────

test.describe("no page errors during complex flows", () => {
    test("rapid open/close of modal", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        await q.createFullRevision("hello world");

        for (let i = 0; i < 3; i++) {
            await q.openRevisionModal();
            await q.escape();
            await page.waitForTimeout(300);
        }

        q.expectNoPageErrors();
    });

    test("edit in inline, open modal, edit in modal, close, undo", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        await q.createFullRevision("hello");
        const inline = q.inlineEditor;
        await expect(inline).toBeVisible({ timeout: 8_000 });

        // Edit inline
        await inline.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");

        // Open modal
        const modal = await q.openRevisionModal();
        await q.expectModalText("hello!");

        // Edit in modal
        await modal.click();
        await page.keyboard.press("End");
        await page.keyboard.type("?");
        await q.expectModalText("hello!?");

        // Close modal
        await q.escape();
        await page.waitForTimeout(500);

        // Undo from main editor
        await q.editor.click();
        await q.undo();

        q.expectNoPageErrors();
    });
});
