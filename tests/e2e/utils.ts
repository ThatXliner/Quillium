import type { Page } from "@playwright/test";

export async function installTauriMock(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem("quillium_tutorial_seen", "1");
        localStorage.setItem("quillium_beta_accepted", "true");
        localStorage.setItem("quillium_changelog_seen", "999.999");
        localStorage.setItem(
            "quillium-app-settings",
            JSON.stringify({
                showNestedEditor: true,
                atomicRevisions: true,
                autoVersionOnRevisionCreate: false,
            }),
        );

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
                if (cmd === "cmd_list_tabs")
                    return [
                        {
                            id: "tab-1",
                            documentId: "doc-1",
                            tabType: "draft",
                            label: "Main",
                            position: 0,
                            createdAt: 0,
                        },
                    ];
                if (cmd === "cmd_create_tab")
                    return {
                        id: "tab-1",
                        documentId: "doc-1",
                        tabType: "draft",
                        label: "Main",
                        position: 0,
                        createdAt: 0,
                    };
                if (cmd === "cmd_list_tab_drafts")
                    return [
                        {
                            id: "draft-1",
                            documentId: "doc-1",
                            label: "main",
                            createdAt: 0,
                            isActive: true,
                            tabId: "tab-1",
                            parentDraftId: null,
                            locked: false,
                        },
                    ];
                if (cmd === "cmd_get_active_tab" || cmd === "cmd_get_active_draft") return null;
                if (cmd === "cmd_set_active_tab" || cmd === "cmd_set_active_draft") return null;
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

export async function getCmText(locator: ReturnType<Page["locator"]>): Promise<string> {
    return locator.evaluate((el) => {
        const lines = el.querySelectorAll(".cm-line");
        if (lines.length > 0) {
            return Array.from(lines)
                .map((l) => l.textContent ?? "")
                .join("\n");
        }
        return el.textContent ?? "";
    });
}
