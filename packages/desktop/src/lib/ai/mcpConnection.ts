import {
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    currentDraftLabel,
    currentTabId,
    currentTabLabel,
    editorView,
    modalStack,
    saveStatus,
} from "$lib/stores";
/** mcpConnection.ts — Window-scoped native transport for live editor MCP requests. */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { get } from "svelte/store";
import { createMcpEditorSession } from "./mcpEditor";
import { getEffectiveDocumentContext, getEffectiveEditorialPreferences } from "./settings.svelte";

export function connectMcpEditor(isReady: () => boolean): () => void {
    if (!isTauri()) return () => {};
    const window = getCurrentWebviewWindow();
    const session = createMcpEditorSession(() => ({
        rootView: isReady() ? get(editorView) : null,
        modals: get(modalStack),
        identity: {
            documentId: get(currentDocumentId),
            tabId: get(currentTabId),
            draftId: get(currentDraftId),
        },
        metadata: {
            documentTitle: get(currentDocumentTitle),
            tabLabel: get(currentTabLabel),
            draftLabel: get(currentDraftLabel),
            saveStatus: get(saveStatus),
            brief: getEffectiveDocumentContext(),
            editorialPreferences: getEffectiveEditorialPreferences(),
            windowLabel: window.label,
        },
    }));
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const ready = () => invoke("cmd_mcp_editor_ready", { ready: true });
    void (async () => {
        const unlisten = await window.listen<{
            id: string;
            name: string;
            arguments: unknown;
            expiresAt: number;
        }>("mcp:request", async ({ payload }) => {
            if (disposed) return;
            let result: Record<string, unknown>;
            try {
                result =
                    typeof payload.expiresAt === "number"
                        ? session.handle(payload.name, payload.arguments, payload.expiresAt)
                        : { error: "Restart Quillium to update the live MCP bridge." };
            } catch (error) {
                result = { error: error instanceof Error ? error.message : String(error) };
            }
            await invoke("cmd_mcp_reply", { id: payload.id, result }).catch((error) =>
                console.error("[mcpConnection] Could not deliver editor result", error),
            );
        });
        if (disposed) {
            unlisten();
            return;
        }
        cleanup.push(unlisten);
        const unfocus = await window.onFocusChanged(({ payload: focused }) => {
            if (focused && !disposed) void ready().catch(console.error);
        });
        if (disposed) {
            unfocus();
            return;
        }
        cleanup.push(unfocus);
        await ready();
    })().catch((error) => console.error("[mcpConnection] Could not connect live editor", error));
    return () => {
        disposed = true;
        for (const stop of cleanup) stop();
        session.dispose();
        void invoke("cmd_mcp_editor_ready", { ready: false }).catch(console.error);
    };
}
