import { expect, test, type Page } from "@playwright/test";

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
        localStorage.setItem("quillium_beta_accepted", "true");
        localStorage.setItem("quillium_changelog_seen", "99.99");
        localStorage.setItem(
            "quillium-app-settings",
            JSON.stringify({
                autoVersionOnRevisionCreate: false,
            }),
        );

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
            // biome-ignore lint/suspicious/noExplicitAny: test mock
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
                    const snapshot = snapshots.filter((s) => s.draftId === draftId).pop();
                    const eventsSince = events
                        .filter((e) => e.draftId === draftId && (!snapshot || e.id > snapshot.upToEventId))
                        .map((e) => ({
                            id: e.id,
                            eventType: e.eventType,
                            payload: e.payload,
                            createdAt: e.createdAt,
                        }));
                    return {
                        snapshotStateJson: snapshot?.stateJson ?? null,
                        snapshotEventId: snapshot?.upToEventId ?? -1,
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
                if (cmd === "cmd_create_snapshot" || cmd === "cmd_create_named_snapshot") {
                    snapshots.push({
                        draftId: args.draftId,
                        stateJson: args.stateJson,
                        upToEventId: args.upToEventId,
                    });
                    return null;
                }
                if (cmd === "cmd_get_trash_retention" || cmd === "cmd_set_trash_retention") {
                    return null;
                }
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

test("new document after trashing previous does not inherit preview/title", async ({ page }) => {
    await installMock(page);

    await page.goto("/library");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("n");

    const editor = page.locator(".cm-content").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.click();
    await page.keyboard.type("Hello World this is a test document");
    await page.waitForTimeout(900);

    const afterTypingA = await page.evaluate(
        () => (window as unknown as { __TAURI_MOCK__: { docs: MockDoc[] } }).__TAURI_MOCK__.docs,
    );
    const docA = afterTypingA[0];
    expect(docA.previewText).toContain("Hello World");

    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("ControlOrMeta+Backspace");
    await page.waitForTimeout(300);

    await page.keyboard.press("n");
    await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(900);

    const finalDocs = await page.evaluate(
        () => (window as unknown as { __TAURI_MOCK__: { docs: MockDoc[] } }).__TAURI_MOCK__.docs,
    );

    const newDoc = finalDocs.find((d) => !d.deletedAt);
    expect(newDoc).toBeDefined();
    if (!newDoc) return;

    expect(newDoc.previewText).not.toContain("Hello World");
    expect(newDoc.title).not.toContain("Hello World");
});

test("new document after immediate navigation does not inherit pending preview/title", async ({
    page,
}) => {
    await installMock(page);

    await page.goto("/library");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("n");

    const editor = page.locator(".cm-content").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.click();
    await page.keyboard.type("Hello World this is a test document");
    await page.waitForTimeout(100);

    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("ControlOrMeta+Backspace");
    await page.keyboard.press("n");
    await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(1000);

    const finalDocs = await page.evaluate(
        () => (window as unknown as { __TAURI_MOCK__: { docs: MockDoc[] } }).__TAURI_MOCK__.docs,
    );

    const newDoc = finalDocs.find((d) => !d.deletedAt);
    expect(newDoc).toBeDefined();
    if (!newDoc) return;

    expect(newDoc.previewText).not.toContain("Hello World");
    expect(newDoc.title).not.toContain("Hello World");
});
