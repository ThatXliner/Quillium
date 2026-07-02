/**
 * E2E test for Cmd+Alt+K inside an inline revision editor when multiple
 * revisions exist at the document level.
 *
 * Reproduction for a reported bug where the wrong modal opens.
 */

import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test.describe("Cmd+Alt+K inside inline editor with multiple doc-level revisions", () => {
    test("sub-revision from first revision's inline editor opens correct modal", async ({
        page,
    }) => {
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        // Type text
        await q.typeInEditor("Alpha Beta Gamma Delta");

        // Create second revision FIRST (later in document) to avoid atomic cursor issues
        // "Gamma" is at chars 11-16.
        // Position cursor at end, then shift-left to select "Gamma"
        await q.editor.click();
        await page.keyboard.press("End");
        // "Alpha Beta Gamma Delta" - from end, move left 6 to get to after "Gamma"
        await q.moveCursorLeft(6); // now at position 16 (after "Gamma")
        await q.selectLeft(5); // select "Gamma" (5 chars)
        await q.createRevision();
        await expect(q.annotationCards.first()).toBeVisible({ timeout: 5_000 });
        await page.waitForTimeout(300);

        // Now create first revision on "Alpha" (chars 0-5)
        // Click editor, go to start, select "Alpha"
        await q.editor.click();
        await page.keyboard.press("Home");
        await q.selectRight(5); // select "Alpha"
        await q.createRevision();
        await page.waitForTimeout(500);
        await expect(q.annotationCards).toHaveCount(2, { timeout: 5_000 });

        // Click on the first revision card to activate it (sorted by position, "Alpha" is first)
        await q.annotationCards.first().click();
        await page.waitForTimeout(300);

        // Find the inline editor inside the first revision card
        const firstCardInline = q.annotationCards
            .first()
            .locator(".revision-inline-editor .cm-content");
        await expect(firstCardInline).toBeVisible({ timeout: 5_000 });
        expect(await q.cmText(firstCardInline)).toBe("Alpha");

        // Select text in the inline editor and press Cmd+Alt+K
        await firstCardInline.click();
        await page.keyboard.press("Home");
        await q.selectRight(3); // select "Alp"
        await q.createRevision();
        await page.waitForTimeout(500);

        // A modal should open for the first revision (containing "Alpha")
        const modalEditor = page.locator("dialog[open] .revision-modal-editor .cm-content").first();
        await expect(modalEditor).toBeVisible({ timeout: 8_000 });
        const modalText = await q.cmText(modalEditor);
        expect(modalText).toBe("Alpha");

        // The modal should have a sub-revision annotation for "Alp"
        const modalCards = page.locator("dialog[open] .annotation-card-inline");
        await expect(modalCards.first()).toBeVisible({ timeout: 5_000 });

        q.expectNoPageErrors();
    });

    test("sub-revision from second revision's inline editor opens correct modal", async ({
        page,
    }) => {
        const q = new QuilliumPage(page, {
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        q.capturePageErrors();
        await q.setup();
        await q.goto();

        await q.typeInEditor("Alpha Beta Gamma Delta");

        // Create "Gamma" revision first (later in doc), then "Alpha"
        await q.editor.click();
        await page.keyboard.press("End");
        await q.moveCursorLeft(6);
        await q.selectLeft(5);
        await q.createRevision();
        await expect(q.annotationCards.first()).toBeVisible({ timeout: 5_000 });
        await page.waitForTimeout(300);

        await q.editor.click();
        await page.keyboard.press("Home");
        await q.selectRight(5);
        await q.createRevision();
        await page.waitForTimeout(500);
        await expect(q.annotationCards).toHaveCount(2, { timeout: 5_000 });

        // Click on the SECOND revision card to activate it (sorted by position, "Gamma" is second)
        await q.annotationCards.nth(1).click();
        await page.waitForTimeout(500);

        // Find the inline editor inside the second revision card
        const secondCardInline = q.annotationCards
            .nth(1)
            .locator(".revision-inline-editor .cm-content");
        await expect(secondCardInline).toBeVisible({ timeout: 5_000 });
        expect(await q.cmText(secondCardInline)).toBe("Gamma");

        // Select text and press Cmd+Alt+K
        await secondCardInline.click();
        await page.keyboard.press("Home");
        await q.selectRight(3); // select "Gam"
        await q.createRevision();
        await page.waitForTimeout(500);

        // A modal should open showing "Gamma", not "Alpha"
        const modalEditor = page.locator("dialog[open] .revision-modal-editor .cm-content").first();
        await expect(modalEditor).toBeVisible({ timeout: 8_000 });
        const modalText = await q.cmText(modalEditor);
        expect(modalText).toBe("Gamma");

        q.expectNoPageErrors();
    });
});
