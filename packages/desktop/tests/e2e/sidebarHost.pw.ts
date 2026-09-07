import { expect, test } from "@playwright/test";
import { QuilliumPage } from "./QuilliumPage";

function expandedPanelButton(q: QuilliumPage, label: string) {
    return q.page.locator(`#ai-sidebar .overflow-x-auto button[aria-label^="${label}"]:visible`);
}

async function invokeCommands(q: QuilliumPage): Promise<string[]> {
    return q.page.evaluate(() => {
        const mock = (
            window as unknown as {
                __TAURI_MOCK__?: { invokeCalls?: Array<{ cmd: string }> };
            }
        ).__TAURI_MOCK__;
        return mock?.invokeCalls?.map(({ cmd }) => cmd) ?? [];
    });
}

test.describe("sidebar host local panels", () => {
    test("opens and edits local panels without credentials or provider traffic", async ({
        page,
    }) => {
        const providerRequests: string[] = [];
        page.on("request", (request) => {
            if (
                /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.deepseek\.com/i.test(
                    request.url(),
                )
            ) {
                providerRequests.push(request.url());
            }
        });

        const q = new QuilliumPage(page, {
            apiKey: null,
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
        });
        await q.init();

        await expect(page.locator("#ai-sidebar #ai-tab-chat")).toHaveCount(1);
        expect((await invokeCommands(q)).filter((cmd) => cmd === "get_api_key")).toHaveLength(0);

        await page.locator("#ai-sidebar #ai-tab-context").click();
        const context = page.locator('#ai-sidebar [data-panel-id="context"]');
        await expect(context).toBeVisible();

        const brief = context.getByPlaceholder(/Describe whatever context is relevant/);
        await brief.fill("A concise field guide for first time hikers.");
        await brief.blur();
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem("mock-writer-brief:doc-test-1")))
            .toBe("A concise field guide for first time hikers.");

        const decision = context.getByLabel("New editorial decision");
        await decision.fill("Keep the ending practical.");
        await decision.press("Enter");
        await expect(context.getByText("Keep the ending practical.")).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(() => localStorage.getItem("mock-editorial-decisions:doc-test-1")),
            )
            .toBe('["Keep the ending practical."]');

        await expandedPanelButton(q, "Readers").click();
        const readers = page.locator('#ai-sidebar [data-panel-id="readers"]');
        await expect(readers).toBeVisible();
        await readers.getByRole("button", { name: /Create custom reader/ }).click();
        await readers.getByPlaceholder("Reader name").fill("Trail reader");
        await readers
            .getByPlaceholder(/What should this reader focus on/)
            .fill("Checks that the advice is practical.");
        await readers.getByRole("button", { name: "Save", exact: true }).click();
        await expect(readers.getByText("Trail reader", { exact: true })).toBeVisible();

        const beforeSettings = await invokeCommands(q);
        expect(beforeSettings.filter((cmd) => cmd === "get_api_key")).toHaveLength(0);

        await page.locator('#ai-sidebar button[aria-label="AI Settings"]:visible').last().click();
        await expect(page.locator('#ai-sidebar [data-panel-id="settings"]')).toBeVisible();
        await expect(q.aiSidebar).toContainText("AI Settings");
        await expandedPanelButton(q, "Chat").click();
        await expect(page.locator('#ai-sidebar [data-panel-id="settings"]')).toBeVisible();
        expect(providerRequests).toHaveLength(0);
        q.expectNoPageErrors();
    });

    test("hides all current panels and sidebar chrome when AI is disabled", async ({ page }) => {
        const q = new QuilliumPage(page, {
            apiKey: null,
            settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: false },
        });
        await q.init();

        await expect(page.locator("#ai-sidebar #ai-tab-chat")).toHaveCount(0);
        await expect(page.locator("#ai-sidebar #ai-tab-feedback")).toHaveCount(0);
        await expect(page.locator("#ai-sidebar #ai-tab-revise")).toHaveCount(0);
        await expect(page.locator("#ai-sidebar #ai-tab-context")).toHaveCount(0);
        await expect(page.locator("#ai-sidebar #ai-tab-readers")).toHaveCount(0);
        await expect(page.locator('#ai-sidebar button[aria-label="AI Settings"]')).toHaveCount(0);
        await expect(page.locator("#ai-sidebar #ai-tab-college")).toHaveCount(0);
        await expect(page.locator("#ai-sidebar")).toHaveCount(0);
        await page.keyboard.press("Control+Shift+4");
        await expect(page.locator("#ai-sidebar")).toHaveCount(0);
        await expect(page.locator('#ai-sidebar button[aria-label^="Chat"]')).toHaveCount(0);
        q.expectNoPageErrors();
    });
});

test("clamps the sidebar to a narrow viewport and restores shortcut focus on Escape", async ({
    page,
}) => {
    await page.setViewportSize({ width: 320, height: 600 });
    const q = new QuilliumPage(page, {
        apiKey: null,
        settings: { showNestedEditor: true, atomicRevisions: true, aiEnabled: true },
    });
    await q.init();

    const contextButton = page.locator("#ai-sidebar #ai-tab-context");
    await contextButton.focus();
    await page.keyboard.press("Control+Shift+4");

    const sidebar = q.aiSidebar;
    const contextRegion = page.locator('#ai-sidebar [data-panel-id="context"]');
    await expect(contextRegion).toBeFocused();
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBe(288);
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.y + box!.height).toBeLessThanOrEqual(600);

    await page.keyboard.press("Escape");
    await expect(contextButton).toBeFocused();
    q.expectNoPageErrors();
});
