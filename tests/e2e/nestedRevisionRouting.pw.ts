import { expect, test, type Page } from "@playwright/test";
import { getCmText, installTauriMock } from "./utils";

async function gotoEditor(page: Page, showNestedEditor: boolean) {
    await installTauriMock(page);
    await page.addInitScript(
        ({ showNestedEditor }) => {
            localStorage.setItem(
                "quillium-app-settings",
                JSON.stringify({ showNestedEditor, atomicRevisions: true }),
            );
        },
        { showNestedEditor },
    );
    await page.goto("/");
    await expect(page.locator("#editor-document .cm-content")).toBeVisible();
}

async function createRevisionModal(page: Page, text: string) {
    const editor = page.locator("#editor-document .cm-content").first();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(text);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+Alt+k");

    const existingModalEditor = page.locator(".revision-modal-editor .cm-content").first();
    if (await existingModalEditor.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect.poll(() => getCmText(existingModalEditor)).toBe(text);
        return existingModalEditor;
    }

    const expand = page.locator("[data-tutorial-action='expand-revision-modal']").first();
    await expect(expand).toBeVisible({ timeout: 5000 });
    await expand.click();

    const modalEditor = page.locator(".revision-modal-editor .cm-content").first();
    await expect(modalEditor).toBeVisible({ timeout: 8000 });
    await expect.poll(() => getCmText(modalEditor)).toBe(text);
    return modalEditor;
}

async function selectBetaInModal(page: Page, modalEditor: ReturnType<Page["locator"]>) {
    await modalEditor.click();
    await page.keyboard.press("Home");
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
}

function breadcrumbRevisionLabels(page: Page) {
    return page.locator(".revision-modal nav").getByText("Revision", { exact: true });
}

test.describe("nested revision routing in revision modal", () => {
    test("with inline nested editors enabled, Mod-Alt-K stays in the current modal level", async ({
        page,
    }) => {
        await gotoEditor(page, true);
        const modalEditor = await createRevisionModal(page, "alpha beta gamma");

        await selectBetaInModal(page, modalEditor);
        await page.keyboard.press("ControlOrMeta+Alt+k");

        await expect.poll(() => breadcrumbRevisionLabels(page).count()).toBe(1);
        await expect(page.locator(".revision-modal-editor .cm-content").first()).toBeVisible();
        await expect(page.locator(".revision-modal [data-tutorial-role='revision-card']")).toHaveCount(1);
    });

    test("with inline nested editors disabled, Mod-Alt-K pushes a child modal level", async ({
        page,
    }) => {
        await gotoEditor(page, false);
        const modalEditor = await createRevisionModal(page, "alpha beta gamma");

        await selectBetaInModal(page, modalEditor);
        await page.keyboard.press("ControlOrMeta+Alt+k");

        await expect.poll(() => breadcrumbRevisionLabels(page).count()).toBe(2);
        await expect(page.locator(".revision-modal [data-tutorial-role='revision-card']")).toHaveCount(1);
    });
});
