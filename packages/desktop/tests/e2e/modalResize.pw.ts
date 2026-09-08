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
    await drag(page, modal.getByRole("button", { name: "Resize modal", exact: true }), 100, -70);
    await expect(modal).toBeVisible();
    const body = modal.locator(".settings-shake-wrapper > .overflow-y-auto");
    await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ path: "/tmp/quillium-settings-resized.png" });
    await expect(modal.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});
