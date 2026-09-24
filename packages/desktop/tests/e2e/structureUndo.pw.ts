import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

test.use({ viewport: { width: 1440, height: 900 } });

test("draft deletion sits between older and newer prose in undo and redo", async ({ page }) => {
    const q = new QuilliumPage(page, { initialDoc: "before" });
    await q.init();
    const panel = page.locator('[aria-label="Draft tree"]');
    await page.getByRole("button", { name: "Branch from main", exact: true }).click();
    await expect(panel.locator('[aria-current="true"]')).toHaveText("new take");
    await panel.getByRole("button", { name: "main", exact: true }).click();
    await q.expectEditorText("before");
    await q.editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" old");
    await panel
        .getByRole("button", { name: "new take", exact: true })
        .hover({ position: { x: 4, y: 4 } });
    await page.getByRole("button", { name: "Delete new take", exact: true }).click();
    await expect(panel.getByText("new take", { exact: true })).toBeHidden();
    await q.editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" new");
    await page.keyboard.press("ControlOrMeta+z");
    await q.expectEditorText("before old");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(panel.getByText("new take", { exact: true })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+z");
    await q.expectEditorText("before");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await q.expectEditorText("before old");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(panel.getByText("new take", { exact: true })).toBeHidden();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await q.expectEditorText("before old new");
});

test("restoring an iteration preserves newer content redo while its parent relocks", async ({
    page,
}) => {
    const q = new QuilliumPage(page, { initialDoc: "before" });
    await q.setup();
    await page.addInitScript(() => {
        const tauri = (
            window as unknown as {
                __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
            }
        ).__TAURI_INTERNALS__;
        const invoke = tauri.invoke;
        tauri.invoke = async (cmd, args) => {
            const result = await invoke(cmd, args);
            if (cmd === "cmd_get_document")
                return { id: "doc-test-1", title: "Untitled", persistHistory: false, createdAt: 0 };
            if (cmd === "cmd_list_documents" && Array.isArray(result)) {
                return result.map((doc) => ({ ...doc, persistHistory: false }));
            }
            return result;
        };
    });
    await q.goto();
    const panel = page.locator('[aria-label="Draft tree"]');
    await page.getByRole("button", { name: "Iterate main", exact: true }).click();
    await expect(panel.locator('[aria-current="true"]')).toHaveText("v1");
    await page.getByRole("button", { name: "Delete v1", exact: true }).click();
    await expect(panel.getByText("v1", { exact: true })).toBeHidden();
    await q.editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" after");
    await page.keyboard.press("ControlOrMeta+z");
    await q.expectEditorText("before");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(panel.getByText("v1", { exact: true })).toBeVisible();
    await expect(page.getByText("This is an older version.", { exact: true })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(panel.getByText("v1", { exact: true })).toBeHidden();
    await expect(page.getByText("This is an older version.", { exact: true })).toBeHidden();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await q.expectEditorText("before after");
});

test("closing the active tab can be undone and redone from the editor", async ({ page }) => {
    const q = new QuilliumPage(page, { initialDoc: "original tab" });
    await q.init();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    const added = page.getByRole("tab", { name: "Tab 2" });
    await expect(added).toHaveAttribute("aria-selected", "true");
    await added.hover({ position: { x: 4, y: 4 } });
    await added.getByRole("button", { name: "Close tab" }).click();
    await expect(added).toBeHidden();
    await q.expectEditorText("original tab");
    await q.editor.click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(added).toBeVisible();
    await expect(page.getByRole("tab", { name: "Main", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(added).toBeHidden();
    await q.expectEditorText("original tab");
});

for (const cascade of [false, true]) {
    test(`keyboard undo and redo restore ${cascade ? "a deleted subtree" : "an orphaned parent"}`, async ({
        page,
    }) => {
        const q = new QuilliumPage(page, { initialDoc: "before" });
        await q.init();
        const panel = page.locator('[aria-label="Draft tree"]');
        await page.getByRole("button", { name: "Iterate main", exact: true }).click();
        await expect(panel.locator('[aria-current="true"]')).toHaveText("v1");
        await page.getByRole("button", { name: "Iterate v1", exact: true }).click();
        await expect(panel.locator('[aria-current="true"]')).toHaveText("v2");
        await panel
            .getByRole("button", { name: "v1", exact: true })
            .hover({ position: { x: 4, y: 4 } });
        await page.getByRole("button", { name: "Unlock v1", exact: true }).click();
        await page.getByRole("button", { name: "Delete v1", exact: true }).click();
        const modal = page.getByRole("dialog", { name: "Delete draft" });
        await modal
            .getByRole("button", { name: cascade ? /Delete all/ : "Keep the children" })
            .click();
        await expect(panel.getByRole("button", { name: "v1", exact: true })).toBeHidden();
        await q.editor.click();
        await page.keyboard.press("ControlOrMeta+z");
        await expect(panel.getByRole("button", { name: "v1", exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: "v2", exact: true })).toBeVisible();
        await expect(panel.locator('[aria-current="true"]')).toHaveText(cascade ? "main" : "v2");
        await page.keyboard.press("ControlOrMeta+Shift+z");
        await expect(panel.getByRole("button", { name: "v1", exact: true })).toBeHidden();
        if (cascade)
            await expect(panel.getByRole("button", { name: "v2", exact: true })).toBeHidden();
        else await expect(panel.getByRole("button", { name: "v2", exact: true })).toBeVisible();
    });
}
