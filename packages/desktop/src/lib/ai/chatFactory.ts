import {
    annotationField,
    createComment,
    createRevision,
    createSuggestion,
} from "$lib/editor/plugins/annotations";
import type { AiGenerationProvenance } from "$lib/editor/plugins/annotations/models";
import { getActiveAnnotation } from "$lib/editor/plugins/annotations/utils";
import posthog from "$lib/posthog";
import type { ReaderPersona } from "$lib/readers/presets";
import {
    activeAnnotation,
    annotations,
    currentDocumentId,
    currentDraftId,
    currentTabId,
    documentContent,
    editorView,
    selectedText,
    selectedTextRange,
} from "$lib/stores";
import { Chat } from "@ai-sdk/svelte";
import type { EditorView } from "@codemirror/view";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { toast } from "svelte-sonner";
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
import { buildAnnotationContextInputs } from "./annotationContext";
import {
    type CommentInput,
    type RevisionInput,
    type StreamOpts,
    type SuggestionInput,
    streamChat,
    streamDictionary,
    streamFeedback,
    streamRevise,
} from "./clientStreams";
import {
    type EditorialAction,
    type EditorialTask,
    compileEditorialPolicy,
} from "./editorialPolicy";
import {
    type EditorialTargetSnapshot,
    captureEditorialTarget,
    getActiveEditorialView,
    getEditorialBranchPath,
    releaseEditorialTarget,
    resolveEditorialTargetRange,
    resolveEditorialTargetView,
    validateEditorialActionTarget,
} from "./editorialTarget";
import {
    clearAiConversation,
    isPersistentConversationMode,
    saveAiConversation,
} from "./persistence";
import { createAiGenerationProvenance } from "./provenance";
import {
    aiSettings,
    documentContext,
    editorialPreferences,
    ensureApiKeyLoaded,
    getAiAbortSignal,
    setAiProcessing,
} from "./settings.svelte";

type ToolCall =
    | { toolName: "createComment"; input: CommentInput }
    | { toolName: "createSuggestion"; input: SuggestionInput }
    | { toolName: "createRevision"; input: RevisionInput };

type AiChatMode = "chat" | "feedback" | "revise" | "dictionary";

const MODE_TASKS: Record<AiChatMode, EditorialTask> = {
    chat: "conversation",
    feedback: "global-review",
    revise: "local-rewrite",
    dictionary: "dictionary",
};

const PROVENANCE_TASKS = {
    feedback: "global-review",
    revise: "local-rewrite",
} as const;

const TOOL_ACTIONS: Record<ToolCall["toolName"], EditorialAction> = {
    createComment: "comment",
    createSuggestion: "suggestion",
    createRevision: "revision",
};

type ToolCallGuard = {
    target: EditorialTargetSnapshot;
    allowedActions: readonly EditorialAction[];
    provenance: AiGenerationProvenance;
};

/**
 * Route LLM tool calls to the CodeMirror annotation system.
 *
 * Called by the Chat class whenever the model invokes a tool during
 * streaming. Each tool name maps to an annotation-system helper that
 * finds the target text in the editor and attaches the annotation.
 */
function handleToolCall(toolCall: ToolCall, guard: ToolCallGuard, author?: string) {
    const rootView = get(editorView);
    if (!rootView) return;
    const view = resolveEditorialTargetView(rootView, guard.target);
    if (!view) {
        console.warn("[chatFactory] rejected AI annotation: branch-changed");
        toast.warning("The revision branch changed, so Quillium skipped one AI annotation.");
        return;
    }

    const validation = validateEditorialActionTarget({
        snapshot: guard.target,
        current: {
            documentId: get(currentDocumentId),
            tabId: get(currentTabId),
            draftId: get(currentDraftId),
            documentText: view.state.doc.toString(),
            selectedTextRange: resolveEditorialTargetRange(view, guard.target),
            branchPath: getEditorialBranchPath(view),
        },
        targetText: toolCall.input.targetText,
        action: TOOL_ACTIONS[toolCall.toolName],
        allowedActions: guard.allowedActions,
    });
    if (!validation.ok) {
        console.warn("[chatFactory] rejected AI annotation:", validation.reason);
        toast.warning("The draft or selection changed, so Quillium skipped one AI annotation.");
        return;
    }

    try {
        dispatchToolCall(toolCall, view, guard.provenance, author);
    } catch (e) {
        // The model may reference text that no longer exists (the user edited
        // mid-stream, or the text was hallucinated). Skip that annotation
        // instead of failing the whole stream.
        console.warn("[chatFactory] tool call failed, skipping annotation:", e);
        toast.warning("The AI referenced text that couldn't be found — skipped one annotation.");
    }
}

