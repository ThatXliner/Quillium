import { get } from "svelte/store";
import { Chat, DefaultChatTransport } from "@ai-sdk/svelte";
import { documentContent, selectedText, editorView } from "$lib/stores";
import { aiSettings, documentContext, setAiProcessing } from "./settings.svelte";
import {
    createComment,
    createRevision,
    createSuggestion,
} from "$lib/editor/plugins/annotations";

/**
 * Factory for all AI chat panels.
 *
 * Deduplicates:
 *   - Shared request body (document content, selected text, provider, model,
 *     API key, document context).
 *   - Tool call handling — all annotation-creating tools are handled here.
 *     Each API endpoint declares which tools it uses; unrecognised tool names
 *     are silently ignored. To add a new tool, add it here only.
 *
 *   - clearChat() — resets message history. When the plugin system lands,
 *     this becomes "reload plugin". Only this file needs updating then.
 *
 *   - setAiProcessing — re-exported so components can wire the processing
 *     indicator ($effect) without importing from settings directly.
 */
function handleToolCall({ toolCall }: { toolCall: any }) {
    const view = get(editorView);
    if (!view) return;

    switch (toolCall.toolName) {
        case "createComment":
            createComment({
                targetText: toolCall.input.targetText,
                comment: toolCall.input.comment,
                view,
            });
            break;
        case "createSuggestion":
            createSuggestion({
                targetText: toolCall.input.targetText,
                replacements: toolCall.input.replacements,
                comment: toolCall.input.comment,
                state: view.state,
                dispatch: view.dispatch,
            });
            break;
        case "createRevision":
            createRevision({
                targetText: toolCall.input.targetText,
                versions: toolCall.input.versions,
                threadMessage: toolCall.input.threadMessage,
                view,
            });
            break;
    }
}

export function createAiChat({ api }: { api: string }) {
    const chat = new Chat({
        transport: new DefaultChatTransport({
            api,
            body: () => ({
                documentContent: get(documentContent),
                selectedText: get(selectedText),
                provider: aiSettings.provider,
                model: aiSettings.model,
                apiKey: aiSettings.apiKey,
                documentContext: { ...documentContext },
            }),
        }),
        onToolCall: handleToolCall,
    });

    function clearChat() {
        chat.messages = [];
    }

    return { chat, clearChat };
}

// Re-export so components only need one import for all chat concerns
export { setAiProcessing };
