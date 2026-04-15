import { expect, test, type Page } from "@playwright/test";

/**
 * Repro for: "When I create a document, write some text, delete it (trash),
 * and make a new document, the contents of the old one is still being
 * previewed in the library + showing in the title of this new document".
 *
 * Mock tracks per-doc preview_text / title so we can assert that
 * document B's row never contains document A's content.
 */

type MockDoc = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    wordCount: number;
    previewText: string;
    tags: string;
    deletedAt?: number | null;
};

async function installMock(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem("quillium_tutorial_seen", "1");
        localStorage.setItem("quillium_beta_accepted", "1");
        localStorage.setItem("quillium_changelog_seen", "99.99");

        const docs: MockDoc[] = [];
        const drafts: Array<{
            id: string;
            documentId: string;
            label: string;
            createdAt: number;
            isActive: boolean;
        }> = [];
        const snapshots: Array<{ draftId: string; stateJson: string; upToEventId: number }> = [];
        const events: Array<{
            id: number;
            draftId: string;
            payload: string;
            eventType: string;
            createdAt: number;
        }> = [];
        let nextEventId = 1;

        let nextCallbackId = 1;
        const callbacks = new Map<number, (...args: unknown[]) => unknown>();
        const invokeCalls: Array<{ cmd: string; args: unknown }> = [];
        const metaUpdates: Array<{ id: string; title: string; previewText: string }> = [];

        (window as unknown as Record<string, unknown>).__TAURI_MOCK__ = {
            invokeCalls,
            metaUpdates,
            docs,
        };

        (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
            metadata: {
                currentWindow: { label: "main" },
                currentWebview: { label: "main", windowLabel: "main" },
            },
            // biome-ignore lint/suspicious/noExplicitAny: mock
            invoke: async (cmd: string, args: any) => {
                invokeCalls.push({ cmd, args });

                if (cmd === "cmd_list_documents") {
                    return docs.filter((d) => !d.deletedAt);
                }
                if (cmd === "cmd_list_trashed_documents") {
                    return docs.filter((d) => !!d.deletedAt);
                }
                if (cmd === "cmd_create_document") {
                    const id = `doc-${Math.random().toString(36).slice(2, 10)}`;
                    docs.push({
                        id,
                        title: args?.title ?? "Untitled",
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        wordCount: 0,
                        previewText: "",
                        tags: "[]",
                        deletedAt: null,
                    });
                    return id;
                }
                if (cmd === "cmd_update_document_meta") {
                    const doc = docs.find((d) => d.id === args.id);
                    if (doc) {
                        doc.title = args.title;
                        doc.wordCount = args.wordCount;
                        doc.previewText = args.previewText;
                        doc.tags = args.tags;
                        doc.updatedAt = Date.now();
                    }
                    metaUpdates.push({
                        id: args.id,
                        title: args.title,
                        previewText: args.previewText,
                    });
                    return null;
                }
                if (cmd === "cmd_get_document") {
                    return docs.find((d) => d.id === args.id) ?? null;
                }
                if (cmd === "cmd_trash_document") {
                    const doc = docs.find((d) => d.id === args.id);
                    if (doc) doc.deletedAt = Date.now();
                    return null;
                }
                if (cmd === "cmd_delete_document") {
                    const idx = docs.findIndex((d) => d.id === args.id);
                    if (idx !== -1) docs.splice(idx, 1);
                    return null;
                }
                if (cmd === "cmd_restore_document") {
                    const doc = docs.find((d) => d.id === args.id);
                    if (doc) doc.deletedAt = null;
                    return null;
                }
                if (cmd === "cmd_create_draft") {
                    const id = `draft-${Math.random().toString(36).slice(2, 10)}`;
                    drafts.push({
                        id,
                        documentId: args.docId,
                        label: args.label ?? "Draft",
                        createdAt: Date.now(),
                        isActive: true,
                    });
                    return id;
                }
                if (cmd === "cmd_list_drafts") {
                    return drafts.filter((d) => d.documentId === args.docId);
                }
                if (cmd === "cmd_load_document_state") {
                    const draftId = args.draftId;
                    const snap = snapshots.filter((s) => s.draftId === draftId).pop();
                    const eventsSince = events
                        .filter((e) => e.draftId === draftId && (!snap || e.id > snap.upToEventId))
                        .map((e) => ({
                            id: e.id,
                            eventType: e.eventType,
                            payload: e.payload,
                            createdAt: e.createdAt,
                        }));
                    return {
                        snapshotStateJson: snap?.stateJson ?? null,
                        snapshotEventId: snap?.upToEventId ?? -1,
                        eventsSince,
                    };
                }
                if (cmd === "cmd_append_event") {
                    const id = nextEventId++;
                    events.push({
                        id,
                        draftId: args.draftId,
                        payload: args.payloadJson,
                        eventType: "doc_change",
                        createdAt: Date.now(),
                    });
                    return { eventId: id, needsSnapshot: false };
                }
                if (cmd === "cmd_create_snapshot") {
                    snapshots.push({
                        draftId: args.draftId,
                        stateJson: args.stateJson,
                        upToEventId: args.upToEventId,
                    });
                    return null;
                }
                if (cmd === "cmd_create_named_snapshot") {
                    snapshots.push({
                        draftId: args.draftId,
                        stateJson: args.stateJson,
                        upToEventId: args.upToEventId,
                    });
                    return null;
                }
                if (cmd === "cmd_get_trash_retention") return null;
                if (cmd === "cmd_set_trash_retention") return null;
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

test("delete text content then create new doc - should not leak preview", async ({ page }) => {
    await installMock(page);

    await page.goto("/library");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /new/i }).first().click();
    await page.waitForURL("**/", { timeout: 10_000 });

    const editor = page.locator(".cm-content").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.click();
    await page.keyboard.type("Hello World this is a test document");
    await page.waitForTimeout(900);

    // Delete the text content (Cmd+A, then backspace)
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(100);

    // Go to library and click New
    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /new/i }).first().click();
    await page.waitForURL("**/", { timeout: 10_000 });
    await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(1500);

    const finalDocs = await page.evaluate(
        () => (window as unknown as { __TAURI_MOCK__: { docs: MockDoc[] } }).__TAURI_MOCK__.docs,
    );
    const metaUpdates = await page.evaluate(
        () =>
            (
                window as unknown as {
                    __TAURI_MOCK__: {
                        metaUpdates: Array<{ id: string; title: string; previewText: string }>;
                    };
                }
            ).__TAURI_MOCK__.metaUpdates,
    );

    console.log("DEL-TEXT FINAL DOCS:", JSON.stringify(finalDocs, null, 2));
    console.log("DEL-TEXT META UPDATES:", JSON.stringify(metaUpdates, null, 2));

    // Find B (the newer one — the one created second)
    const newDoc = finalDocs[finalDocs.length - 1];
    expect(newDoc).toBeDefined();
    expect(newDoc.previewText).not.toContain("Hello World");
    expect(newDoc.title).not.toContain("Hello World");
});

