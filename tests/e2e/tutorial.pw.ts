/**
 * E2E tests for the tutorial's interactive revision detection steps.
 *
 * These tests verify that the tutorial correctly detects when the user
 * creates revisions, opens modals, and creates nested revisions during
 * the guided tour's interactive steps.
 */

import { expect, test, type Page } from "@playwright/test";

/**
 * Install the Tauri mock WITHOUT setting quillium_tutorial_seen,
 * so the tutorial overlay appears on load.
 */
async function installTauriMockWithTutorial(page: Page) {
    await page.addInitScript(() => {
        // Do NOT set quillium_tutorial_seen — we want the tutorial to appear.

        let nextCallbackId = 1;
        const callbacks = new Map<number, (...args: unknown[]) => unknown>();
        const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

        (window as unknown as Record<string, unknown>).__TAURI_MOCK__ = { invokeCalls };

        (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
            metadata: {
                currentWindow: { label: "main" },
                currentWebview: { label: "main", windowLabel: "main" },
            },
            invoke: async (cmd: string, args: unknown) => {
                invokeCalls.push({ cmd, args });
                if (cmd === "cmd_list_documents")
                    return [
                        {
                            id: "doc-1",
                            title: "Untitled",
                            createdAt: 0,
                            updatedAt: 0,
                            wordCount: 0,
                            previewText: "",
                            tags: "[]",
                        },
                    ];
                if (cmd === "cmd_create_document") return "doc-1";
                if (cmd === "cmd_create_draft") return "draft-1";
                if (cmd === "cmd_list_drafts")
                    return [
                        {
                            id: "draft-1",
                            documentId: "doc-1",
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
                if (cmd === "plugin:event|listen") return 1;
                if (cmd === "plugin:event|unlisten") return null;
                return null;
            },
            transformCallback: (callback: (...args: unknown[]) => unknown) => {
                const id = nextCallbackId++;
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
    });
}

/** Click the "Start tour" button from the section picker. */
async function startTour(page: Page) {
    const startBtn = page.getByRole("button", { name: /start tour/i });
    await expect(startBtn).toBeVisible({ timeout: 10_000 });
    await startBtn.click();
}

/** Click the "Next" button in the tutorial tooltip. */
async function clickNext(page: Page) {
    const nextBtn = page.getByRole("button", { name: /next|continue|done/i });
    await expect(nextBtn).toBeVisible({ timeout: 5_000 });
    await expect(nextBtn).toBeEnabled({ timeout: 5_000 });
    await nextBtn.click();
}

test.describe("tutorial interactive revision detection", () => {
    test.beforeEach(async ({ page }) => {
        await installTauriMockWithTutorial(page);
        await page.addInitScript(() => {
            localStorage.setItem(
                "quillium-app-settings",
                JSON.stringify({ showNestedEditor: true, atomicRevisions: true, aiEnabled: true }),
            );
        });
        await page.goto("/");
        await expect(page.locator("#editor-document .cm-content")).toBeVisible({
            timeout: 10_000,
        });
    });

    test("tutorial detects top-level revision creation", async ({ page }) => {
        await startTour(page);

        // Navigate through non-interactive steps to reach "createRevision"
        // Steps: welcome → writing-space → nested-create-revision
        for (let i = 0; i < 2; i++) {
            await clickNext(page);
        }

        // Should be on the "Create Nested Revisions" step
        await expect(page.getByText("Create Nested Revisions")).toBeVisible({ timeout: 3_000 });
        await expect(page.getByText("Action required: create a revision")).toBeVisible({
            timeout: 3_000,
        });

        // Type text and create a revision
        const editor = page.locator("#editor-document .cm-content");
        await editor.click({ force: true });
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.type("hello world");
        await page.keyboard.press("End");
        for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
        await page.keyboard.press("ControlOrMeta+Alt+k");

        // The tutorial should detect the revision and show success
        const successBadge = page.getByText("Action complete. Continue when ready.");
        await expect(successBadge).toBeVisible({ timeout: 5_000 });

        // Next button should now be enabled
        const nextBtn = page.getByRole("button", { name: /next|continue/i });
        await expect(nextBtn).toBeEnabled({ timeout: 3_000 });
    });
});
