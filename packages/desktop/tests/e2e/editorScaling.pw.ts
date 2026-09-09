import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
/** editorScaling.pw.ts — Dense annotations stay cheap without losing editing or navigation. */
import { expect, test } from "@playwright/test";
import { addAnnotation, annotationField } from "@quillium/share/core/annotationField";
import { QuilliumPage } from "./QuilliumPage";

// CodeMirror's current findFromDOM implementation uses this linkage.
type EditorContent = HTMLElement & { cmTile: { root: { view: EditorView } } };
async function selectAt(q: QuilliumPage, anchor: number): Promise<void> {
    await q.editor.evaluate((element, position) => {
        (element as EditorContent).cmTile.root.view.dispatch({
            selection: { anchor: position },
            scrollIntoView: true,
        });
    }, anchor);
}

const length = 250_000;
const count = 1_000;
const startOf = (id: number, docLength = length, annotationCount = count) =>
    10 + Math.floor((id * (docLength - 30)) / annotationCount);
function fixture(docLength = length, annotationCount = count): string {
    const doc = "The writer revised a sentence beside the window.\n"
        .repeat(6_000)
        .slice(0, docLength);
    let state = EditorState.create({ doc, extensions: [annotationField] });
    state = state.update({
        effects: Array.from({ length: annotationCount }, (_, id) =>
            addAnnotation.of({
                id,
                _type: "comment",
                status: "active",
                selection: EditorSelection.single(
                    startOf(id, docLength, annotationCount),
                    startOf(id, docLength, annotationCount) + 10,
                ),
                thread: [{ message: `Comment ${id}`, author: "Writer", time: 1_720_000_000_000 }],
            }),
        ),
    }).state;
    return JSON.stringify(state.toJSON({ annotationField }));
}

test.use({ viewport: { width: 1440, height: 900 } });
test("windows dense cards and retains distant annotations through edit, undo, and redo", async ({
    page,
}) => {
    const q = new QuilliumPage(page, {
        initialStateJson: fixture(),
        settings: { aiEnabled: false },
    });
    await q.init();
    const fullCards = page.locator(".annotation-card [data-annotation-card-view]");
    await expect.poll(() => fullCards.count()).toBeGreaterThan(0);
    await expect.poll(() => fullCards.count()).toBeLessThan(100);

    // Real browser input, with the root editor's usual undo stack.
    await q.editor.focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.insertText("abcdefghijklmnopqrst");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(q.editor).not.toContainText("abcdefghijklmnopqrst");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(q.editor).toContainText("abcdefghijklmnopqrst");
    await expect(q.wordCountOverlay).toContainText("250020 chars");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(q.wordCountOverlay).toContainText("1 / 250020 chars");

    // Selecting an offscreen annotation must mount its card and reveal it.
    await selectAt(q, startOf(999) + 20);
    await expect(page.locator(".annotation-card.is-active")).toContainText("Comment 999");
    // Scrolling without changing selection must still reposition the card,
    // even though viewport-only updates no longer publish editor mirrors.
    await selectAt(q, startOf(500) + 20);
    await q.editor.evaluate((element) => {
        const view = (element as EditorContent).cmTile.root.view;
        const shell = element.closest(".editor-shell") as HTMLElement;
        shell.scrollTop += (view.coordsAtPos(view.state.selection.main.from)?.top ?? 500) - 500;
    });
    const activeCard = page.locator(".annotation-card.is-active");
    await expect.poll(async () => (await activeCard.boundingBox())?.y ?? 0).toBeGreaterThan(400);
    await page.waitForTimeout(350);
    const beforeScroll = (await activeCard.boundingBox())!.y;
    await page.locator(".editor-shell").evaluate((element) => {
        element.scrollTop += 150;
    });
    await expect
        .poll(async () => (await activeCard.boundingBox())!.y)
        .toBeLessThan(beforeScroll - 70);
    await expect.poll(() => fullCards.count()).toBeLessThan(100);
});