test("new B: preserves title/preview when A still has pending debounce (race)", async ({
    page,
}) => {
    await installMock(page);

    await page.goto("/library");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /new/i }).first().click();
    await page.waitForURL("**/", { timeout: 10_000 });

    const editor = page.locator(".cm-content").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.click();
    // Type enough to trigger auto-derived title AND have preview text
    await page.keyboard.type("Hello World this is a test document");
    // Don't wait long — navigate IMMEDIATELY (under 500ms debounce)
    await page.waitForTimeout(100);

    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

    // Trash IMMEDIATELY
    await page.keyboard.press("ControlOrMeta+Backspace");
    // Click New IMMEDIATELY — test the race where A's debounce is pending
    await page.getByRole("button", { name: /new/i }).first().click();
    await page.waitForURL("**/", { timeout: 10_000 });
    await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 15_000 });
    // Wait past A's debounce window
    await page.waitForTimeout(1000);

    const finalDocs = await page.evaluate(
        () => (window as unknown as { __TAURI_MOCK__: { docs: MockDoc[] } }).__TAURI_MOCK__.docs,
    );
    const metaUpdates = await page.evaluate(
        () =>
            (
                window as unknown as {
                    __TAURI_MOCK__: {
                        metaUpdates: Array<{ id: string; title: string; previewText: string }>;
                    };
                }
            ).__TAURI_MOCK__.metaUpdates,
    );

    console.log("RACE FINAL DOCS:", JSON.stringify(finalDocs, null, 2));
    console.log("RACE META UPDATES:", JSON.stringify(metaUpdates, null, 2));

    const newDoc = finalDocs.find((d) => !d.deletedAt);
    expect(newDoc).toBeDefined();
    if (!newDoc) return;

    expect(newDoc.previewText).not.toContain("Hello World");
    expect(newDoc.title).not.toContain("Hello World");
});

