import { expect, test, type Page } from "@playwright/test";

type TauriMockOptions = {
    apiKey: string | null;
};

async function installTauriMock(page: Page, options: Partial<TauriMockOptions> = {}) {
    const apiKey = options.apiKey ?? null;

    await page.addInitScript(
        (payload: { apiKey: string | null }) => {
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

                    // Migration: no legacy state.json — return not-migrated
                    if (cmd === "cmd_migrate_from_state_json")
                        return { migrated: false, documentId: null };

                    // One document exists so the editor loads with a draft ID
                    if (cmd === "cmd_list_documents")
                        return [
                            {
                                id: "doc-test-1",
                                title: "Untitled",
                                createdAt: 0,
                                updatedAt: 0,
                                wordCount: 0,
                                previewText: "",
                                tags: "[]",
                            },
                        ];

                    // Document / draft creation
                    if (cmd === "cmd_create_document") return "doc-test-1";
                    if (cmd === "cmd_create_draft") return "draft-test-1";
                    if (cmd === "cmd_list_drafts")
                        return [
                            {
                                id: "draft-test-1",
                                documentId: "doc-test-1",
                                label: "Draft",
                                createdAt: 0,
                                isActive: true,
                            },
                        ];

                    // Load returns empty (blank editor)
                    if (cmd === "cmd_load_document_state")
                        return { snapshotStateJson: null, snapshotEventSeq: -1, eventsSince: [] };

                    // Append event — acknowledge with no snapshot needed
                    if (cmd === "cmd_append_event") return { eventSeq: 0, needsSnapshot: false };

                    // Snapshot / meta
                    if (cmd === "cmd_create_snapshot") return null;
                    if (cmd === "cmd_update_document_meta") return null;

                    // Keychain
                    if (cmd === "get_api_key") return payload.apiKey;

                    // Tauri event plumbing
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
        },
        { apiKey },
    );
}

test("renders a blank editor when no documents exist", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await expect(page.locator("#editor-document .cm-content")).toBeVisible();

    const commands = await page.evaluate(() =>
        (
            window as unknown as { __TAURI_MOCK__: { invokeCalls: Array<{ cmd: string }> } }
        ).__TAURI_MOCK__.invokeCalls.map((x) => x.cmd),
    );
    expect(commands).toContain("cmd_migrate_from_state_json");
    expect(commands).toContain("cmd_list_documents");
});

test("calls migration and list exactly once during startup", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await expect(page.locator("#editor-document .cm-content")).toBeVisible();

    const migrateCalls = await page.evaluate(
        () =>
            (
                window as unknown as { __TAURI_MOCK__: { invokeCalls: Array<{ cmd: string }> } }
            ).__TAURI_MOCK__.invokeCalls.filter((x) => x.cmd === "cmd_migrate_from_state_json")
                .length,
    );
    expect(migrateCalls).toBe(1);
});

test("typing updates stats and triggers cmd_append_event", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const editor = page.locator("#editor-document .cm-content");
    const status = page.locator("#status-bar");

    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("One two three four");

    await expect(status).toContainText("Words: 4");
    await expect(status).toContainText("Characters: 18");

    await expect
        .poll(async () => {
            return page.evaluate(
                () =>
                    (
                        window as unknown as {
                            __TAURI_MOCK__: { invokeCalls: Array<{ cmd: string }> };
                        }
                    ).__TAURI_MOCK__.invokeCalls.filter((x) => x.cmd === "cmd_append_event").length,
            );
        })
        .toBeGreaterThan(0);
});

test("selection updates status bar to show selected counts", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    const editor = page.locator("#editor-document .cm-content");
    const status = page.locator("#status-bar");

    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type("Hello World");
    await page.keyboard.press("ControlOrMeta+a");

    await expect(status).toContainText("Words: 2");
    await expect(status).toContainText("2 total");
    await expect(status).toContainText("Characters: 11");
    await expect(status).toContainText("11 total");
});

test("tutorial opens from status bar", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Take tour" }).click();
    await expect(page.getByText("Choose Tutorial Sections")).toBeVisible();
});

test("AI sidebar can open chat and feedback panels", async ({ page }) => {
    await installTauriMock(page, { apiKey: "test-api-key" });
    await page.goto("/");

    await page.locator("#ai-tab-chat").click({ force: true });
    await expect(page.locator("#ai-sidebar")).toContainText("Chat with AI");

    await page
        .locator("#ai-sidebar .overflow-x-auto button[aria-label='Feedback']")
        .click({ force: true });

    await expect(page.locator("#ai-sidebar")).toContainText("Get Feedback");
});

test("settings modal opens from status bar", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await expect(page.locator("#status-bar")).toBeVisible();
    await page.locator("#status-bar button[aria-label='Open settings']").click();
    const modal = page.locator(".settings-modal-inner");
    await expect(modal.getByText("Settings")).toBeVisible();
    await expect(modal.getByText("Document", { exact: true })).toBeVisible();
    await expect(modal.getByText("Interface", { exact: true })).toBeVisible();
});
