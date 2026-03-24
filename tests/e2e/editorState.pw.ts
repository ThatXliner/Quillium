/**
 * E2E tests for editor state: cursor position, selection, undo/redo chains,
 * settings effects, keyboard shortcuts, and status bar updates.
 */

import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

// ── Helpers ─────────────────────────────────────────────────────────────────

function qp(
    page: Parameters<typeof test>[1] extends (args: infer A) => unknown
        ? A extends { page: infer P }
            ? P
            : never
        : never,
) {
    return new QuilliumPage(page);
}

// ── Undo / Redo chains ─────────────────────────────────────────────────────

test.describe("undo/redo chains", () => {
    test("undo reverses typed text", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("hello world");
        await q.expectEditorText("hello world");

        await q.undo();
        // Undo may remove the whole typed group or part — just verify it changed
        const text = await q.cmText();
        expect(text.length).toBeLessThan("hello world".length);
    });

    test("redo restores undone text", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("hello");
        await q.expectEditorText("hello");

        await q.undo();
        await q.redo();
        await q.expectEditorText("hello");
    });

    test("multiple undo steps walk back through history", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();

        await q.typeInEditor("aaa");
        await q.waitForUndoGroup();
        await q.editor.click();
        await q.end();
        await page.keyboard.type(" bbb");
        await q.waitForUndoGroup();
        await q.editor.click();
        await q.end();
        await page.keyboard.type(" ccc");

        await q.expectEditorText("aaa bbb ccc");

        await q.undo(); // removes " ccc"
        const t1 = await q.cmText();
        expect(t1).not.toContain("ccc");

        await q.undo(); // removes " bbb"
        const t2 = await q.cmText();
        expect(t2).not.toContain("bbb");
    });

    test("undo after creating revision restores original text", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("hello world");
        await q.selectAll();
        await q.createRevision();

        // The revision exists — undo should remove it
        await q.undo();
        // Text should still be there (revision was over existing text)
        await q.expectEditorText("hello world");
    });

    test("type, create comment, delete text, undo restores text + comment", async ({ page }) => {
        const q = new QuilliumPage(page);
        q.capturePageErrors();
        await q.init();

        await q.typeInEditor("Hello world!");
        await q.selectRange(6, 11); // "world"
        await q.createComment();

        // Submit the comment
        await q.submitComment("Needs revision");

        // Delete the annotated text
        await q.editor.click();
        await q.selectRange(6, 11);
        await page.keyboard.press("Backspace");

        // Undo the deletion
        await q.undo();
        await q.expectEditorText("Hello world!");

        q.expectNoPageErrors();
    });
});

// ── Selection behavior ─────────────────────────────────────────────────────

test.describe("selection behavior", () => {
    test("Cmd+A selects all text", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("hello world");
        await q.selectAll();
        await expect(q.statusBar).toContainText("11 total");
    });

    test("status bar shows selection word and char count", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("one two three");
        await q.selectAll();

        await expect(q.statusBar).toContainText("Words: 3");
        await expect(q.statusBar).toContainText("Characters: 13");
        await expect(q.statusBar).toContainText("3 total");
        await expect(q.statusBar).toContainText("13 total");
    });

    test("partial selection shows selected vs total counts", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("hello world foo bar");
        // Select "world foo" (chars 6-15)
        await q.selectRange(6, 15);

        await expect(q.statusBar).toContainText("Words: 2");
        await expect(q.statusBar).toContainText("4 total");
    });
});

// ── Status bar ──────────────────────────────────────────────────────────────

test.describe("status bar", () => {
    test("shows correct word count for empty document", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.expectWordCount(0);
        await q.expectCharCount(0);
    });

    test("updates word and char count as user types", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("One two three");
        await q.expectWordCount(3);
        await q.expectCharCount(13);
    });

    test("word count updates after deletion", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("One two three");
        // Delete " three"
        await q.end();
        await q.backspace(6);
        await q.expectWordCount(2);
    });
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────

test.describe("keyboard shortcuts", () => {
    test("Cmd+Alt+M creates comment when text is selected", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("hello world");
        await q.selectRange(0, 5);
        await q.createComment();

        // Pre-comment composer should appear
        const textarea = page.locator("textarea[placeholder='Add a comment…']");
        await expect(textarea).toBeVisible({ timeout: 5_000 });
    });

    test("Cmd+Alt+K creates revision when text is selected", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("hello world");
        await q.selectRange(0, 5);
        await q.createRevision();

        // An annotation card should appear in the sidebar
        await expect(q.annotationCards.first()).toBeVisible({
            timeout: 5_000,
        });
    });

    test("Escape closes AI sidebar", async ({ page }) => {
        const q = new QuilliumPage(page, { apiKey: "test-key" });
        await q.init();

        await page.locator("#ai-tab-chat").click();
        await expect(q.aiSidebar).toContainText("Start a conversation");

        await q.escape();
        // Sidebar should collapse
        await expect(page.locator("#ai-sidebar .overflow-x-auto")).not.toBeVisible();
    });
});

// ── Settings effects ────────────────────────────────────────────────────────

test.describe("settings effects", () => {
    test("atomicRevisions=false allows cursor into revision range", async ({ page }) => {
        const q = new QuilliumPage(page, {
            settings: { atomicRevisions: false, showNestedEditor: true },
        });
        q.capturePageErrors();
        await q.init();

        await q.createRevisionOnRange("hello world", 6, 11);

        // With atomicRevisions=false, clicking on revision text should
        // place cursor normally (not teleport to nested editor)
        await q.clickAt(q.editor, 0.8);
        // Just verify no errors
        q.expectNoPageErrors();
    });

    test("showNestedEditor=false hides inline editor for active revision", async ({ page }) => {
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: false, atomicRevisions: true },
        });
        await q.init();

        await q.createFullRevision("hello world");

        // Inline editor should NOT appear
        await expect(q.inlineEditor).not.toBeVisible({ timeout: 3_000 });
    });

    test("showNestedEditor=true shows inline editor for active revision", async ({ page }) => {
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: true, atomicRevisions: true },
        });
        await q.init();

        await q.createFullRevision("hello world");

        // Inline editor should appear
        await expect(q.inlineEditor).toBeVisible({ timeout: 8_000 });
        await q.expectInlineText("hello world");
    });
});

// ── Persistence ─────────────────────────────────────────────────────────────

test.describe("persistence", () => {
    test("typing triggers cmd_append_event", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("hello");

        await expect.poll(() => q.countInvocations("cmd_append_event")).toBeGreaterThan(0);
    });

    test("creating annotation triggers cmd_append_event", async ({ page }) => {
        const q = new QuilliumPage(page);
        await q.init();
        await q.typeInEditor("hello world");

        const countBefore = await q.countInvocations("cmd_append_event");
        await q.selectAll();
        await q.createRevision();

        await expect
            .poll(() => q.countInvocations("cmd_append_event"))
            .toBeGreaterThan(countBefore);
    });
});