test("new document after permanently deleting previous does not inherit preview/title", async ({
    page,
}) => {
    await installMock(page);

    await page.goto("/library");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /new/i }).first().click();
    await page.waitForURL("**/", { timeout: 10_000 });

    const editor = page.locator(".cm-content").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.click();
    await page.keyboard.type("Hello World this is a test document");
    await page.waitForTimeout(900);

    // Back to library.
    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

    // Trash.
    await page.keyboard.press("ControlOrMeta+Backspace");
    await page.waitForTimeout(300);

    // Switch to Trash tab.
    await page
        .locator("button")
        .filter({ hasText: /^.*Trash$/ })
        .first()
        .click();
    await page.waitForTimeout(300);

    // Click first trashed doc, then its delete permanent button twice (confirm).
    const trashedCards = page.locator("[role='button']").filter({ has: page.locator(".truncate") });
    await trashedCards.first().click();
    const delBtn = page
        .locator("button[title*='Delete permanently'], button[title*='Click again to confirm']")
        .first();
    await delBtn.click();
    await delBtn.click();
    await page.waitForTimeout(300);

    // Back to library tab.
    await page
        .locator("button")
        .filter({ hasText: /^.*Library$/ })
        .first()
        .click();
    await page.waitForTimeout(300);

    // Click New for doc B.
    await page.getByRole("button", { name: /new/i }).first().click();
    await page.waitForURL("**/", { timeout: 10_000 });
    await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(900);

    const finalDocs = await page.evaluate(
        () => (window as unknown as { __TAURI_MOCK__: { docs: MockDoc[] } }).__TAURI_MOCK__.docs,
    );
    const metaUpdates = await page.evaluate(
        () =>
            (
                window as unknown as {
                    __TAURI_MOCK__: {
                        metaUpdates: Array<{ id: string; title: string; previewText: string }>;
                    };
                }
            ).__TAURI_MOCK__.metaUpdates,
    );

    console.log("PERMDEL FINAL DOCS:", JSON.stringify(finalDocs, null, 2));
    console.log("PERMDEL META UPDATES:", JSON.stringify(metaUpdates, null, 2));

    const newDoc = finalDocs.find((d) => !d.deletedAt);
    expect(newDoc).toBeDefined();
    if (!newDoc) return;

    expect(newDoc.previewText).not.toContain("Hello World");
    expect(newDoc.title).not.toContain("Hello World");
});

test("new document after trashing previous does not inherit preview/title", async ({ page }) => {
    await installMock(page);

    page.on("console", (msg) => {
        if (msg.type() !== "log") return;
        // noisy; keep for debugging
    });

    // Start at library, click New to create doc A.
    await page.goto("/library");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 15_000 });
    // Click the + New button in the library toolbar
    await page.getByRole("button", { name: /new/i }).first().click();

    // Wait for editor route.
    await page.waitForURL("**/", { timeout: 10_000 });
    // Wait for the cm-content DIV (the editor).
    const editor = page.locator(".cm-content").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.click();
    await page.keyboard.type("Hello World this is a test document");

    // Wait for metadata debounce (500ms) to fire.
    await page.waitForTimeout(900);

    // Capture A's DB state
    const afterTypingA = await page.evaluate(
        () => (window as unknown as { __TAURI_MOCK__: { docs: MockDoc[] } }).__TAURI_MOCK__.docs,
    );
    console.log("AFTER TYPING A:", JSON.stringify(afterTypingA, null, 2));
    const docA = afterTypingA[0];
    expect(docA.previewText).toContain("Hello World");

    // Navigate back to library.
    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

    // Trash doc A via keyboard (first doc is auto-selected).
    await page.keyboard.press("ControlOrMeta+Backspace");
    await page.waitForTimeout(300);

    // Click New for doc B.
    await page.getByRole("button", { name: /new/i }).first().click();
    await page.waitForURL("**/", { timeout: 10_000 });
    await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 15_000 });

    // Wait for the Editor to settle and any debounces to fire.
    await page.waitForTimeout(900);

    // Read all docs from mock DB.
    const finalDocs = await page.evaluate(
        () => (window as unknown as { __TAURI_MOCK__: { docs: MockDoc[] } }).__TAURI_MOCK__.docs,
    );
    const metaUpdates = await page.evaluate(
        () =>
            (
                window as unknown as {
                    __TAURI_MOCK__: {
                        metaUpdates: Array<{ id: string; title: string; previewText: string }>;
                    };
                }
            ).__TAURI_MOCK__.metaUpdates,
    );

    console.log("FINAL DOCS:", JSON.stringify(finalDocs, null, 2));
    console.log("META UPDATES:", JSON.stringify(metaUpdates, null, 2));

    // Find the new (non-deleted) doc — that's B.
    const newDoc = finalDocs.find((d) => !d.deletedAt);
    expect(newDoc).toBeDefined();
    if (!newDoc) return;

    // B's preview should NOT contain A's content.
    expect(newDoc.previewText).not.toContain("Hello World");
    expect(newDoc.title).not.toContain("Hello World");
});