function dispatchToolCall(
    toolCall: ToolCall,
    view: EditorView,
    provenance: AiGenerationProvenance,
    author?: string,
) {
    switch (toolCall.toolName) {
        case "createComment": {
            const { targetText, context, comment } = toolCall.input;
            createComment({ targetText, context, comment, view, author, aiProvenance: provenance });
            posthog.capture("annotation_created", { type: "comment", persona: author });
            break;
        }
        case "createSuggestion": {
            const { targetText, context, replacements, comment } = toolCall.input;
            createSuggestion({
                targetText,
                context,
                replacements,
                comment,
                state: view.state,
                dispatch: view.dispatch,
                author,
                aiProvenance: provenance,
            });
            posthog.capture("annotation_created", {
                type: "suggestion",
                replacement_count: replacements.length,
                persona: author,
            });
            break;
        }
        case "createRevision": {
            const { targetText, context, versions, threadMessage } = toolCall.input;
            const created = createRevision({
                targetText,
                context,
                versions,
                threadMessage,
                view,
                author,
                aiProvenance: provenance,
            });
            if (created) {
                posthog.capture("annotation_created", {
                    type: "revision",
                    version_count: versions.length,
                    persona: author,
                });
            }
            break;
        }
    }
}

type StreamFn = (opts: StreamOpts) => Promise<ReadableStream<UIMessageChunk>>;

/**
 * Run a stream function through multiple personas in parallel.
 * Each persona gets its own stream with its own tool-call handler
 * that attributes annotations to that persona.
 */
export async function runMultiPersonaStreams({
    personas,
    streamFn,
    messages,
    mode,
}: {
    personas: ReaderPersona[];
    streamFn: StreamFn;
    messages: UIMessage[];
    mode: "feedback" | "revise";
}): Promise<void> {
    await ensureApiKeyLoaded();

    const abortSignal = getAiAbortSignal();
    // Annotations from these streams must land in the document the review
    // was started on — if the user switches documents mid-stream, tool
    // calls would otherwise be applied to the wrong document.
    const rootView = get(editorView);
    const targetView = rootView ? getActiveEditorialView(rootView) : undefined;
    const targetSelection = targetView?.state.selection.main;
    const targetSelectedText =
        targetView && targetSelection && !targetSelection.empty
            ? targetView.state.sliceDoc(targetSelection.from, targetSelection.to)
            : "";
    const targetAtStart = captureEditorialTarget({
        view: targetView ?? null,
        documentId: get(currentDocumentId),
        tabId: get(currentTabId),
        draftId: get(currentDraftId),
        selectedText: targetSelectedText,
        selectedTextRange:
            targetSelection && !targetSelection.empty
                ? { from: targetSelection.from, to: targetSelection.to }
                : undefined,
    });
    const documentContentAtStart = targetView?.state.doc.toString() ?? get(documentContent);
    const selectedTextAtStart = targetAtStart.selectedText;
    const selectedTextRangeAtStart = targetAtStart.selectedTextRange;
    const policy = compileEditorialPolicy({
        task: MODE_TASKS[mode],
        hasSelection: !!selectedTextAtStart,
    });
    const annotationContextAtStart = buildAnnotationContextInputs({
        annotations: targetView?.state.field(annotationField, false) ?? get(annotations),
        documentContent: documentContentAtStart,
        selectedText: selectedTextAtStart,
        selectedTextRange: selectedTextRangeAtStart,
        activeAnnotation: targetView
            ? getActiveAnnotation(targetView.state)
            : get(activeAnnotation),
    });

    const tasks = personas.map(async (persona) => {
        const provenance = createAiGenerationProvenance({
            task: PROVENANCE_TASKS[mode],
            provider: aiSettings.provider,
            model: aiSettings.model,
            persona: persona.name,
        });
        const stream = await streamFn({
            messages,
            documentContent: documentContentAtStart,
            selectedText: selectedTextAtStart,
            selectedTextRange: selectedTextRangeAtStart,
            provider: aiSettings.provider,
            model: aiSettings.model,
            apiKey: aiSettings.apiKey,
            baseURL: aiSettings.baseURL,
            documentContext: { ...documentContext },
            editorialPreferences: { ...editorialPreferences },
            annotationContext: annotationContextAtStart,
            persona,
            abortSignal,
        });

        const reader = stream.getReader();
        try {
            while (true) {
                if (abortSignal.aborted) {
                    await reader.cancel();
                    return;
                }
                const { value, done } = await reader.read();
                if (done) break;
                if (value?.type === "tool-input-available") {
                    handleToolCall(
                        { toolName: value.toolName, input: value.input } as ToolCall,
                        {
                            target: targetAtStart,
                            allowedActions: policy.allowedActions,
                            provenance,
                        },
                        persona.name,
                    );
                }
            }
        } catch (e) {
            if (abortSignal.aborted) return;
            throw e;
        }

        posthog.capture("reader_persona_review_completed", {
            persona: persona.id,
            mode,
        });
    });

    try {
        await Promise.all(tasks);
    } finally {
        releaseEditorialTarget(targetView, targetAtStart);
    }
}

/**
 * Build a ChatTransport that captures current editor/settings state
 * at send-time and delegates to the given stream function.
 *
 * The transport snapshots `documentContent`, `selectedText`, provider
 * config, and document-context fields from their respective stores so
 * the stream function always sees a consistent view of the world.
 */
