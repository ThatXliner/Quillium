/**
 * Playwright tests for the nested editor undo bug.
 *
 * Bug scenario (reported by user):
 *   1. Create a revision over some text (e.g. "hello world")
 *   2. Add text in the nested editor (e.g. type " my b" → "hello my b world")
 *   3. Delete some of that added text in the nested editor (e.g. delete " my b" → "hello world")
 *   4. Focus main editor and press Cmd+Z
 *   Expected: "hello my b world" is restored
 *   Actual:   "some junk" — wrong content, bad offset translation
 */

import { expect, test, type Page } from "@playwright/test";

async function installTauriMock(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem("quillium_tutorial_seen", "1");

        let nextCallbackId = 1;
        const callbacks = new Map<number, (...args: unknown[]) => unknown>();
        const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

        (window as unknown as Record<string, unknown>).__TAURI_MOCK__ = { invokeCalls };

        (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
            invoke: async (cmd: string, args: unknown) => {
                invokeCalls.push({ cmd, args });
                if (cmd === "cmd_migrate_from_state_json") return { migrated: false, documentId: null };
                if (cmd === "cmd_list_documents") return [{ id: "doc-1", title: "Untitled", createdAt: 0, updatedAt: 0, wordCount: 0, previewText: "", tags: "[]" }];
                if (cmd === "cmd_create_document") return "doc-1";
                if (cmd === "cmd_create_draft") return "draft-1";
                if (cmd === "cmd_list_drafts") return [{ id: "draft-1", documentId: "doc-1", label: "Draft", createdAt: 0, isActive: true }];
                if (cmd === "cmd_load_document_state") return { snapshotStateJson: null, snapshotEventId: -1, eventsSince: [] };
                if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
                if (cmd === "cmd_create_snapshot") return null;
                if (cmd === "cmd_update_document_meta") return null;
                if (cmd === "get_api_key") return null;
                if (cmd === "plugin:event|listen") return 1;
                if (cmd === "plugin:event|unlisten") return null;
                return null;
            },
            transformCallback: (callback: (...args: unknown[]) => unknown) => {
                const id = nextCallbackId++;
                callbacks.set(id, callback);
                return id;
            },
            unregisterCallback: (id: number) => { callbacks.delete(id); },
            convertFileSrc: (filePath: string) => filePath,
        };

        (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
            unregisterListener: () => {},
        };
    });
}

/**
 * Simple version: create revision over all text (no prefix/suffix).
 * Used for tests that don't need to click outside the revision.
 */
async function createRevisionAndOpenNestedEditor(page: Page, text: string) {
    const editor = page.locator("#editor-document .cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(text);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+Alt+k");

    const nestedEditor = page.locator(".revision-recursive-editor .cm-content").first();
    await expect(nestedEditor).toBeVisible({ timeout: 8000 });
    return nestedEditor;
}

/** Get text content of a CodeMirror .cm-content element */
async function getCmText(locator: ReturnType<Page["locator"]>): Promise<string> {
    return locator.evaluate((el) => {
        const lines = el.querySelectorAll(".cm-line");
        if (lines.length > 0) {
            return Array.from(lines).map((l) => l.textContent ?? "").join("\n");
        }
        return el.textContent ?? "";
    });
}

