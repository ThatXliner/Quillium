/**
 * Chat factory — wires AI streaming to the Svelte Chat class.
 *
 * This file is the glue between the UI chat components (Chat.svelte,
 * Feedback.svelte, Revise.svelte) and the streaming functions in
 * `clientStreams.ts`. It has three responsibilities:
 *
 * 1. **Transport creation** (`makeTransport`) — builds a
 *    `ChatTransport` that snapshots the current editor content,
 *    selection, provider settings, and document context at send-time,
 *    then delegates to the appropriate stream function.
 *
 * 2. **Tool-call routing** (`handleToolCall`) — when the LLM invokes
 *    a tool (createComment, createSuggestion, createRevision), this
 *    function dispatches the call to the annotation system which
 *    applies changes to the CodeMirror editor.
 *
 * 3. **Factory function** (`createAiChat`) — returns a `Chat` instance
 *    and a `clearChat` helper, used by each panel component.
 *
 * Data flow:
 *   Component calls chat.sendMessage()
 *     --> ChatTransport.sendMessages()
 *       --> streamChat / streamFeedback / streamRevise (clientStreams)
 *         --> LLM responds (streamed UIMessageChunks)
 *           --> Chat class updates UI + triggers onToolCall
 *             --> handleToolCall applies annotations to editor
 *
 * Dependencies: @ai-sdk/svelte (Chat), ai SDK types, Svelte stores,
 *   settings.svelte.ts, clientStreams.ts, annotation system.
 */
import { get } from "svelte/store";
import { Chat } from "@ai-sdk/svelte";
import type { UIMessage, UIMessageChunk, ChatTransport } from "ai";
import posthog from "$lib/posthog";
import { documentContent, selectedText, editorView } from "$lib/stores";
import {
    aiSettings,
    documentContext,
    ensureApiKeyLoaded,
    setAiProcessing,
} from "./settings.svelte";
import { createComment, createRevision, createSuggestion } from "$lib/editor/plugins/annotations";
import {
    streamChat,
    streamFeedback,
    streamRevise,
    streamDictionary,
    type CommentInput,
    type RevisionInput,
    type SuggestionInput,
} from "./clientStreams";

type ToolCall =
    | { toolName: "createComment"; input: CommentInput }
    | { toolName: "createSuggestion"; input: SuggestionInput }
    | { toolName: "createRevision"; input: RevisionInput };

/**
 * Route LLM tool calls to the CodeMirror annotation system.
 *
 * Called by the Chat class whenever the model invokes a tool during
 * streaming. Each tool name maps to an annotation-system helper that
 * finds the target text in the editor and attaches the annotation.
 */
function handleToolCall(toolCall: ToolCall) {
    const view = get(editorView);
    if (!view) return;

    switch (toolCall.toolName) {
        case "createComment": {
            const { targetText, comment } = toolCall.input;
            createComment({ targetText, comment, view });
            posthog.capture("annotation_created", { type: "comment" });
            break;
        }
        case "createSuggestion": {
            const { targetText, replacements, comment } = toolCall.input;
            createSuggestion({
                targetText,
                replacements,
                comment,
                state: view.state,
                dispatch: view.dispatch,
            });
            posthog.capture("annotation_created", {
                type: "suggestion",
                replacement_count: replacements.length,
            });
            break;
        }
        case "createRevision": {
            const { targetText, versions, threadMessage } = toolCall.input;
            const created = createRevision({ targetText, versions, threadMessage, view });
            if (created) {
                posthog.capture("annotation_created", {
                    type: "revision",
                    version_count: versions.length,
                });
            }
            break;
        }
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

/**
 * Build a ChatTransport that captures current editor/settings state
 * at send-time and delegates to the given stream function.
 *
 * The transport snapshots `documentContent`, `selectedText`, provider
 * config, and document-context fields from their respective stores so
 * the stream function always sees a consistent view of the world.
 */
function makeTransport(streamFn: StreamFn): ChatTransport<UIMessage> {
    return {
        async sendMessages({ messages }: { messages: UIMessage[] } & Record<string, unknown>) {
            await ensureApiKeyLoaded();
            return streamFn({
                messages,
                documentContent: get(documentContent),
                selectedText: get(selectedText),
                provider: aiSettings.provider,
                model: aiSettings.model,
                apiKey: aiSettings.apiKey,
                documentContext: { ...documentContext },
            });
        },
        reconnectToStream() {
            return Promise.resolve(null);
        },
    };
}

/**
 * Create a Chat instance for the given AI mode.
 *
 * Each mode maps to a different stream function (and therefore a
 * different system prompt + tool set). The returned `chat` object
 * is a reactive @ai-sdk/svelte Chat whose `.messages`, `.status`,
 * and `.error` properties drive the component UI.
 */
export function createAiChat({ mode }: { mode: "chat" | "feedback" | "revise" | "dictionary" }) {
    const streamFns = {
        chat: streamChat,
        feedback: streamFeedback,
        revise: streamRevise,
        dictionary: streamDictionary,
    } as const;

    const transportWithTracking: StreamFn = (opts) => {
        posthog.capture("ai_message_sent", {
            mode,
            has_document_context: !!opts.documentContext?.freeform?.trim(),
            has_selected_text: !!opts.selectedText,
            document_length: opts.documentContent?.length ?? 0,
        });
        return streamFns[mode](opts);
    };

    const chat = new Chat({
        transport: makeTransport(transportWithTracking),
        onToolCall: ({ toolCall }) => handleToolCall(toolCall as ToolCall),
    });

    function clearChat() {
        chat.messages = [];
    }

    return { chat, clearChat };
}

// Re-export so components only need one import for all chat concerns
export { setAiProcessing };
