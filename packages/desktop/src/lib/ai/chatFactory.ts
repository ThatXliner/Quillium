import { annotationField } from "$lib/editor/plugins/annotations";
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
    type EditorialActionPayload,
    applyEditorialAction,
    editorialActionFailureMessage,
} from "./editorialAction";
import {
    type EditorialAction,
    type EditorialPanelMode,
    type EditorialTask,
    type EditorialTurn,
    compileEditorialPolicy,
    resolveEditorialTask,
} from "./editorialPolicy";
import {
    type EditorialTargetSnapshot,
    captureEditorialTarget,
    getActiveEditorialView,
    releaseEditorialTarget,
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

type AiChatMode = EditorialPanelMode;

type EditorialTurnAtSend = {
    task: EditorialTask;
    exactWordCount?: number;
};

type ToolCallGuard = {
    target: EditorialTargetSnapshot;
    allowedActions: readonly EditorialAction[];
    provenance: AiGenerationProvenance;
    exactWordCount?: number;
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

    const result = applyEditorialAction({
        rootView,
        target: guard.target,
        current: {
            documentId: get(currentDocumentId),
            tabId: get(currentTabId),
            draftId: get(currentDraftId),
        },
        allowedActions: guard.allowedActions,
        payload: toolCallPayload(toolCall),
        provenance: guard.provenance,
        author,
        constraints:
            guard.exactWordCount === undefined
                ? undefined
                : { exactWordCount: guard.exactWordCount },
    });
    if (!result.ok) {
        console.warn("[chatFactory] rejected AI annotation:", result.reason);
        toast.warning(editorialActionFailureMessage(result.reason));
        return;
    }

    captureToolCallAnalytics(toolCall, author);
}

function toolCallPayload(toolCall: ToolCall): EditorialActionPayload {
    switch (toolCall.toolName) {
        case "createComment": {
            return { action: "comment", ...toolCall.input };
        }
        case "createSuggestion": {
            return { action: "suggestion", ...toolCall.input };
        }
        case "createRevision": {
            return { action: "revision", ...toolCall.input };
        }
    }
}

function captureToolCallAnalytics(toolCall: ToolCall, author?: string) {
    switch (toolCall.toolName) {
        case "createComment":
            posthog.capture("annotation_created", { type: "comment", persona: author });
            break;
        case "createSuggestion":
            posthog.capture("annotation_created", {
                type: "suggestion",
                replacement_count: toolCall.input.replacements.length,
                persona: author,
            });
            break;
        case "createRevision":
            posthog.capture("annotation_created", {
                type: "revision",
                version_count: toolCall.input.versions.length,
                persona: author,
            });
            break;
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
    turn,
}: {
    personas: ReaderPersona[];
    streamFn: StreamFn;
    messages: UIMessage[];
    mode: "feedback" | "revise";
    turn?: EditorialTurn;
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
    const task = resolveEditorialTask(mode, turn?.task);
    const exactWordCount = validExactWordCount(turn?.exactWordCount);
    if (task === "exact-compression" && exactWordCount === undefined) {
        releaseEditorialTarget(targetView, targetAtStart);
        throw new Error("Exact compression requires a positive whole-word target.");
    }
    if (task === "exact-compression" && !selectedTextAtStart) {
        releaseEditorialTarget(targetView, targetAtStart);
        throw new Error("Select a passage before requesting exact compression.");
    }
    const policy = compileEditorialPolicy({
        task,
        hasSelection: !!selectedTextAtStart,
        exactWordCount,
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
        const provenanceTask = actionProvenanceTask(task);
        const provenance = provenanceTask
            ? createAiGenerationProvenance({
                  task: provenanceTask,
                  provider: aiSettings.provider,
                  model: aiSettings.model,
                  persona: persona.name,
              })
            : undefined;
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
            editorialTask: task,
            exactWordCount,
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
                    if (!provenance) continue;
                    handleToolCall(
                        { toolName: value.toolName, input: value.input } as ToolCall,
                        {
                            target: targetAtStart,
                            allowedActions: policy.allowedActions,
                            provenance,
                            exactWordCount,
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

function validExactWordCount(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function actionProvenanceTask(task: EditorialTask): AiGenerationProvenance["task"] | undefined {
    if (
        task === "global-review" ||
        task === "local-rewrite" ||
        task === "exact-compression" ||
        task === "background-review"
    ) {
        return task;
    }
    return undefined;
}

function resolveTurnFromBody(mode: AiChatMode, body: object | undefined): EditorialTurnAtSend {
    const fields = body as Record<string, unknown> | undefined;
    const requestedTask =
        typeof fields?.editorialTask === "string"
            ? (fields.editorialTask as EditorialTask)
            : undefined;
    const task = resolveEditorialTask(mode, requestedTask);
    const exactWordCount = validExactWordCount(fields?.exactWordCount);
    if (task === "exact-compression" && exactWordCount === undefined) {
        throw new Error("Exact compression requires a positive whole-word target.");
    }
    return { task, exactWordCount };
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
    mode: AiChatMode,
    streamFn: StreamFn,
    captureTarget: (target: EditorialTargetSnapshot, turn: EditorialTurnAtSend) => void,
): ChatTransport<UIMessage> {
    return {
        async sendMessages({
            messages,
            abortSignal,
            body,
        }: {
            messages: UIMessage[];
            abortSignal?: AbortSignal;
            body?: object;
        } & Record<string, unknown>) {
            await ensureApiKeyLoaded();
            const turn = resolveTurnFromBody(mode, body);
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
            if (turn.task === "exact-compression" && !selectedTextAtSend) {
                throw new Error("Select a passage before requesting exact compression.");
            }
            captureTarget(
                captureEditorialTarget({
                    view: targetView ?? null,
                    documentId: get(currentDocumentId),
                    tabId: get(currentTabId),
                    draftId: get(currentDraftId),
                    selectedText: selectedTextAtSend,
                    selectedTextRange: selectedTextRangeAtSend,
                }),
                turn,
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
                editorialTask: turn.task,
                exactWordCount: turn.exactWordCount,
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
    let turnAtSend: EditorialTurnAtSend | undefined;

    function releaseTargetAtSend() {
        releaseEditorialTarget(targetAtSend?.ownerView, targetAtSend);
        targetAtSend = undefined;
        provenanceAtSend = undefined;
        turnAtSend = undefined;
    }

    const chat = new Chat({
        transport: makeTransport(mode, transportWithTracking, (target, turn) => {
            releaseTargetAtSend();
            targetAtSend = target;
            turnAtSend = turn;
            const provenanceTask = actionProvenanceTask(turn.task);
            provenanceAtSend = provenanceTask
                ? createAiGenerationProvenance({
                      task: provenanceTask,
                      provider: aiSettings.provider,
                      model: aiSettings.model,
                  })
                : undefined;
        }),
        onToolCall: ({ toolCall }) => {
            if (!targetAtSend || !provenanceAtSend || !turnAtSend) return;
            const policy = compileEditorialPolicy({
                task: turnAtSend.task,
                hasSelection: !!targetAtSend.selectedText,
                exactWordCount: turnAtSend.exactWordCount,
            });
            handleToolCall(toolCall as ToolCall, {
                target: targetAtSend,
                allowedActions: policy.allowedActions,
                provenance: provenanceAtSend,
                exactWordCount: turnAtSend.exactWordCount,
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

    function sendMessage(text: string, turn?: EditorialTurn): Promise<void> {
        const task = resolveEditorialTask(mode, turn?.task);
        const exactWordCount = validExactWordCount(turn?.exactWordCount);
        if (task === "exact-compression" && exactWordCount === undefined) {
            return Promise.reject(
                new Error("Exact compression requires a positive whole-word target."),
            );
        }
        return chat.sendMessage(
            { text },
            {
                body: {
                    editorialTask: task,
                    ...(exactWordCount === undefined ? {} : { exactWordCount }),
                },
            },
        );
    }

    return { chat, clearChat, sendMessage };
}

// Re-export so components only need one import for all chat concerns
export { beginAiTask, endAiTask, setAiProcessing, useAiChatEffects } from "./settings.svelte";
