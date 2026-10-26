import { type Locator, type Page, expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

async function drag(page: Page, handle: Locator, dx: number, dy: number): Promise<void> {
    const bounds = await handle.boundingBox();
    if (!bounds) throw new Error("Resize handle is not visible");
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
}

test("revision modal resizes on each axis, stays open, and preserves editing", async ({ page }) => {
    const q = new QuilliumPage(page);
    await q.setup();
    await q.goto();
    await q.createRevisionAndOpenModal("hello world");
    const frame = page.locator('[data-annotation-modal-frame="revision"]');
    const initial = await frame.boundingBox();
    if (!initial) throw new Error("Modal is not visible");

    await drag(
        page,
        frame.getByRole("button", { name: "Resize modal width", exact: true }),
        -70,
        0,
    );
    await expect(frame).toBeVisible();
    expect((await frame.boundingBox())!.width).toBeCloseTo(initial.width - 140, 0);
    expect((await frame.boundingBox())!.height).toBeCloseTo(initial.height, 0);

    await drag(
        page,
        frame.getByRole("button", { name: "Resize modal height", exact: true }),
        0,
        -40,
    );
    expect((await frame.boundingBox())!.height).toBeCloseTo(initial.height - 80, 0);
    await drag(page, frame.getByRole("button", { name: "Resize modal", exact: true }), 30, 20);
    expect((await frame.boundingBox())!.width).toBeCloseTo(initial.width - 80, 0);
    expect((await frame.boundingBox())!.height).toBeCloseTo(initial.height - 40, 0);

    await q.modalEditor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await q.expectModalText("hello world!");
    await q.escape();
    await expect(frame).not.toBeVisible();
    await q.expectInlineText("hello world!");
});

test("modal keyboard resizing, reset, and viewport caps", async ({ page }) => {
    const q = new QuilliumPage(page);
    await q.setup();
    await q.goto();
    await q.createRevisionAndOpenModal("hello world");
    const frame = page.locator('[data-annotation-modal-frame="revision"]');
    const initial = await frame.boundingBox();
    const corner = frame.getByRole("button", { name: "Resize modal", exact: true });
    await corner.focus();
    await page.keyboard.press("ArrowLeft");
    expect((await frame.boundingBox())!.width).toBeCloseTo(initial!.width - 20, 0);
    await page.keyboard.press("Home");
    expect((await frame.boundingBox())!.width).toBeCloseTo(initial!.width, 0);
    await drag(page, corner, 1000, 1000);
    const expanded = (await frame.boundingBox())!;
    expect(expanded.x).toBeGreaterThanOrEqual(15);
    expect(expanded.y).toBeGreaterThanOrEqual(15);
    expect(expanded.width).toBeLessThanOrEqual(page.viewportSize()!.width - 32);
    expect(expanded.height).toBeLessThanOrEqual(page.viewportSize()!.height - 32);
    await page.setViewportSize({ width: 500, height: 450 });
    const narrowed = (await frame.boundingBox())!;
    expect(narrowed.width).toBeLessThanOrEqual(468);
    expect(narrowed.height).toBeLessThanOrEqual(418);
    await corner.dblclick();
    expect((await frame.boundingBox())!.height).toBeLessThanOrEqual(418);
    await expect(frame).toBeVisible();
});

test("settings resize keeps its content scrollable and footer accessible", async ({ page }) => {
    const q = new QuilliumPage(page);
    await q.setup();
    await q.goto();
    const modal = await q.openSettings();
    const initial = (await modal.boundingBox())!;
    const originalPadding = await modal.evaluate((el) => getComputedStyle(el).paddingBottom);
    const corner = modal.getByRole("button", { name: "Resize modal", exact: true });
    const restore = modal.getByRole("button", { name: "Restore original size" });
    await expect(restore).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect
        .poll(() => corner.evaluate((el) => getComputedStyle(el, "::after").opacity))
        .toBe("0");
    await corner.hover();
    await expect
        .poll(() => corner.evaluate((el) => getComputedStyle(el, "::after").opacity))
        .toBe("0.4");
    await drag(page, corner, 100, -70);
    await page.mouse.move(0, 0);
    await expect
        .poll(() => corner.evaluate((el) => getComputedStyle(el, "::after").opacity))
        .toBe("0");
    await expect(restore).toBeVisible();
    await expect(restore.locator("svg")).toBeVisible();
    await expect(restore).toHaveText("");
    const restoreBox = (await restore.boundingBox())!;
    const closeBox = (await modal.getByRole("button", { name: "Close settings" }).boundingBox())!;
    expect(restoreBox.x + restoreBox.width).toBeLessThanOrEqual(closeBox.x);
    expect(Math.abs(restoreBox.y - closeBox.y)).toBeLessThan(10);
    await expect(modal).toHaveCSS("padding-bottom", originalPadding);
    await expect(modal).toBeVisible();
    const body = modal.locator(".settings-shake-wrapper > .overflow-y-auto");
    await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ path: "/tmp/quillium-settings-resized.png" });
    await expect(modal.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await restore.click();
    await expect(modal).toHaveCSS("width", `${initial.width}px`);
    expect((await modal.boundingBox())!.height).toBeCloseTo(initial.height, 0);
    await expect(restore).toHaveCount(0);
});

