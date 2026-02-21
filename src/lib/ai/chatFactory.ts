import { get } from "svelte/store";
import { Chat } from "@ai-sdk/svelte";
import { type UIMessage, type UIMessageChunk, type ChatTransport } from "ai";
import { documentContent, selectedText, editorView } from "$lib/stores";
import {
    aiSettings,
    documentContext,
    setAiProcessing,
} from "./settings.svelte";
import {
    createComment,
    createRevision,
    createSuggestion,
} from "$lib/editor/plugins/annotations";
import { streamChat, streamFeedback, streamRevise } from "./clientStreams";

/**
 * Factory for all AI chat panels.
 *
 * Uses a custom ChatTransport that runs inference directly in the browser
 * using the user's own API key (BYOK) — no server routes required.
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

type StreamFn = (opts: {
    messages: UIMessage[];
    documentContent: string;
    selectedText: string;
    provider: typeof aiSettings.provider;
    model: string;
    apiKey: string;
    documentContext: Record<string, string>;
}) => ReadableStream<UIMessageChunk>;

function makeTransport(streamFn: StreamFn): ChatTransport<UIMessage> {
    return {
        sendMessages({ messages }: { messages: UIMessage[] } & Record<string, unknown>) {
            return Promise.resolve(
                streamFn({
                    messages,
                    documentContent: get(documentContent),
                    selectedText: get(selectedText),
                    provider: aiSettings.provider,
                    model: aiSettings.model,
                    apiKey: aiSettings.apiKey,
                    documentContext: { ...documentContext },
                }),
            );
        },
        reconnectToStream() {
            return Promise.resolve(null);
        },
    };
}

export function createAiChat({ mode }: { mode: "chat" | "feedback" | "revise" }) {
    const streamFns = {
        chat: streamChat,
        feedback: streamFeedback,
        revise: streamRevise,
    } as const;

    const chat = new Chat({
        transport: makeTransport(streamFns[mode]),
        onToolCall: handleToolCall,
    });

    function clearChat() {
        chat.messages = [];
    }

    return { chat, clearChat };
}

// Re-export so components only need one import for all chat concerns
export { setAiProcessing };