function makeTransport(
    streamFn: StreamFn,
    captureTarget: (target: EditorialTargetSnapshot) => void,
): ChatTransport<UIMessage> {
    return {
        async sendMessages({
            messages,
            abortSignal,
        }: { messages: UIMessage[]; abortSignal?: AbortSignal } & Record<string, unknown>) {
            await ensureApiKeyLoaded();
            const rootView = get(editorView);
            const targetView = rootView ? getActiveEditorialView(rootView) : undefined;
            const selection = targetView?.state.selection.main;
            const documentContentAtSend = targetView?.state.doc.toString() ?? get(documentContent);
            const selectedTextAtSend =
                targetView && selection
                    ? selection.empty
                        ? ""
                        : targetView.state.sliceDoc(selection.from, selection.to)
                    : get(selectedText);
            const selectedTextRangeAtSend =
                targetView && selection
                    ? selection.empty
                        ? undefined
                        : { from: selection.from, to: selection.to }
                    : get(selectedTextRange);
            captureTarget(
                captureEditorialTarget({
                    view: targetView ?? null,
                    documentId: get(currentDocumentId),
                    tabId: get(currentTabId),
                    draftId: get(currentDraftId),
                    selectedText: selectedTextAtSend,
                    selectedTextRange: selectedTextRangeAtSend,
                }),
            );
            return streamFn({
                messages,
                documentContent: documentContentAtSend,
                selectedText: selectedTextAtSend,
                selectedTextRange: selectedTextRangeAtSend,
                provider: aiSettings.provider,
                model: aiSettings.model,
                apiKey: aiSettings.apiKey,
                baseURL: aiSettings.baseURL,
                documentContext: { ...documentContext },
                editorialPreferences: { ...editorialPreferences },
                annotationContext: buildAnnotationContextInputs({
                    annotations:
                        targetView?.state.field(annotationField, false) ?? get(annotations),
                    documentContent: documentContentAtSend,
                    selectedText: selectedTextAtSend,
                    selectedTextRange: selectedTextRangeAtSend,
                    activeAnnotation: targetView
                        ? getActiveAnnotation(targetView.state)
                        : get(activeAnnotation),
                }),
                abortSignal,
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
 * Each mode maps to a task recipe and its allowed tool set. The returned `chat` object
 * is a reactive @ai-sdk/svelte Chat whose `.messages`, `.status`,
 * and `.error` properties drive the component UI.
 */
export function createAiChat({ mode }: { mode: AiChatMode }) {
    const streamFns = {
        chat: streamChat,
        feedback: streamFeedback,
        revise: streamRevise,
        dictionary: streamDictionary,
    } as const;

    const transportWithTracking: StreamFn = async (opts) => {
        posthog.capture("ai_message_sent", {
            mode,
            has_document_context: !!opts.documentContext?.freeform?.trim(),
            has_selected_text: !!opts.selectedText,
            annotation_context_count: opts.annotationContext?.length ?? 0,
            document_length: opts.documentContent?.length ?? 0,
        });
        return streamFns[mode](opts);
    };

    let targetAtSend: EditorialTargetSnapshot | undefined;
    let provenanceAtSend: AiGenerationProvenance | undefined;

    function releaseTargetAtSend() {
        releaseEditorialTarget(targetAtSend?.ownerView, targetAtSend);
        targetAtSend = undefined;
        provenanceAtSend = undefined;
    }

    const chat = new Chat({
        transport: makeTransport(transportWithTracking, (target) => {
            releaseTargetAtSend();
            targetAtSend = target;
            provenanceAtSend =
                mode === "feedback" || mode === "revise"
                    ? createAiGenerationProvenance({
                          task: PROVENANCE_TASKS[mode],
                          provider: aiSettings.provider,
                          model: aiSettings.model,
                      })
                    : undefined;
        }),
        onToolCall: ({ toolCall }) => {
            if (!targetAtSend || !provenanceAtSend) return;
            const policy = compileEditorialPolicy({
                task: MODE_TASKS[mode],
                hasSelection: !!targetAtSend.selectedText,
            });
            handleToolCall(toolCall as ToolCall, {
                target: targetAtSend,
                allowedActions: policy.allowedActions,
                provenance: provenanceAtSend,
            });
        },
        onFinish: ({ messages }) => {
            const draftId = targetAtSend?.draftId;
            releaseTargetAtSend();
            if (!draftId || !isPersistentConversationMode(mode)) return;
            void saveAiConversation(draftId, mode, messages).catch((error) => {
                console.error("[chatFactory] failed to save AI conversation", error);
            });
        },
        onError: () => {
            releaseTargetAtSend();
        },
    });

    function clearChat() {
        chat.messages = [];
        const draftId = get(currentDraftId);
        if (!draftId || !isPersistentConversationMode(mode)) return;
        void clearAiConversation(draftId, mode).catch((error) => {
            console.error("[chatFactory] failed to clear AI conversation", error);
        });
    }

    return { chat, clearChat };
}

// Re-export so components only need one import for all chat concerns
export { beginAiTask, endAiTask, setAiProcessing, useAiChatEffects } from "./settings.svelte";