test("sidebar shares resize controls without changing its drag distance or outside dismissal", async ({
    page,
}) => {
    const q = new QuilliumPage(page);
    await q.init();
    await page
        .getByRole("button", { name: /^Document Context/ })
        .first()
        .click();
    const sidebar = page.locator("#ai-sidebar");
    const corner = sidebar.getByRole("button", { name: "Resize panel", exact: true });
    await expect(corner).toBeVisible();
    // Let the panel's opening transition finish before measuring its default dimensions.
    await expect.poll(async () => sidebar.evaluate((el) => el.getAnimations().length)).toBe(0);
    const initial = (await sidebar.boundingBox())!;
    await drag(page, corner, 30, 20);
    await expect(sidebar).toHaveCSS("width", `${initial.width + 30}px`);
    await expect(sidebar).toHaveCSS("height", `${initial.height + 20}px`);
    await corner.press("ArrowLeft");
    await expect(sidebar).toHaveCSS("width", `${initial.width + 10}px`);
    await sidebar.getByRole("button", { name: "Reset to default size" }).click();
    await expect(sidebar).toHaveCSS("width", `${initial.width}px`);
    await drag(page, corner, 10, 10);
    await page.mouse.click(page.viewportSize()!.width - 5, page.viewportSize()!.height / 2);
    await expect(corner).toBeHidden();
});

test("export and name-version dialogs resize without triggering their actions", async ({
    page,
}) => {
    const q = new QuilliumPage(page);
    await q.init();
    await page.getByRole("button", { name: "Export document", exact: true }).click();
    const exportDialog = page.getByRole("dialog", { name: "Export document" });
    const surface = exportDialog.locator('[role="document"]');
    const before = (await surface.boundingBox())!;
    await drag(
        page,
        exportDialog.getByRole("button", { name: "Resize modal", exact: true }),
        40,
        -30,
    );
    expect((await surface.boundingBox())!.width).toBeCloseTo(before.width + 80, 0);
    await expect(exportDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Name this version", exact: true }).click();
    const prompt = page.getByRole("dialog", { name: "Name this version" });
    const initial = (await prompt.boundingBox())!;
    await prompt.getByRole("textbox").fill("Checkpoint name survives resizing");
    await drag(page, prompt.getByRole("button", { name: "Resize modal", exact: true }), 30, 20);
    expect((await prompt.boundingBox())!.width).toBeCloseTo(initial.width + 60, 0);
    await expect(prompt.getByRole("textbox")).toHaveValue("Checkpoint name survives resizing");
    await prompt.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(prompt).toBeHidden();
});

test("tutorial chooser and beta notice keep their glass surface inside the resized shell", async ({
    page,
}) => {
    const q = new QuilliumPage(page, { skipTutorial: false });
    await q.setup();
    await q.goto();
    const chooser = page.getByRole("dialog").filter({ hasText: "Choose Tutorial Sections" });
    const shell = chooser.locator('[role="document"]');
    await expect(shell).toBeVisible();
    await drag(page, chooser.getByRole("button", { name: "Resize modal", exact: true }), 50, -40);
    expect(
        await shell.evaluate((el) => el.firstElementChild!.getBoundingClientRect().height),
    ).toBeCloseTo((await shell.boundingBox())!.height, 0);
    await chooser.getByRole("button", { name: "Skip tour", exact: true }).click();
    const beta = page.getByRole("dialog", { name: "Beta disclaimer" });
    await expect(beta).toBeVisible();
    const initial = (await beta.locator('[role="document"]').boundingBox())!;
    await drag(page, beta.getByRole("button", { name: "Resize modal", exact: true }), 40, 40);
    expect((await beta.locator('[role="document"]').boundingBox())!.width).toBeCloseTo(
        initial.width + 80,
        0,
    );
    await expect(beta.getByRole("button", { name: "I understand" })).toBeVisible();
});

test("duplicate confirmation and debug dialogs resize and still dismiss normally", async ({
    page,
}) => {
    const q = new QuilliumPage(page);
    await q.init();
    await q.createRevisionAndOpenModal("hello world");
    await page.getByRole("button", { name: /^New version/ }).click();
    await q.modalEditor.click();
    await page.keyboard.type("hello world");
    await q.expectModalText("hello world");
    await page.getByRole("button", { name: /^New version/ }).click();
    const warning = page.locator("dialog.duplicate-draft-warning[open]");
    await expect(warning).toBeVisible();
    const initial = (await warning.boundingBox())!;
    await drag(page, warning.getByRole("button", { name: "Resize modal", exact: true }), 40, 20);
    expect((await warning.boundingBox())!.width).toBeCloseTo(initial.width + 80, 0);
    await warning.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(warning).toBeHidden();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open debug panel" }).click();
    const debug = page.getByRole("dialog", { name: "Debug panel" });
    const original = (await debug.boundingBox())!;
    await drag(page, debug.getByRole("button", { name: "Resize modal", exact: true }), -30, -30);
    expect((await debug.boundingBox())!.width).toBeCloseTo(original.width - 60, 0);
    await debug.getByRole("button", { name: "Close debug panel" }).click();
    await expect(debug).toBeHidden();
});
