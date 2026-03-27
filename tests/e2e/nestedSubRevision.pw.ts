/**
 * E2E tests for sub-revision creation from inline nested editors.
 *
 * Regression coverage for a bug where creating a sub-revision from an
 * inline editor inside a modal targeted the wrong editor level due to
 * annotation ID collision across nesting levels. The fix adds sourceView
 * disambiguation to the nested-annotation-create event.
 */

import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test.describe("sub-revision from inline editor targets correct text", () => {
    test("level-1 modal: sub-revision from inline editor opens level-2 modal with correct content", async ({
        page,
    }) => {
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        // Type "Ipsum Doleres?" and create a revision on the whole thing
        await q.typeInEditor("Ipsum Doleres?");
        await q.selectRange(0, 14);
        await q.createRevision();
        await expect(q.annotationCards.first()).toBeVisible({ timeout: 5_000 });

        // Open modal
        const modal = await q.openRevisionModal();
        await q.expectModalText("Ipsum Doleres?");

        // In the modal editor, select "Doleres" (chars 6-13) and create sub-revision
        await modal.click();
        await page.keyboard.press("Home");
        await q.moveCursorRight(6);
        await q.selectRight(7);
        await q.createRevision();
        await page.waitForTimeout(500);

        // An annotation card should appear in the modal sidebar
        await expect(q.modalAnnotationCards.first()).toBeVisible({ timeout: 5_000 });

        // The inline editor inside the modal should show "Doleres"
        const inlineEditor = page
            .locator("dialog[open] .revision-inline-editor .cm-content")
            .first();
        await expect(inlineEditor).toBeVisible({ timeout: 3_000 });
        const inlineText = await q.cmText(inlineEditor);
        expect(inlineText).toBe("Doleres");

        // Select "Dol" (chars 0-3) in the inline editor and create another sub-revision.
        // This should open a level-2 modal for the "Doleres" sub-revision, with a
        // pending command to auto-create a sub-sub-revision on "Dol".
        await inlineEditor.click();
        await page.keyboard.press("Home");
        await q.selectRight(3);
        await q.createRevision();
        await page.waitForTimeout(500);

        // The level-2 modal should show the sub-revision's full text "Doleres"
        // (not the parent's text "Ipsum Doleres?" — that would mean the event
        // was handled by the wrong level).
        const level2Modal = page.locator("dialog[open] .revision-modal-editor .cm-content").first();
        await expect(level2Modal).toBeVisible({ timeout: 8_000 });
        const level2Text = await q.cmText(level2Modal);
        expect(level2Text).toBe("Doleres");

        // The level-2 modal should have a sub-sub-revision annotation card
        // for "Dol" (created by the pending command).
        const level2Cards = page.locator("dialog[open] .annotation-card-inline");
        await expect(level2Cards.first()).toBeVisible({ timeout: 5_000 });

        q.expectNoPageErrors();
    });

    test("level-2 modal: sub-revision from inline editor opens level-3 modal correctly", async ({
        page,
    }) => {
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        // Create revision on "abcdefghij"
        await q.typeInEditor("abcdefghij");
        await q.selectRange(0, 10);
        await q.createRevision();
        await expect(q.annotationCards.first()).toBeVisible({ timeout: 5_000 });

        // Open level-1 modal
        const modal1 = await q.openRevisionModal();
        await q.expectModalText("abcdefghij");

        // Select "cdefgh" (chars 2-8) and create sub-revision → inline editor
        await modal1.click();
        await page.keyboard.press("Home");
        await q.moveCursorRight(2);
        await q.selectRight(6);
        await q.createRevision();
        await page.waitForTimeout(500);
        await expect(q.modalAnnotationCards.first()).toBeVisible({ timeout: 5_000 });

        // The inline editor should show "cdefgh"
        const inline1 = page.locator("dialog[open] .revision-inline-editor .cm-content").first();
        await expect(inline1).toBeVisible({ timeout: 3_000 });
        const inline1Text = await q.cmText(inline1);
        expect(inline1Text).toBe("cdefgh");

        // Select "def" (chars 1-4) in the inline editor → opens level-2 modal
        // for "cdefgh" with pending sub-revision on "def"
        await inline1.click();
        await page.keyboard.press("Home");
        await q.moveCursorRight(1);
        await q.selectRight(3);
        await q.createRevision();
        await page.waitForTimeout(500);

        const modal2 = page.locator("dialog[open] .revision-modal-editor .cm-content").first();
        await expect(modal2).toBeVisible({ timeout: 8_000 });
        // Level-2 modal shows the sub-revision's full text
        const modal2Text = await q.cmText(modal2);
        expect(modal2Text).toBe("cdefgh");

        // Should have a sub-sub-revision card for "def"
        const level2Cards = page.locator("dialog[open] .annotation-card-inline");
        await expect(level2Cards.first()).toBeVisible({ timeout: 5_000 });

        // The inline editor in level-2 should show "def"
        const inline2 = page.locator("dialog[open] .revision-inline-editor .cm-content").first();
        await expect(inline2).toBeVisible({ timeout: 3_000 });
        const inline2Text = await q.cmText(inline2);
        expect(inline2Text).toBe("def");

        // Select "e" in inline2 → opens level-3 modal for "def"
        await inline2.click();
        await page.keyboard.press("Home");
        await q.moveCursorRight(1);
        await q.selectRight(1);
        await q.createRevision();
        await page.waitForTimeout(500);

        const modal3 = page.locator("dialog[open] .revision-modal-editor .cm-content").first();
        await expect(modal3).toBeVisible({ timeout: 8_000 });
        // Level-3 modal shows the sub-sub-revision's full text
        const modal3Text = await q.cmText(modal3);
        expect(modal3Text).toBe("def");

        // Should have a sub-sub-sub-revision card for "e"
        const level3Cards = page.locator("dialog[open] .annotation-card-inline");
        await expect(level3Cards.first()).toBeVisible({ timeout: 5_000 });

        q.expectNoPageErrors();
    });

    test("sub-revision from modal inline editor opens at correct nesting level", async ({
        page,
    }) => {
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        // Create revision on "Alpha Beta"
        await q.typeInEditor("Alpha Beta");
        await q.selectRange(0, 10);
        await q.createRevision();
        await expect(q.annotationCards.first()).toBeVisible({ timeout: 5_000 });

        // Open modal
        const modal = await q.openRevisionModal();
        await q.expectModalText("Alpha Beta");

        // Create sub-revision on "Beta" (chars 6-10) → inline editor
        await modal.click();
        await page.keyboard.press("Home");
        await q.moveCursorRight(6);
        await q.selectRight(4);
        await q.createRevision();
        await page.waitForTimeout(500);
        await expect(q.modalAnnotationCards.first()).toBeVisible({ timeout: 5_000 });

        const inline = page.locator("dialog[open] .revision-inline-editor .cm-content").first();
        await expect(inline).toBeVisible({ timeout: 3_000 });
        expect(await q.cmText(inline)).toBe("Beta");

        // Select "Be" in inline editor → opens level-2 modal for "Beta"
        // (not for "Alpha Beta" — that was the original bug)
        await inline.click();
        await page.keyboard.press("Home");
        await q.selectRight(2);
        await q.createRevision();
        await page.waitForTimeout(500);

        const modal2 = page.locator("dialog[open] .revision-modal-editor .cm-content").first();
        await expect(modal2).toBeVisible({ timeout: 8_000 });

        // The key assertion: level-2 modal shows the sub-revision text "Beta",
        // NOT "Alpha Beta" (which would indicate the event was misrouted to
        // the wrong nesting level).
        expect(await q.cmText(modal2)).toBe("Beta");

        // Should have a sub-sub-revision card for "Be"
        const level2Cards = page.locator("dialog[open] .annotation-card-inline");
        await expect(level2Cards.first()).toBeVisible({ timeout: 5_000 });

        q.expectNoPageErrors();
    });
});