test.describe("nested editor: add text then delete it, then undo from main editor", () => {
    test.beforeEach(async ({ page }) => {
        await installTauriMock(page);
        await page.goto("/");
        await expect(page.locator("#editor-document .cm-content")).toBeVisible();
    });

    test("undo restores the added text (partial delete scenario)", async ({ page }) => {
        // Step 1: create revision over "hello world"
        const nestedEditor = await createRevisionAndOpenNestedEditor(page, "hello world");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello world");

        // Step 2: in nested editor, position cursor after "hello" and type " my b"
        // resulting in "hello my b world"
        await nestedEditor.click();
        // Move to position after "hello" (5 chars in)
        await page.keyboard.press("Home");
        for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
        await page.keyboard.type(" my b");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello my b world");

        // Wait >250ms to create a separate undo group for the deletion
        await page.waitForTimeout(350);

        // Step 3: delete " my b" (5 chars) via backspace — now back to "hello world"
        for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello world");

        // Step 4: click main editor to focus it, then press Cmd+Z
        await page.locator("#editor-document .cm-content").click();
        await page.keyboard.press("ControlOrMeta+z");

        // Expected: the deletion is undone → nested editor shows "hello my b world"
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello my b world");
    });

    test("undo restores correct text when deletion is done mid-word", async ({ page }) => {
        // Revision over "hello world"
        const nestedEditor = await createRevisionAndOpenNestedEditor(page, "hello world");

        // Type "EXTRA " before "world" → "hello EXTRA world"
        // "hello world" is 11 chars; "world" starts at index 6
        // Navigate: Home to go to start, then 6 ArrowRight to get before "w"
        await nestedEditor.click();
        await page.keyboard.press("Home");
        for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
        await page.keyboard.type("EXTRA ");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello EXTRA world");

        await page.waitForTimeout(350);

        // Delete "EXTRA " (6 chars) via backspace — cursor is after "EXTRA ", so backspace 6 times
        for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello world");

        // Undo from main editor
        await page.locator("#editor-document .cm-content").click();
        await page.keyboard.press("ControlOrMeta+z");

        // Should restore "hello EXTRA world"
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello EXTRA world");
    });

    test("two undos restore through both states correctly", async ({ page }) => {
        // Revision over "hello world"
        const nestedEditor = await createRevisionAndOpenNestedEditor(page, "hello world");

        // Type " my b" after "hello"
        await nestedEditor.click();
        await page.keyboard.press("Home");
        for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
        await page.keyboard.type(" my b");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello my b world");

        await page.waitForTimeout(350);

        // Delete " my b" (backspace 5 times)
        for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello world");

        // Undo #1 from main editor: should restore "hello my b world"
        await page.locator("#editor-document .cm-content").click();
        await page.keyboard.press("ControlOrMeta+z");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello my b world");

        // Undo #2: should restore original "hello world"
        await page.keyboard.press("ControlOrMeta+z");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello world");
    });

    test("undo works when cursor moves OUT of revision (nested editor closes) then Cmd+Z", async ({ page }) => {
        // This is the exact reported bug scenario:
        // After editing in nested editor, user clicks OUTSIDE the revision in the main editor
        // (isActive becomes false → nested editor closes/destroys → flushAnnotationsToParent fires)
        // Then presses Cmd+Z from the main editor.
        //
        // We create "hello world" in the editor then make only "world" a revision,
        // leaving "hello " as text outside the revision to click on.
        const mainEditor = page.locator("#editor-document .cm-content");
        await mainEditor.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.type("hello world");
        // Select just "world" (last 5 chars)
        await page.keyboard.press("End");
        for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
        await page.keyboard.press("ControlOrMeta+Alt+k");

        // Nested editor opens for "world"
        const nestedEditor = page.locator(".revision-recursive-editor .cm-content").first();
        await expect(nestedEditor).toBeVisible({ timeout: 8000 });
        await expect.poll(() => getCmText(nestedEditor)).toBe("world");

        // Edit in nested editor: type "EXTRA " → "EXTRA world"
        await nestedEditor.click();
        await page.keyboard.press("Home");
        await page.keyboard.type("EXTRA ");
        await expect.poll(() => getCmText(nestedEditor)).toBe("EXTRA world");

        await page.waitForTimeout(350);

        // Delete "EXTRA " (6 chars) → back to "world"
        for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
        await expect.poll(() => getCmText(nestedEditor)).toBe("world");

        // Click at the very beginning of the parent editor to land on "hello "
        // (outside the revision range), which deactivates the revision.
        // Use bounding box to click at x=10% from left edge where "hello" starts.
        const editorBox = await mainEditor.boundingBox();
        if (editorBox) {
            await page.mouse.click(editorBox.x + 5, editorBox.y + editorBox.height / 2);
        }

        // Verify nested editor closed (revision deactivated)
        await expect(page.locator(".revision-recursive-editor .cm-content")).toBeHidden({ timeout: 3000 });

        // Press Cmd+Z — should undo the deletion of "EXTRA "
        await page.keyboard.press("ControlOrMeta+z");

        // Nested editor reopens with "EXTRA world" restored
        const reopenedNestedEditor = page.locator(".revision-recursive-editor .cm-content").first();
        await expect(reopenedNestedEditor).toBeVisible({ timeout: 5000 });
        await expect.poll(() => getCmText(reopenedNestedEditor)).toBe("EXTRA world");
    });

    test("undo works correctly when nested editor has focus (delegates to parent)", async ({ page }) => {
        // Revision over "hello world"
        const nestedEditor = await createRevisionAndOpenNestedEditor(page, "hello world");

        await nestedEditor.click();
        await page.keyboard.press("Home");
        for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
        await page.keyboard.type(" my b");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello my b world");

        await page.waitForTimeout(350);

        for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace");
        await expect.poll(() => getCmText(nestedEditor)).toBe("hello world");

        // Undo while nested editor still has focus — delegates to parent via makeParentUndoKeymap
        await page.keyboard.press("ControlOrMeta+z");

        await expect.poll(() => getCmText(nestedEditor)).toBe("hello my b world");
    });
});
