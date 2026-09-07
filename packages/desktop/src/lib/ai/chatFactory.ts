import { logAppEvent } from "$lib/appLog";
import { assertCollegeContextReady } from "$lib/college/state.svelte";
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
    createConversationController,
    sanitizeOutboundMessages,
} from "./conversationController.svelte";
import {
    type EditorialActionPayload,
    applyEditorialAction,
    editorialActionFailureMessage,
} from "./editorialAction";
import {
    type EditorialAction,
    type EditorialPanelMode,
    type EditorialPreferences,
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
import { isPersistentConversationMode } from "./persistence";
import { createAiGenerationProvenance } from "./provenance";
import {
    aiSettings,
    ensureApiKeyLoaded,
    getAiAbortSignal,
    getEffectiveDocumentContext,
    getEffectiveEditorialPreferences,
} from "./settings.svelte";
import type { DocumentContext } from "./settings.svelte";

function effectiveDocumentContextSnapshot(): DocumentContext {
    return getEffectiveDocumentContext();
}

function effectiveEditorialPreferencesSnapshot(): EditorialPreferences {
    return getEffectiveEditorialPreferences();
}

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

type RequestContextSnapshot = {
    documentId: string | null;
    tabId: string | null;
    draftId: string | null;
    capturedAt: number;
    provider: string;
    model: string;
    draftText: string;
    selectedText: string;
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
    assertCollegeContextReady();
    const requestTarget = {
        documentId: get(currentDocumentId),
        tabId: get(currentTabId),
        draftId: get(currentDraftId),
    };
    const abortSignal = getAiAbortSignal();
    const documentContextAtStart = effectiveDocumentContextSnapshot();
    const editorialPreferencesAtStart = effectiveEditorialPreferencesSnapshot();
    const personasAtStart = JSON.parse(JSON.stringify(personas)) as ReaderPersona[];
    const aiSettingsAtStart = {
        provider: aiSettings.provider,
        model: aiSettings.model,
        baseURL: aiSettings.baseURL,
    };

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

    try {
        await ensureApiKeyLoaded();
        assertCollegeContextReady();
        if (
            abortSignal.aborted ||
            requestTarget.documentId !== get(currentDocumentId) ||
            requestTarget.tabId !== get(currentTabId) ||
            requestTarget.draftId !== get(currentDraftId) ||
            aiSettings.provider !== aiSettingsAtStart.provider ||
            aiSettings.model !== aiSettingsAtStart.model ||
            aiSettings.baseURL !== aiSettingsAtStart.baseURL
        ) {
            throw new Error(
                "The writing target or AI settings changed before the request started.",
            );
        }
    } catch (error) {
        releaseEditorialTarget(targetView, targetAtStart);
        throw error;
    }

    const apiKeyAtStart = aiSettings.apiKey;

    const tasks = personasAtStart.map(async (persona) => {
        const provenanceTask = actionProvenanceTask(task);
        const provenance = provenanceTask
            ? createAiGenerationProvenance({
                  task: provenanceTask,
                  provider: aiSettingsAtStart.provider,
                  model: aiSettingsAtStart.model,
                  persona: persona.name,
              })
            : undefined;
        const stream = await streamFn({
            messages: JSON.parse(JSON.stringify(messages)) as UIMessage[],
            documentContent: documentContentAtStart,
            selectedText: selectedTextAtStart,
            selectedTextRange: selectedTextRangeAtStart,
            provider: aiSettingsAtStart.provider,
            model: aiSettingsAtStart.model,
            apiKey: apiKeyAtStart,
            baseURL: aiSettingsAtStart.baseURL,
            documentContext: JSON.parse(
                JSON.stringify(documentContextAtStart),
            ) as typeof documentContextAtStart,
            editorialPreferences: { ...editorialPreferencesAtStart },
            editorialTask: task,
            exactWordCount,
            annotationContext: annotationContextAtStart,
            persona,
            annotationOnly: true,
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
                if (value?.type === "error") {
                    if (abortSignal.aborted) return;
                    toast.error(value.errorText);
                    throw new Error(value.errorText);
                }
                if (value?.type !== "tool-input-available") continue;
                if (value.toolName === "noAction") continue;
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
    captureTarget: (
        target: EditorialTargetSnapshot,
        turn: EditorialTurnAtSend,
        context: RequestContextSnapshot,
    ) => void,
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
            assertCollegeContextReady();
            const requestTarget = {
                documentId: get(currentDocumentId),
                tabId: get(currentTabId),
                draftId: get(currentDraftId),
            };
            const globalAbortSignal = getAiAbortSignal();
            const documentContextAtSend = effectiveDocumentContextSnapshot();
            const editorialPreferencesAtSend = effectiveEditorialPreferencesSnapshot();
            const aiSettingsAtSend = {
                provider: aiSettings.provider,
                model: aiSettings.model,
                baseURL: aiSettings.baseURL,
            };
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
            await ensureApiKeyLoaded();
            assertCollegeContextReady();
            if (
                globalAbortSignal.aborted ||
                abortSignal?.aborted ||
                requestTarget.documentId !== get(currentDocumentId) ||
                requestTarget.tabId !== get(currentTabId) ||
                requestTarget.draftId !== get(currentDraftId) ||
                aiSettings.provider !== aiSettingsAtSend.provider ||
                aiSettings.model !== aiSettingsAtSend.model ||
                aiSettings.baseURL !== aiSettingsAtSend.baseURL
            ) {
                throw new Error(
                    "The writing target or AI settings changed before the request started.",
                );
            }
            const apiKeyAtSend = aiSettings.apiKey;
            const turn = resolveTurnFromBody(mode, body);
            if (turn.task === "exact-compression" && !selectedTextAtSend) {
                throw new Error("Select a passage before requesting exact compression.");
            }
            captureTarget(
                captureEditorialTarget({
                    view: targetView ?? null,
                    documentId: requestTarget.documentId,
                    tabId: requestTarget.tabId,
                    draftId: requestTarget.draftId,
                    selectedText: selectedTextAtSend,
                    selectedTextRange: selectedTextRangeAtSend,
                }),
                turn,
                {
                    documentId: requestTarget.documentId,
                    tabId: get(currentTabId),
                    draftId: requestTarget.draftId,
                    capturedAt: Date.now(),
                    provider: aiSettingsAtSend.provider,
                    model: aiSettingsAtSend.model,
                    draftText: documentContentAtSend.slice(0, 2_000),
                    selectedText: selectedTextAtSend.slice(0, 500),
                },
            );
            return streamFn({
                messages: sanitizeOutboundMessages(messages),
                documentContent: documentContentAtSend,
                selectedText: selectedTextAtSend,
                selectedTextRange: selectedTextRangeAtSend,
                provider: aiSettingsAtSend.provider,
                model: aiSettingsAtSend.model,
                apiKey: apiKeyAtSend,
                baseURL: aiSettingsAtSend.baseURL,
                documentContext: JSON.parse(
                    JSON.stringify(documentContextAtSend),
                ) as typeof documentContextAtSend,
                editorialPreferences: { ...editorialPreferencesAtSend },
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

    function updateRequestContextMetadata(context: RequestContextSnapshot) {
        const index = [...chat.messages]
            .map((message, messageIndex) => ({ message, messageIndex }))
            .reverse()
            .find(({ message }) => message.role === "user")?.messageIndex;
        if (index === undefined) return;
        const message = chat.messages[index];
        const metadata =
            message.metadata &&
            typeof message.metadata === "object" &&
            !Array.isArray(message.metadata)
                ? (message.metadata as Record<string, unknown>)
                : {};
        const oldContext =
            metadata.writingContext &&
            typeof metadata.writingContext === "object" &&
            !Array.isArray(metadata.writingContext)
                ? (metadata.writingContext as Record<string, unknown>)
                : {};
        chat.messages = chat.messages.map((candidate, candidateIndex) =>
            candidateIndex === index
                ? {
                      ...candidate,
                      metadata: {
                          ...metadata,
                          writingContext: {
                              ...oldContext,
                              ...context,
                          },
                      },
                  }
                : candidate,
        );
    }

    const chat = new Chat({
        transport: makeTransport(mode, transportWithTracking, (target, turn, context) => {
            releaseTargetAtSend();
            targetAtSend = target;
            turnAtSend = turn;
            updateRequestContextMetadata(context);
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
        onFinish: () => {
            releaseTargetAtSend();
        },
        onError: (error) => {
            void logAppEvent("error", "ai", "AI chat failed", { mode, error });
            releaseTargetAtSend();
        },
    });

    const conversationController = isPersistentConversationMode(mode)
        ? createConversationController({
              chat,
              mode,
              beforeReplace: releaseTargetAtSend,
              requestSettings: () => ({
                  provider: aiSettings.provider,
                  model: aiSettings.model,
              }),
          })
        : undefined;

    if (conversationController) {
        Object.assign(chat, {
            conversationManaged: true,
            conversationController,
        });
    }

    const originalStop = chat.stop.bind(chat);
    chat.stop = async () => {
        releaseTargetAtSend();
        return originalStop();
    };

    function clearChat() {
        if (conversationController) {
            void conversationController.newConversation().catch((error) => {
                conversationController.reportError(error);
            });
            return;
        }
        chat.messages = [];
    }

    function sendMessage(text: string, turn?: EditorialTurn): Promise<void> {
        if (conversationController) {
            return conversationController.sendMessage(text, turn).catch((error) => {
                conversationController.reportError(error);
            });
        }

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

    return {
        chat,
        clearChat,
        sendMessage,
        conversations: conversationController?.conversations,
    };
}

// Re-export so components only need one import for all chat concerns
export { beginAiTask, endAiTask, setAiProcessing, useAiChatEffects } from "./settings.svelte";
