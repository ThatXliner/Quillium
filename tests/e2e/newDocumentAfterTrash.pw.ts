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

type MockOptions = {
    appendDelayMs?: number;
};

async function installMock(page: Page, options: MockOptions = {}) {
    await page.addInitScript((payload: MockOptions) => {
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
        const events: Array<{
            id: number;
            draftId: string;
            payload: string;
            eventType: string;
            createdAt: number;
        }> = [];
        const snapshots: Array<{
            id: number;
            draftId: string;
            upToEventId: number;
            createdAt: number;
            label: string | null;
            stateJson: string;
        }> = [];
        let nextEventId = 1;
        let nextSnapshotId = 1;

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
                    if ((payload.appendDelayMs ?? 0) > 0) {
                        await new Promise((resolve) => setTimeout(resolve, payload.appendDelayMs));
                    }
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
                        id: nextSnapshotId++,
                        draftId: args.draftId,
                        upToEventId: args.upToEventId,
                        createdAt: Date.now(),
                        label: null,
                        stateJson: args.stateJson,
                    });
                    return null;
                }
                if (cmd === "cmd_create_named_snapshot") {
                    const id = nextSnapshotId++;
                    snapshots.unshift({
                        id,
                        draftId: args.draftId,
                        upToEventId: args.upToEventId,
                        createdAt: Date.now(),
                        label: args.label,
                        stateJson: args.stateJson,
                    });
                    return id;
                }
                if (cmd === "cmd_list_snapshots") {
                    return snapshots
                        .filter((s) => s.draftId === args.draftId)
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .map(({ id, draftId, upToEventId, createdAt, label }) => ({
                            id,
                            draftId,
                            upToEventId,
                            createdAt,
                            label,
                        }));
                }
                if (cmd === "cmd_load_snapshot_state") {
                    return snapshots.find((s) => s.id === args.snapshotId)?.stateJson ?? null;
                }
                if (cmd === "cmd_get_snapshot_storage_size") return 0;
                if (cmd === "cmd_get_snapshot_retention") return null;
                if (cmd === "cmd_set_snapshot_retention") return null;
                if (cmd === "cmd_restore_to_snapshot") return null;
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
    }, options);
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

test("clearing text before navigation does not leak stale preview/title into the next doc", async ({
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
    await page.waitForTimeout(900);

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(100);

    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("n");
    await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(1200);

    const finalDocs = await page.evaluate(
        () => (window as unknown as { __TAURI_MOCK__: { docs: MockDoc[] } }).__TAURI_MOCK__.docs,
    );

    const newDoc = finalDocs[finalDocs.length - 1];
    expect(newDoc).toBeDefined();
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

test("permanently deleting a trashed doc does not let its preview/title leak into the next doc", async ({
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
    await page.waitForTimeout(900);

    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("ControlOrMeta+Backspace");
    await page.waitForTimeout(300);

    await page
        .locator("button")
        .filter({ hasText: /^.*Trash$/ })
        .first()
        .click();
    await page.waitForTimeout(300);

    const trashedCards = page.locator("[role='button']").filter({ has: page.locator(".truncate") });
    await trashedCards.first().click();
    const deleteButton = page
        .locator("button[title*='Delete permanently'], button[title*='Click again to confirm']")
        .first();
    await deleteButton.click();
    await deleteButton.click();
    await page.waitForTimeout(300);

    await page
        .locator("button")
        .filter({ hasText: /^.*Library$/ })
        .first()
        .click();
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

test("opening existing doc B right after editing doc A does not copy A metadata onto B", async ({
    page,
}) => {
    await installMock(page);

    await page.goto("/library");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("n");
    const editor = page.locator(".cm-content").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.click();
    await page.keyboard.type("Second document keeps its own title");
    await page.waitForTimeout(900);
    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("n");
    await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 15_000 });
    await editor.click();
    await page.keyboard.type("Hello World this is a test document");
    await page.waitForTimeout(100);

    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Enter");
    await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(900);

    const finalDocs = await page.evaluate(
        () => (window as unknown as { __TAURI_MOCK__: { docs: MockDoc[] } }).__TAURI_MOCK__.docs,
    );

    const docB = finalDocs[0];
    const docA = finalDocs[1];
    expect(docB.title).toContain("Second document");
    expect(docB.previewText).toContain("Second document");
    expect(docB.title).not.toContain("Hello World");
    expect(docB.previewText).not.toContain("Hello World");
    expect(docA.title).toContain("Hello World");
});

test("immediate navigation to history still allows saving a checkpoint from the latest edit", async ({
    page,
}) => {
    await installMock(page, { appendDelayMs: 300 });

    await page.goto("/library");
    await expect(page.getByText("Your Library")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("n");

    const editor = page.locator(".cm-content").first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.click();
    await page.keyboard.type("History race regression text");

    await page.keyboard.press("ControlOrMeta+Shift+h");
    await expect(page.getByText("Version History")).toBeVisible({ timeout: 10_000 });

    const saveButton = page.getByRole("button", { name: /^save$/i });
    await page.getByPlaceholder("Name this version…").fill("Immediate history checkpoint");
    await expect(saveButton).toBeEnabled({ timeout: 10_000 });
    await saveButton.click();

    await expect
        .poll(async () => {
            return page.evaluate(
                () =>
                    (
                        window as unknown as {
                            __TAURI_MOCK__: { invokeCalls: Array<{ cmd: string }> };
                        }
                    ).__TAURI_MOCK__.invokeCalls.map((x) => x.cmd),
            );
        })
        .toContain("cmd_create_named_snapshot");
});
