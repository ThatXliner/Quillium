import { expect, test, type Page } from "@playwright/test";

type TauriMockOptions = {
    loadResponse: string | null;
};

async function installTauriMock(
    page: Page,
    options: Partial<TauriMockOptions> = {},
) {
    const loadResponse = options.loadResponse ?? null;

    await page.addInitScript((payload: { loadResponse: string | null }) => {
        localStorage.setItem("quillium_tutorial_seen", "1");

        let nextCallbackId = 1;
        const callbacks = new Map<number, (...args: unknown[]) => unknown>();
        const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

        (window as unknown as Record<string, unknown>).__TAURI_MOCK__ = {
            invokeCalls,
        };

        (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
            invoke: async (cmd: string, args: unknown) => {
                invokeCalls.push({ cmd, args });
                if (cmd === "load") return payload.loadResponse;
                if (cmd === "save") return true;
                if (cmd === "plugin:event|listen") return 1;
                if (cmd === "plugin:event|unlisten") return null;
                return null;
            },
            transformCallback: (callback: (...args: unknown[]) => unknown) => {
                const id = nextCallbackId;
                nextCallbackId += 1;
                callbacks.set(id, callback);
                return id;
            },
            unregisterCallback: (id: number) => {
                callbacks.delete(id);
            },
            convertFileSrc: (filePath: string) => filePath,
        };

        (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
            unregisterListener: () => {},
        };
    }, { loadResponse });
}

test("uses default document when mocked load returns null", async ({ page }) => {
    await installTauriMock(page, { loadResponse: null });
    await page.goto("/");

    await expect(page.locator("#editor-document .cm-content")).toContainText("Hello World");

    const commands = await page.evaluate(() => (
        (window as unknown as { __TAURI_MOCK__: { invokeCalls: Array<{ cmd: string }> } }).__TAURI_MOCK__.invokeCalls
            .map((x) => x.cmd)
    ));
    expect(commands).toContain("load");
});

test("calls mocked load exactly once during startup", async ({ page }) => {
    await installTauriMock(page, { loadResponse: null });
    await page.goto("/");

    await expect(page.locator("#editor-document .cm-content")).toBeVisible();
    const loadCalls = await page.evaluate(() => (
        (window as unknown as { __TAURI_MOCK__: { invokeCalls: Array<{ cmd: string }> } }).__TAURI_MOCK__.invokeCalls
            .filter((x) => x.cmd === "load").length
    ));
    expect(loadCalls).toBe(1);
});

test("typing updates stats and triggers mocked save", async ({ page }) => {
    await installTauriMock(page, { loadResponse: null });
    await page.goto("/");

    const editor = page.locator("#editor-document .cm-content");
    const status = page.locator("#status-bar");

    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("One two three four");

    await expect(status).toContainText("Words: 4");
    await expect(status).toContainText("Characters: 18");

    await expect.poll(async () => {
        return page.evaluate(() => (
            (window as unknown as { __TAURI_MOCK__: { invokeCalls: Array<{ cmd: string }> } }).__TAURI_MOCK__.invokeCalls
                .filter((x) => x.cmd === "save").length
        ));
    }).toBeGreaterThan(0);
});

test("selection updates status bar to show selected counts", async ({ page }) => {
    await installTauriMock(page, { loadResponse: null });
    await page.goto("/");

    const editor = page.locator("#editor-document .cm-content");
    const status = page.locator("#status-bar");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");

    await expect(status).toContainText("Words: 2");
    await expect(status).toContainText("2 total");
    await expect(status).toContainText("Characters: 11");
    await expect(status).toContainText("11 total");
});

test("tutorial opens from status bar", async ({ page }) => {
    await installTauriMock(page, { loadResponse: null });
    await page.goto("/");

    await page.getByRole("button", { name: "Take tour" }).click();
    await expect(page.getByText("Choose Tutorial Sections")).toBeVisible();
});

test("AI sidebar can open chat and feedback panels", async ({ page }) => {
    await installTauriMock(page, { loadResponse: null });
    await page.goto("/");

    await page.locator("#ai-tab-chat").click({ force: true });
    await expect(page.locator("#ai-sidebar")).toContainText("Chat with AI");

    await page
        .locator("#ai-sidebar .overflow-x-auto button[aria-label='Feedback']")
        .click({ force: true });

    await expect(page.locator("#ai-sidebar")).toContainText("Get Feedback");
});

test("settings modal opens from status bar", async ({ page }) => {
    await installTauriMock(page, { loadResponse: null });
    await page.goto("/");

    await page.getByRole("button", { name: "Open settings" }).click();
    const modal = page.locator(".settings-modal-inner");
    await expect(modal.getByText("Settings")).toBeVisible();
    await expect(modal.getByText("Document", { exact: true })).toBeVisible();
    await expect(modal.getByText("Interface", { exact: true })).toBeVisible();
});