test("scrolls dense columns without losing an unfinished reply", async ({ page }) => {
    const q = new QuilliumPage(page, {
        initialStateJson: fixture(),
        settings: { aiEnabled: false },
    });
    await q.init();
    const firstCard = page.locator('.annotation-card[data-annotation-id="0"]');
    await firstCard.getByRole("button", { name: "Focus annotation", exact: true }).focus();
    await page.keyboard.press("Enter");
    const reply = firstCard.getByPlaceholder("Reply…");
    await reply.fill("Keep this unfinished reply");
    // Move the editor cursor out of the annotation, so the card is no longer active.
    await selectAt(q, 0);
    await q.editor.focus();
    const column = firstCard.locator(
        "xpath=ancestor::*[contains(@class,'annotation-scroll-container')]",
    );
    await column.evaluate((element) => {
        element.scrollTop = 12_000;
    });
    // Nearby placeholders become cards, and their height measurements must not
    // send the writer back to the top of the column.
    await expect
        .poll(() => column.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(10_000);
    await expect
        .poll(() => column.locator('[data-card-mounted="true"]').count())
        .toBeGreaterThan(2);
    await expect(firstCard).toHaveAttribute("data-card-mounted", "false");
    await page.waitForTimeout(500);
    expect(await column.evaluate((element) => element.scrollTop)).toBeGreaterThan(10_000);
    await column.evaluate((element) => {
        element.scrollTop = 0;
    });
    await firstCard.getByRole("button", { name: "Focus annotation", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(reply).toHaveValue("Keep this unfinished reply");
    await reply.press("ControlOrMeta+Enter");
    await expect(firstCard).toContainText("Keep this unfinished reply");
    await expect(reply).toHaveValue("");
    await selectAt(q, 0);
    await q.editor.focus();
    await column.evaluate((element) => {
        element.scrollTop = 12_000;
    });
    await expect(firstCard).toHaveAttribute("data-card-mounted", "false");
});

for (const action of ["Save", "Cancel"]) {
    test(`releases an offscreen card after message edit ${action}`, async ({ page }) => {
        const q = new QuilliumPage(page, {
            initialStateJson: fixture(),
            settings: { aiEnabled: false },
        });
        await q.init();
        const card = page.locator('.annotation-card[data-annotation-id="0"]');
        await card.getByRole("button", { name: "Focus annotation", exact: true }).focus();
        await page.keyboard.press("Enter");
        await card.getByRole("button", { name: "Edit", exact: true }).click();
        await card.locator("textarea").first().fill("Unfinished message edit");
        await selectAt(q, 0);
        await q.editor.focus();
        const column = card.locator(
            "xpath=ancestor::*[contains(@class,'annotation-scroll-container')]",
        );
        await column.evaluate((element) => {
            element.scrollTop = 12_000;
        });
        await expect
            .poll(() => column.evaluate((element) => element.scrollTop))
            .toBeGreaterThan(10_000);
        await page.waitForTimeout(500);
        await expect(card).toHaveAttribute("data-card-mounted", "true");
        await expect(card.locator("textarea").first()).toHaveValue("Unfinished message edit");
        await column.evaluate((element) => {
            element.scrollTop = 0;
        });
        await card.getByRole("button", { name: action, exact: true }).click();
        await card.getByRole("button", { name: "Focus annotation", exact: true }).focus();
        await column.evaluate((element) => {
            element.scrollTop = 12_000;
        });
        await page.waitForTimeout(500);
        await expect(card).toHaveAttribute("data-card-mounted", "true");
        await q.editor.focus();
        await column.evaluate((element) => {
            element.scrollTop = 12_000;
        });
        await expect(card).toHaveAttribute("data-card-mounted", "false");
    });
}

// Wall-clock budgets are opt-in; ordinary CI checks the structural and editing
// regressions above without depending on shared-runner timing.
for (const docLength of [25_000, 250_000]) {
    for (const annotationCount of [0, 100, 1_000]) {
        test(`scaling measurements: ${docLength} characters, ${annotationCount} comments`, async ({
            page,
        }, testInfo) => {
            test.skip(
                !process.env.QUILLIUM_PERF,
                "Run against a production preview with QUILLIUM_PERF=1",
            );
            const q = new QuilliumPage(page, {
                initialStateJson: fixture(docLength, annotationCount),
                settings: { aiEnabled: false },
            });
            const start = performance.now();
            await q.init();
            const loadMs = performance.now() - start;
            await q.editor.focus();
            const inputMs: number[] = [];
            for (let sample = 0; sample < 7; sample++) {
                const before = performance.now();
                await page.keyboard.insertText("abcdefghijklmnopqrst");
                inputMs.push(performance.now() - before);
                await page.evaluate(
                    () =>
                        new Promise<void>((resolve) =>
                            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                        ),
                );
            }
            const fullCards = await page
                .locator(".annotation-card [data-annotation-card-view]")
                .count();
            const medianInputMs = [...inputMs].sort((a, b) => a - b)[3];
            const measurements = {
                docLength,
                annotationCount,
                loadMs,
                fullCards,
                inputMs,
                medianInputMs,
            };
            console.log(JSON.stringify(measurements));
            await testInfo.attach("scaling.json", {
                body: JSON.stringify(measurements, null, 2),
                contentType: "application/json",
            });
            expect(medianInputMs).toBeLessThan(50);
            expect(fullCards).toBeLessThan(1_000);
        });
    }
}
