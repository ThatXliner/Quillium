import { expect, test, type Page } from "@playwright/test";

/**
 * Install Tauri mock with updater plugin support.
 *
 * When `updateVersion` is provided, the updater check() will return an
 * available update with that version. Otherwise it returns null (no update).
 */
async function installTauriMock(page: Page, options: { updateVersion?: string } = {}) {
    const updateVersion = options.updateVersion ?? null;

    await page.addInitScript(
        (payload: { updateVersion: string | null }) => {
            localStorage.setItem("quillium_tutorial_seen", "1");

            let nextCallbackId = 1;
            const callbacks = new Map<number, (...args: unknown[]) => unknown>();

            (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
                invoke: async (cmd: string, _args: unknown) => {
                    // Document stubs so the editor loads
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
                    if (cmd === "cmd_load_document_state")
                        return { snapshotStateJson: null, snapshotEventId: -1, eventsSince: [] };
                    if (cmd === "cmd_append_event") return { eventId: 0, needsSnapshot: false };
                    if (cmd === "cmd_create_snapshot") return null;
                    if (cmd === "cmd_update_document_meta") return null;
                    if (cmd === "get_api_key") return null;

                    // Updater plugin
                    if (cmd === "plugin:updater|check") {
                        if (payload.updateVersion) {
                            return {
                                available: true,
                                version: payload.updateVersion,
                                date: new Date().toISOString(),
                                body: "Test release notes",
                            };
                        }
                        return null;
                    }
                    if (cmd === "plugin:updater|download_and_install") {
                        // Simulate a slow download so we can see the Installing state
                        await new Promise((r) => setTimeout(r, 60_000));
                        return null;
                    }

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
        { updateVersion },
    );
}

test("update banner appears when an update is available", async ({ page }) => {
    await installTauriMock(page, { updateVersion: "1.0.0" });
    await page.goto("/");

    const banner = page.locator("text=is available");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=1.0.0")).toBeVisible();
    await expect(page.getByRole("button", { name: "Update" })).toBeVisible();
});

test("update banner does not appear when no update is available", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    // Wait for the editor to load, then verify no banner
    await expect(page.locator("#editor-document .cm-content")).toBeVisible();
    await expect(page.locator("text=is available")).not.toBeVisible();
});

test("dismiss button hides the update banner", async ({ page }) => {
    await installTauriMock(page, { updateVersion: "1.0.0" });
    await page.goto("/");

    await expect(page.locator("text=is available")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.locator("text=is available")).not.toBeVisible();
});

test("clicking Update shows Installing state", async ({ page }) => {
    await installTauriMock(page, { updateVersion: "1.0.0" });
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Update" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Update" }).click();
    await expect(page.locator("text=Installing")).toBeVisible();
});

test.describe("screenshots", () => {
    test("update available state", async ({ page }) => {
        await installTauriMock(page, { updateVersion: "1.0.0" });
        await page.goto("/");

        await expect(page.locator("text=is available")).toBeVisible({ timeout: 10_000 });
        await page.screenshot({
            path: "tests/e2e/screenshots/update-banner-available.png",
            fullPage: true,
        });
    });

    test("installing state", async ({ page }) => {
        await installTauriMock(page, { updateVersion: "1.0.0" });
        await page.goto("/");

        await expect(page.getByRole("button", { name: "Update" })).toBeVisible({ timeout: 10_000 });
        await page.getByRole("button", { name: "Update" }).click();
        await expect(page.locator("text=Installing")).toBeVisible();
        await page.screenshot({
            path: "tests/e2e/screenshots/update-banner-installing.png",
            fullPage: true,
        });
    });
});
