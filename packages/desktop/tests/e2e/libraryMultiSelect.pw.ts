import { type Page, expect, test } from "@playwright/test";

type MockDoc = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    wordCount: number;
    previewText: string;
    tags: string;
};

/**
 * Install a Tauri mock tailored for library page tests.
 * Supports multiple documents, trash operations, and tab switching.
 */
async function installLibraryMock(
    page: Page,
    options: { documents?: MockDoc[]; trashedDocuments?: MockDoc[] } = {},
) {
    const documents = options.documents ?? [
        {
            id: "doc-1",
            title: "Alpha",
            createdAt: 1000,
            updatedAt: 5000,
            wordCount: 100,
            previewText: "First document",
            tags: "[]",
        },
        {
            id: "doc-2",
            title: "Beta",
            createdAt: 2000,
            updatedAt: 4000,
            wordCount: 200,
            previewText: "Second document",
            tags: "[]",
        },
        {
            id: "doc-3",
            title: "Gamma",
            createdAt: 3000,
            updatedAt: 3000,
            wordCount: 300,
            previewText: "Third document",
            tags: "[]",
        },
    ];
    const trashedDocuments = options.trashedDocuments ?? [
        {
            id: "doc-trash-1",
            title: "Deleted One",
            createdAt: 500,
            updatedAt: 500,
            wordCount: 50,
            previewText: "Trashed document",
            tags: "[]",
        },
        {
            id: "doc-trash-2",
            title: "Deleted Two",
            createdAt: 600,
            updatedAt: 600,
            wordCount: 60,
            previewText: "Another trashed doc",
            tags: "[]",
        },
    ];

    await page.addInitScript(
        (payload: { documents: MockDoc[]; trashedDocuments: MockDoc[] }) => {
            localStorage.setItem("quillium_tutorial_seen", "1");

            // Mutable state the mock tracks
            const docs = [...payload.documents];
            const trashed = [...payload.trashedDocuments];

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

                    if (cmd === "cmd_list_documents") return [...docs];
                    if (cmd === "cmd_list_trashed_documents") return [...trashed];
                    if (cmd === "cmd_create_document") {
                        const id = `doc-new-${Date.now()}`;
                        docs.push({
                            id,
                            title: "Untitled",
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                            wordCount: 0,
                            previewText: "",
                            tags: "[]",
                        });
                        return id;
                    }
                    if (cmd === "cmd_trash_document") {
                        const a = args as { id: string };
                        const idx = docs.findIndex((d) => d.id === a.id);
                        if (idx !== -1) {
                            const [doc] = docs.splice(idx, 1);
                            trashed.push(doc);
                        }
                        return null;
                    }
                    if (cmd === "cmd_restore_document") {
                        const a = args as { id: string };
                        const idx = trashed.findIndex((d) => d.id === a.id);
                        if (idx !== -1) {
                            const [doc] = trashed.splice(idx, 1);
                            docs.push(doc);
                        }
                        return null;
                    }
                    if (cmd === "cmd_delete_document") {
                        const a = args as { id: string };
                        const idx = trashed.findIndex((d) => d.id === a.id);
                        if (idx !== -1) trashed.splice(idx, 1);
                        return null;
                    }
                    if (cmd === "cmd_get_document") {
                        const a = args as { id: string };
                        return docs.find((d) => d.id === a.id) ?? null;
                    }
                    if (cmd === "cmd_update_document_meta") return null;
                    if (cmd === "cmd_get_trash_retention") return null;
                    if (cmd === "cmd_set_trash_retention") return null;

                    // Editor stubs (for navigation back)
                    if (cmd === "cmd_create_draft") return "draft-test-1";
                    if (cmd === "cmd_list_drafts")
                        return [
                            {
                                id: "draft-test-1",
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
                    if (cmd === "get_api_key") return null;

                    // Tauri event plumbing
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
        },
        { documents, trashedDocuments },
    );
}

/** Get all document card elements on the library page. */
function documentCards(page: Page) {
    return page.locator("[role='button']").filter({ has: page.locator(".truncate") });
}

/** Get selected (blue-highlighted) document cards. */
function selectedCards(page: Page) {
    return page.locator("[role='button'].bg-blue-50");
}

test.describe("library multi-select", () => {
    test("Cmd/Ctrl+click toggles individual selection", async ({ page }) => {
        await installLibraryMock(page);
        await page.goto("/library");
        await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

        const cards = documentCards(page);
        await expect(cards).toHaveCount(3);

        // First card should be auto-selected
        await expect(selectedCards(page)).toHaveCount(1);

        // Cmd+click second card → both selected
        await cards.nth(1).click({ modifiers: ["ControlOrMeta"] });
        await expect(selectedCards(page)).toHaveCount(2);

        // Cmd+click third card → three selected
        await cards.nth(2).click({ modifiers: ["ControlOrMeta"] });
        await expect(selectedCards(page)).toHaveCount(3);

        // Cmd+click first card again → deselects it
        await cards.nth(0).click({ modifiers: ["ControlOrMeta"] });
        await expect(selectedCards(page)).toHaveCount(2);
    });

    test("Shift+click selects a range", async ({ page }) => {
        await installLibraryMock(page);
        await page.goto("/library");
        await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

        const cards = documentCards(page);

        // Click first card (plain click)
        await cards.nth(0).click();
        await expect(selectedCards(page)).toHaveCount(1);

        // Shift+click third card → selects cards 0, 1, 2
        await cards.nth(2).click({ modifiers: ["Shift"] });
        await expect(selectedCards(page)).toHaveCount(3);
    });

    test("Cmd/Ctrl+A selects all documents", async ({ page }) => {
        await installLibraryMock(page);
        await page.goto("/library");
        await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

        await page.keyboard.press("ControlOrMeta+a");
        await expect(selectedCards(page)).toHaveCount(3);

        // Header should show selected count
        await expect(page.getByText("3 selected")).toBeVisible();
    });

    test("Escape clears multi-selection to single", async ({ page }) => {
        await installLibraryMock(page);
        await page.goto("/library");
        await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

        // Select all
        await page.keyboard.press("ControlOrMeta+a");
        await expect(selectedCards(page)).toHaveCount(3);

        // Escape collapses to single (last-clicked)
        await page.keyboard.press("Escape");
        await expect(selectedCards(page)).toHaveCount(1);
    });

    test("plain click replaces multi-selection with single", async ({ page }) => {
        await installLibraryMock(page);
        await page.goto("/library");
        await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

        const cards = documentCards(page);

        // Multi-select
        await page.keyboard.press("ControlOrMeta+a");
        await expect(selectedCards(page)).toHaveCount(3);

        // Plain click on one card → single selection
        await cards.nth(1).click();
        await expect(selectedCards(page)).toHaveCount(1);
    });
});

test.describe("library keyboard shortcuts", () => {
    test("arrow keys navigate document selection", async ({ page }) => {
        await installLibraryMock(page);
        await page.goto("/library");
        await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

        // First card auto-selected — preview heading shows "Alpha"
        await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();

        // ArrowDown moves to next document
        await page.keyboard.press("ArrowDown");
        await expect(selectedCards(page)).toHaveCount(1);
        // Preview heading should now show "Beta"
        await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
    });

    test("Z restores selected document from trash", async ({ page }) => {
        await installLibraryMock(page);
        await page.goto("/library");
        await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

        // Switch to trash tab using the exact tab button text
        await page
            .locator("button")
            .filter({ hasText: /^.*Trash$/ })
            .first()
            .click();
        await expect(page.getByRole("heading", { name: "Deleted One" })).toBeVisible({
            timeout: 5_000,
        });

        const cards = documentCards(page);
        // Click first trashed document
        await cards.first().click();

        // Press Z to restore
        await page.keyboard.press("z");

        // Document should be removed from trash view — heading disappears
        await expect(page.getByRole("heading", { name: "Deleted One" })).not.toBeVisible({
            timeout: 5_000,
        });
    });

    test("view mode toggles with G and L keys", async ({ page }) => {
        await installLibraryMock(page);
        await page.goto("/library");
        await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

        // Default is grid view — press L for list view
        await page.keyboard.press("l");
        // List view button should now be active (has bg-blue-500)
        await expect(page.getByRole("button", { name: "List view (L)" })).toBeVisible();
        // Documents should still be visible
        await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();

        // Press G to go back to grid
        await page.keyboard.press("g");
        await expect(page.getByRole("button", { name: "Grid view (G)" })).toBeVisible();
    });
});
