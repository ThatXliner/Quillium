/**
 * E2E tests for revision interaction flows:
 *   - Clicking on revision text teleports cursor into nested editor
 *   - Creating nested annotations (comment/revision) from inline editor
 *   - Annotation visibility in revision modal
 */

import { type Page, expect, test } from "@playwright/test";
import { getCmText, installTauriMock } from "./utils";

/**
 * Create a revision over "world" in "hello world", leaving "hello "
 * as clickable text outside the revision range.
 */
async function setupRevisionWithPrefix(page: Page) {
    const editor = page.locator("#editor-document .cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("hello world");
    // Select just "world" (last 5 chars)
    await page.keyboard.press("End");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Control+Alt+k");
    return editor;
}

/**
 * Create a revision over all text so the inline editor opens immediately.
 */
async function setupFullRevision(page: Page, text: string) {
    const editor = page.locator("#editor-document .cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(text);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Control+Alt+k");
    return editor;
}

test.describe("revision cursor teleport", () => {
    test.beforeEach(async ({ page }) => {
        await installTauriMock(page);
        await page.addInitScript(() => {
            localStorage.setItem(
                "quillium-app-settings",
                JSON.stringify({
                    showNestedEditor: true,
                    atomicRevisions: true,
                    autoVersionOnRevisionCreate: false,
                }),
            );
        });
        await page.goto("/");
        await expect(page.locator("#editor-document .cm-content")).toBeVisible({
            timeout: 40_000,
        });
    });

    test("clicking revision text opens inline editor with cursor", async ({ page }) => {
        await setupRevisionWithPrefix(page);

        // Wait for the inline editor to appear (revision is active after creation)
        const inlineEditor = page.locator(".revision-inline-editor .cm-content").first();
        await expect(inlineEditor).toBeVisible({ timeout: 8000 });
        await expect.poll(() => getCmText(inlineEditor)).toBe("world");

        // Click outside the revision to deactivate it
        const mainEditor = page.locator("#editor-document .cm-content");
        const box = await mainEditor.boundingBox();
        if (box) {
            await page.mouse.click(box.x + 5, box.y + box.height / 2);
        }

        // Verify inline editor closed
        await expect(inlineEditor).toBeHidden({ timeout: 3000 });

        // Click the actual revision mark rather than estimating its position from the
        // full-width editor box. The prose occupies only a small part of that box.
        const revisionText = page.locator("#editor-document .cm-revision").first();
        await expect(revisionText).toHaveText("world");
        await revisionText.click();

        // Inline editor should reopen
        const reopened = page.locator(".revision-inline-editor .cm-content").first();
        await expect(reopened).toBeVisible({ timeout: 8000 });
        await expect.poll(() => getCmText(reopened)).toBe("world");
    });

    test("clicking revision text while inline editor is already open places cursor", async ({
        page,
    }) => {
        await setupFullRevision(page, "hello world");

        const inlineEditor = page.locator(".revision-inline-editor .cm-content").first();
        await expect(inlineEditor).toBeVisible({ timeout: 8000 });
        await expect.poll(() => getCmText(inlineEditor)).toBe("hello world");

        // Click on the marked revision text in the main editor.
        const revisionText = page.locator("#editor-document .cm-revision").first();
        await expect(revisionText).toHaveText("hello world");
        await revisionText.click();

        // The inline editor should still be visible and focusable
        await expect(inlineEditor).toBeVisible();
        // Verify we can type in the inline editor (cursor was placed)
        await inlineEditor.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");
        await expect.poll(() => getCmText(inlineEditor)).toBe("hello world!");
    });
});

test.describe("nested annotation creation from inline editor", () => {
    test.beforeEach(async ({ page }) => {
        await installTauriMock(page);
        await page.addInitScript(() => {
            localStorage.setItem(
                "quillium-app-settings",
                JSON.stringify({
                    showNestedEditor: true,
                    atomicRevisions: true,
                    autoVersionOnRevisionCreate: false,
                }),
            );
        });
        await page.goto("/");
        await expect(page.locator("#editor-document .cm-content")).toBeVisible({
            timeout: 40_000,
        });
    });

    test("Mod-Alt-K in inline editor with selection opens modal", async ({ page }) => {
        await setupFullRevision(page, "hello world");

        const inlineEditor = page.locator(".revision-inline-editor .cm-content").first();
        await expect(inlineEditor).toBeVisible({ timeout: 8000 });
        await expect.poll(() => getCmText(inlineEditor)).toBe("hello world");

        // Select "hello" in the inline editor
        await inlineEditor.click();
        await page.keyboard.press("Home");
        for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");

        // Press Mod-Alt-K to create a nested revision
        await page.keyboard.press("Control+Alt+k");

        // A revision modal should open
        const modalEditor = page.locator(".revision-modal-editor .cm-content").first();
        await expect(modalEditor).toBeVisible({ timeout: 8000 });
    });

    test("Mod-Shift-M in inline editor with selection opens modal for comment", async ({
        page,
    }) => {
        await setupFullRevision(page, "hello world");

        const inlineEditor = page.locator(".revision-inline-editor .cm-content").first();
        await expect(inlineEditor).toBeVisible({ timeout: 8000 });

        // Select "world" in the inline editor
        await inlineEditor.click();
        await page.keyboard.press("End");
        for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");

        // Press Mod-Shift-M to create a nested comment.
        await page.keyboard.press("Control+Shift+m");

        // A revision modal should open (to host the nested comment)
        const modalEditor = page.locator(".revision-modal-editor .cm-content").first();
        await expect(modalEditor).toBeVisible({ timeout: 8000 });
    });
});

test.describe("revision modal annotation visibility", () => {
    test.beforeEach(async ({ page }) => {
        await installTauriMock(page);
        await page.addInitScript(() => {
            localStorage.setItem(
                "quillium-app-settings",
                JSON.stringify({
                    showNestedEditor: true,
                    atomicRevisions: true,
                    autoVersionOnRevisionCreate: false,
                }),
            );
        });
        await page.goto("/");
        await expect(page.locator("#editor-document .cm-content")).toBeVisible({
            timeout: 40_000,
        });
    });

    test("creating a comment inside the modal shows it in the annotations sidebar", async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
            errors.push(error.message ?? String(error));
        });

        await setupFullRevision(page, "hello world");

        // Open the revision modal
        const expand = page.locator("[data-tutorial-action='expand-revision-modal']").first();
        if (await expand.isVisible({ timeout: 4000 }).catch(() => false)) {
            await expand.dispatchEvent("click");
        }
        const modalEditor = page.locator(".revision-modal-editor .cm-content").first();
        await expect(modalEditor).toBeVisible({ timeout: 8000 });
        await expect.poll(() => getCmText(modalEditor)).toBe("hello world");

        // Select "hello" in the modal editor
        await modalEditor.click();
        await page.keyboard.press("Home");
        for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");

        // Create a comment via Mod-Shift-M.
        await page.keyboard.press("Control+Shift+m");

        // The modal's annotations sidebar should show the annotation card
        const annotationCard = page.locator("dialog .annotation-card-inline").first();
        await expect(annotationCard).toBeVisible({ timeout: 5000 });

        expect(errors).toHaveLength(0);
    });

    test("creating a revision inside the modal shows it in the annotations sidebar", async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
            errors.push(error.message ?? String(error));
        });

        await setupFullRevision(page, "hello world");

        // Open the revision modal
        const expand = page.locator("[data-tutorial-action='expand-revision-modal']").first();
        if (await expand.isVisible({ timeout: 4000 }).catch(() => false)) {
            await expand.dispatchEvent("click");
        }
        const modalEditor = page.locator(".revision-modal-editor .cm-content").first();
        await expect(modalEditor).toBeVisible({ timeout: 8000 });
        await expect.poll(() => getCmText(modalEditor)).toBe("hello world");

        // Select "world" in the modal editor
        await modalEditor.click();
        await page.keyboard.press("End");
        for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");

        // Create a nested revision via Mod-Alt-K
        await page.keyboard.press("Control+Alt+k");

        // Wait for annotation to be processed
        await page.waitForTimeout(1000);

        // The modal's annotations sidebar should show the annotation card
        const annotationCard = page.locator("dialog .annotation-card-inline").first();
        await expect(annotationCard).toBeVisible({ timeout: 5000 });

        expect(errors).toHaveLength(0);
    });

    test("no page errors when creating and undoing annotations in modal", async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
            errors.push(error.message ?? String(error));
        });

        await setupFullRevision(page, "hello world");

        // Open the revision modal
        const expand = page.locator("[data-tutorial-action='expand-revision-modal']").first();
        if (await expand.isVisible({ timeout: 4000 }).catch(() => false)) {
            await expand.dispatchEvent("click");
        }
        const modalEditor = page.locator(".revision-modal-editor .cm-content").first();
        await expect(modalEditor).toBeVisible({ timeout: 8000 });

        // Type in the modal
        await modalEditor.click();
        await page.keyboard.press("End");
        await page.keyboard.type("!");
        await expect.poll(() => getCmText(modalEditor)).toBe("hello world!");

        // Undo from the modal (delegates to parent)
        await page.keyboard.press("Control+z");
        await expect.poll(() => getCmText(modalEditor)).toBe("hello world");

        // Redo
        await page.keyboard.press("Control+y");
        await expect.poll(() => getCmText(modalEditor)).toBe("hello world!");

        expect(errors).toHaveLength(0);
    });

    test("nested annotations survive when opening a deeper revision", async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
            errors.push(error.message ?? String(error));
        });

        await setupFullRevision(page, "hello world");

        // Open the revision modal
        const expand = page.locator("[data-tutorial-action='expand-revision-modal']").first();
        if (await expand.isVisible({ timeout: 4000 }).catch(() => false)) {
            await expand.dispatchEvent("click");
        }
        const modalEditor = page.locator(".revision-modal-editor .cm-content").first();
        await expect(modalEditor).toBeVisible({ timeout: 8000 });
        await expect.poll(() => getCmText(modalEditor)).toBe("hello world");

        // Create two nested revisions in the modal
        // First: select "hello"
        await modalEditor.click();
        await page.keyboard.press("Home");
        for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
        await page.keyboard.press("Control+Alt+k");
        await page.waitForTimeout(500);

        // Second: select "world"
        await modalEditor.click();
        await page.keyboard.press("End");
        for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
        await page.keyboard.press("Control+Alt+k");

        // Wait for both annotation cards to appear
        const cards = page.locator("dialog .annotation-card-inline");
        await expect(cards).toHaveCount(2, { timeout: 5000 });

        // Open the first nested revision via its expand button
        const firstCard = cards.first();
        const expandBtn = firstCard.locator("[data-tutorial-action='expand-revision-modal']");
        await expect(expandBtn).toBeVisible({ timeout: 3000 });
        await expandBtn.dispatchEvent("click");

        // The deeper modal's editor should contain the revision text.
        // Use dialog[open] to target the visible (child) modal, not the
        // hidden parent modal which is still in the DOM.
        const deeperEditor = page
            .locator("dialog[open] .revision-modal-editor .cm-content")
            .first();
        await expect(deeperEditor).toBeVisible({ timeout: 5000 });
        await expect.poll(() => getCmText(deeperEditor)).toBe("hello");

        // Go back to parent modal
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);

        // Parent modal should reopen with original text and both annotations
        const parentEditor = page
            .locator("dialog[open] .revision-modal-editor .cm-content")
            .first();
        await expect(parentEditor).toBeVisible({ timeout: 5000 });
        await expect.poll(() => getCmText(parentEditor)).toBe("hello world");

        const parentCards = page.locator("dialog[open] .annotation-card-inline");
        await expect(parentCards).toHaveCount(2, { timeout: 5000 });

        expect(errors).toHaveLength(0);
    });
});
