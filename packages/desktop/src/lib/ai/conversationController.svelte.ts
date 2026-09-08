import { currentDocumentId, currentDraftId, currentTabId, documentContent } from "$lib/stores";
import type { Chat } from "@ai-sdk/svelte";
import { type ChatRequestOptions, type UIMessage, safeValidateUIMessages } from "ai";
import { untrack } from "svelte";
import { derived, get } from "svelte/store";

/**
 * conversationController.svelte.ts — Owns durable AI conversation identity.
 *
 * The AI SDK Chat remains the streaming state machine. This controller keeps
 * that state attached to one persisted conversation, serializes writes, and
 * makes document/draft changes wait for the request that started on the old
 * target before replacing the visible messages.
 */
import {
    archiveConversation,
    createConversation,
    deleteConversation,
    getConversation,
    listConversations,
    renameConversation,
    saveConversationMessages,
} from "./conversationStore";
import type { Conversation } from "./conversationStore";
import type { EditorialTurn } from "./editorialPolicy";

export type PersistentConversationMode = "chat" | "feedback" | "revise";

type Scope = {
    documentId: string | null;
    draftId: string | null;
};

type ConversationChat = {
    messages: UIMessage[];
    status: Chat<UIMessage>["status"];
    error: Chat<UIMessage>["error"];
    sendMessage: Chat<UIMessage>["sendMessage"];
    regenerate?: Chat<UIMessage>["regenerate"];
    stop: Chat<UIMessage>["stop"];
    generateId?: Chat<UIMessage>["generateId"];
    clearError?: Chat<UIMessage>["clearError"];
};

type ConversationControllerOptions = {
    chat: ConversationChat;
    mode: PersistentConversationMode;
    beforeReplace?: () => void;
    requestSettings?: () => { provider: string; model: string };
};

type ConversationState = {
    current: Conversation | null;
    items: Conversation[];
    loading: boolean;
    error: string | null;
    busy: boolean;
    invalid: boolean;
};

export type ConversationController = ReturnType<typeof createConversationController>;

const NEW_CONVERSATION_TITLE = "New chat";
const MAX_DRAFT_EXCERPT = 2_000;

class ConversationDurabilityError extends Error {
    constructor(cause: unknown) {
        super(`Could not save the conversation. ${errorMessage(cause)}`);
        this.name = "ConversationDurabilityError";
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function newId(chat: ConversationChat): string {
    const generated = chat.generateId?.();
    if (generated) return generated;
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeConversation(conversation: Conversation): Conversation {
    return {
        ...conversation,
        sourceConversationId: conversation.sourceConversationId ?? null,
        sourceMessageId: conversation.sourceMessageId ?? null,
    };
}

function normalizeTitle(title: string): string {
    const normalized = title.trim().replace(/\s+/g, " ");
    if (!normalized) throw new Error("Conversation title cannot be empty.");
    return normalized.slice(0, 200);
}

function titleForMessage(text: string): string {
    const title = text.trim().replace(/\s+/g, " ");
    return (title || NEW_CONVERSATION_TITLE).slice(0, 80);
}

function scopeNow(): Scope {
    return {
        documentId: get(currentDocumentId),
        draftId: get(currentDraftId),
    };
}

function sameScope(left: Scope, right: Scope): boolean {
    return left.documentId === right.documentId && left.draftId === right.draftId;
}

function hasActiveScope(scope: Scope): scope is { documentId: string; draftId: string } {
    return !!scope.documentId && !!scope.draftId;
}

function isChatBusy(chat: ConversationChat): boolean {
    return chat.status === "submitted" || chat.status === "streaming";
}

function serializeMessages(messages: UIMessage[]): string {
    return JSON.stringify(clone(messages));
}

async function parseMessages(messagesJson: string): Promise<UIMessage[]> {
    if (!messagesJson.trim()) throw new Error("This conversation has invalid message data.");

    let parsed: unknown;
    try {
        parsed = JSON.parse(messagesJson);
    } catch (error) {
        console.warn("[conversationController] ignored invalid conversation JSON", error);
        throw new Error("This conversation has invalid message data.");
    }
    if (!Array.isArray(parsed)) throw new Error("This conversation has invalid message data.");
    if (parsed.length === 0) return [];

    const result = await safeValidateUIMessages({ messages: parsed });
    if (!result.success) {
        console.warn(
            "[conversationController] ignored invalid conversation messages",
            result.error,
        );
        throw new Error("This conversation has invalid message data.");
    }
    return clone(result.data);
}

function isToolPart(part: UIMessage["parts"][number]): boolean {
    return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

/**
 * Remove historical tool invocations from a request while retaining them in
 * the persisted/displayed path. A loaded unfinished tool call is presentation
 * history; sending it back to the provider could make the provider execute it
 * again or reject the whole context.
 */
export function sanitizeOutboundMessages(messages: UIMessage[]): UIMessage[] {
    return clone(messages)
        .map((message) => ({
            ...message,
            parts: message.parts.filter((part) => !isToolPart(part)),
        }))
        .filter((message) => message.parts.length > 0);
}

function writingContextMetadata(
    scope: { documentId: string; draftId: string },
    text: string,
    provider: string,
    model: string,
): Record<string, unknown> {
    const capturedAt = Date.now();
    const draftText = get(documentContent);
    return {
        writingContext: {
            documentId: scope.documentId,
            tabId: get(currentTabId),
            draftId: scope.draftId,
            capturedAt,
            timestamp: capturedAt,
            provider,
            model,
            draftText: draftText.slice(0, MAX_DRAFT_EXCERPT),
            promptExcerpt: text.trim().slice(0, 500),
        },
    };
}

function mergeMetadata(
    metadata: unknown,
    writingContext: Record<string, unknown>,
): Record<string, unknown> {
    const existing =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>)
            : {};
    return { ...existing, ...writingContext };
}

function textFromMessage(message: UIMessage | undefined): string {
    if (!message) return "";
    return message.parts
        .filter(
            (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
                part.type === "text",
        )
        .map((part) => part.text)
        .join("\n");
}

/**
 * Create the persistent controller around an existing AI SDK Chat instance.
 * The controller is intentionally independent of Svelte components; callers
 * start its store subscription from a component effect and dispose it there.
 */
export function createConversationController({
    chat,
    mode,
    beforeReplace,
    requestSettings,
}: ConversationControllerOptions) {
    const state = $state<ConversationState>({
        current: null,
        items: [],
        loading: false,
        error: null,
        busy: false,
        invalid: false,
    });

    let disposed = false;
    let generation = 0;
    let unsubscribeScope: (() => void) | null = null;
    const activeSends = new Set<Promise<void>>();
    const pendingSaves = new Set<Promise<void>>();
    const saveChains = new Map<string, Promise<void>>();
    const dirtySaves = new Map<string, string>();

    function setError(error: unknown): void {
        state.error = errorMessage(error);
    }

    function clearError(): void {
        state.error = null;
    }

    function upsertItem(conversation: Conversation): void {
        const normalized = normalizeConversation(conversation);
        const next = state.items.filter((item) => item.id !== normalized.id);
        next.push(normalized);
        next.sort((left, right) => right.updatedAt - left.updatedAt);
        state.items = next;
    }

    function removeItem(id: string): void {
        state.items = state.items.filter((item) => item.id !== id);
    }

    function updateLocalMessages(id: string, messagesJson: string): void {
        const updatedAt = Date.now();
        state.items = state.items.map((item) =>
            item.id === id ? { ...item, messagesJson, updatedAt } : item,
        );
        if (state.current?.id === id) {
            state.current = { ...state.current, messagesJson, updatedAt };
        }
    }

    function queueSave(id: string, messagesJson: string): Promise<void> {
        dirtySaves.set(id, messagesJson);
        const previous = saveChains.get(id) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(() => saveConversationMessages(id, messagesJson));
        saveChains.set(id, next);
        pendingSaves.add(next);

        const cleanup = next
            .then(
                () => {
                    if (dirtySaves.get(id) !== messagesJson) return;
                    dirtySaves.delete(id);
                    updateLocalMessages(id, messagesJson);
                },
                () => undefined,
            )
            .finally(() => {
                pendingSaves.delete(next);
                if (saveChains.get(id) === next) saveChains.delete(id);
            });
        void cleanup.catch(() => undefined);
        return next;
    }

    async function retryDirtySaves(): Promise<void> {
        for (const [id, messagesJson] of [...dirtySaves]) {
            if (dirtySaves.get(id) !== messagesJson) continue;
            try {
                await saveConversationMessages(id, messagesJson);
            } catch (error) {
                throw new ConversationDurabilityError(error);
            }
            if (dirtySaves.get(id) === messagesJson) {
                dirtySaves.delete(id);
                updateLocalMessages(id, messagesJson);
            }
        }
    }

    async function waitForActiveWork(): Promise<void> {
        // A send's promise includes its final save. The second set covers a
        // save that was queued by a just-settled operation in the same tick.
        while (true) {
            while (activeSends.size > 0 || pendingSaves.size > 0) {
                await Promise.allSettled([...activeSends, ...pendingSaves]);
            }
            if (dirtySaves.size === 0) return;
            await retryDirtySaves();
        }
    }

    function beforeMessageReplacement(): void {
        // This callback must run before stop() so an already buffered tool
        // chunk cannot target the newly selected document/draft.
        beforeReplace?.();
        try {
            void chat.stop();
        } catch (error) {
            setError(error);
        }
    }

    function beginReplacement(): number {
        generation += 1;
        state.loading = true;
        clearError();
        beforeMessageReplacement();
        return generation;
    }

    function tokenIsCurrent(token: number): boolean {
        return !disposed && token === generation;
    }

    function conversationInDocument(id: string): Conversation | null {
        const item = state.items.find((candidate) => candidate.id === id);
        return item ? normalizeConversation(item) : null;
    }

    async function resolveConversation(id: string): Promise<Conversation> {
        const known = conversationInDocument(id);
        const conversation = known ?? (await getConversation(id));
        if (!conversation) throw new Error("Conversation not found.");
        const normalized = normalizeConversation(conversation);
        const documentId = get(currentDocumentId);
        if (normalized.documentId !== documentId) {
            throw new Error("Conversation belongs to another document.");
        }
        if (normalized.mode !== mode) {
            throw new Error("Conversation belongs to another AI mode.");
        }
        return normalized;
    }

    function sourceMatchesActive(conversation: Conversation, scope = scopeNow()): boolean {
        return (
            hasActiveScope(scope) &&
            conversation.documentId === scope.documentId &&
            conversation.draftId === scope.draftId
        );
    }

    function canSendNow(): boolean {
        const scope = scopeNow();
        if (
            disposed ||
            state.loading ||
            state.busy ||
            dirtySaves.size > 0 ||
            state.invalid ||
            isChatBusy(chat) ||
            !hasActiveScope(scope)
        ) {
            return false;
        }
        if (!state.current) return true;
        return !state.current.archived && sourceMatchesActive(state.current, scope);
    }

    function applyConversation(
        conversation: Conversation | null,
        messages: UIMessage[],
        invalid = false,
    ): void {
        state.current = conversation ? normalizeConversation(conversation) : null;
        state.invalid = invalid;
        chat.messages = clone(messages);
        chat.clearError?.();
    }

    async function loadScope(scope: Scope, token: number): Promise<void> {
        let candidate: Conversation | null = null;
        try {
            await waitForActiveWork();
            if (!tokenIsCurrent(token) || !sameScope(scope, scopeNow())) return;

            if (!hasActiveScope(scope)) {
                applyConversation(null, []);
                state.items = [];
                return;
            }

            const items = (await listConversations(scope.documentId)).map(normalizeConversation);
            if (!tokenIsCurrent(token) || !sameScope(scope, scopeNow())) return;
            state.items = items.sort((left, right) => right.updatedAt - left.updatedAt);

            candidate = state.items
                .filter(
                    (item) =>
                        item.mode === mode && !item.archived && item.draftId === scope.draftId,
                )
                .sort((left, right) => right.updatedAt - left.updatedAt)[0];
            let messages: UIMessage[] = [];
            try {
                messages = candidate ? await parseMessages(candidate.messagesJson) : [];
            } catch (error) {
                if (!tokenIsCurrent(token) || !sameScope(scope, scopeNow())) return;
                applyConversation(candidate ?? null, [], true);
                throw error;
            }
            if (!tokenIsCurrent(token) || !sameScope(scope, scopeNow())) return;
            applyConversation(candidate ?? null, messages);
        } catch (error) {
            if (!tokenIsCurrent(token)) return;
            if (error instanceof ConversationDurabilityError) {
                setError(error);
                console.error("[conversationController] failed to save before loading", error);
                return;
            }
            if (candidate) applyConversation(candidate, [], true);
            else applyConversation(null, []);
            setError(error);
            console.error("[conversationController] failed to load conversations", error);
        } finally {
            if (tokenIsCurrent(token)) state.loading = false;
        }
    }

    async function refresh(): Promise<void> {
        const scope = scopeNow();
        const token = generation;
        if (!scope.documentId) {
            state.items = [];
            return;
        }
        state.loading = true;
        try {
            await waitForActiveWork();
            const items = (await listConversations(scope.documentId)).map(normalizeConversation);
            if (!tokenIsCurrent(token) || get(currentDocumentId) !== scope.documentId) return;
            state.items = items.sort((left, right) => right.updatedAt - left.updatedAt);
            const refreshedCurrent = state.current
                ? state.items.find((item) => item.id === state.current?.id)
                : undefined;
            if (refreshedCurrent) state.current = refreshedCurrent;
            clearError();
        } catch (error) {
            if (tokenIsCurrent(token)) {
                setError(error);
                console.error("[conversationController] failed to refresh conversations", error);
            }
            throw error;
        } finally {
            if (tokenIsCurrent(token)) state.loading = false;
        }
    }

    async function open(id: string): Promise<void> {
        if (state.current?.id === id && !state.busy && !isChatBusy(chat)) return;
        const token = beginReplacement();
        let conversation: Conversation | null = null;
        try {
            await waitForActiveWork();
            if (!tokenIsCurrent(token)) return;
            conversation = await resolveConversation(id);
            const messages = await parseMessages(conversation.messagesJson);
            if (!tokenIsCurrent(token) || get(currentDocumentId) !== conversation.documentId)
                return;
            upsertItem(conversation);
            applyConversation(conversation, messages);
        } catch (error) {
            if (tokenIsCurrent(token)) {
                if (conversation) applyConversation(conversation, [], true);
                setError(error);
            }
            throw error;
        } finally {
            if (tokenIsCurrent(token)) state.loading = false;
        }
    }

    async function createEmptyConversation(scope: {
        documentId: string;
        draftId: string;
    }): Promise<Conversation> {
        const created = await createConversation({
            id: newId(chat),
            documentId: scope.documentId,
            draftId: scope.draftId,
            mode,
            title: NEW_CONVERSATION_TITLE,
            messagesJson: "[]",
        });
        return normalizeConversation(created);
    }

    async function newConversation(): Promise<void> {
        const scope = scopeNow();
        if (!hasActiveScope(scope)) throw new Error("Open a draft before starting a conversation.");
        const token = beginReplacement();
        try {
            await waitForActiveWork();
            if (!tokenIsCurrent(token) || !sameScope(scope, scopeNow())) return;
            const conversation = await createEmptyConversation(scope);
            if (!tokenIsCurrent(token) || !sameScope(scope, scopeNow())) return;
            upsertItem(conversation);
            applyConversation(conversation, []);
        } catch (error) {
            if (tokenIsCurrent(token)) setError(error);
            throw error;
        } finally {
            if (tokenIsCurrent(token)) state.loading = false;
        }
    }

    function assertConversationAction(id: string): Conversation {
        const conversation = state.current?.id === id ? state.current : conversationInDocument(id);
        if (!conversation) throw new Error("Conversation not found.");
        if (conversation.documentId !== get(currentDocumentId)) {
            throw new Error("Conversation belongs to another document.");
        }
        if (conversation.mode !== mode) throw new Error("Conversation belongs to another AI mode.");
        return conversation;
    }

    async function rename(id: string, title: string): Promise<void> {
        if (state.busy || isChatBusy(chat))
            throw new Error("Wait for the current response to finish.");
        const conversation = assertConversationAction(id);
        const nextTitle = normalizeTitle(title);
        const token = generation;
        state.loading = true;
        try {
            await renameConversation(id, nextTitle);
            if (!tokenIsCurrent(token)) return;
            const updated = { ...conversation, title: nextTitle, updatedAt: Date.now() };
            upsertItem(updated);
            if (state.current?.id === id) state.current = updated;
        } catch (error) {
            if (tokenIsCurrent(token)) setError(error);
            throw error;
        } finally {
            if (tokenIsCurrent(token)) state.loading = false;
        }
    }

    async function archive(id: string, archived: boolean): Promise<void> {
        if (state.busy || isChatBusy(chat))
            throw new Error("Wait for the current response to finish.");
        const conversation = assertConversationAction(id);
        const token = generation;
        state.loading = true;
        try {
            await archiveConversation(id, archived);
            if (!tokenIsCurrent(token)) return;
            const updated = { ...conversation, archived, updatedAt: Date.now() };
            upsertItem(updated);
            if (state.current?.id === id) state.current = updated;
        } catch (error) {
            if (tokenIsCurrent(token)) setError(error);
            throw error;
        } finally {
            if (tokenIsCurrent(token)) state.loading = false;
        }
    }

    async function remove(id: string): Promise<void> {
        if (state.busy || isChatBusy(chat))
            throw new Error("Wait for the current response to finish.");
        const conversation = assertConversationAction(id);
        const isCurrent = state.current?.id === id;
        const token = isCurrent ? beginReplacement() : generation;
        if (!isCurrent) state.loading = true;
        try {
            await waitForActiveWork();
            if (!tokenIsCurrent(token)) return;
            await deleteConversation(id);
            removeItem(id);
            if (isCurrent) applyConversation(null, []);
        } catch (error) {
            if (tokenIsCurrent(token)) setError(error);
            throw error;
        } finally {
            if (tokenIsCurrent(token)) state.loading = false;
        }
    }

    async function createDerivedConversation(
        source: Conversation,
        messages: UIMessage[],
        sourceMessageId: string,
        titleSuffix: string,
    ): Promise<Conversation | null> {
        const scope = scopeNow();
        if (source.documentId !== scope.documentId) {
            throw new Error("Conversation belongs to another document.");
        }
        if (state.busy || isChatBusy(chat))
            throw new Error("Wait for the current response to finish.");
        const token = beginReplacement();
        try {
            await waitForActiveWork();
            if (!tokenIsCurrent(token)) return null;
            const created = normalizeConversation(
                await createConversation({
                    id: newId(chat),
                    documentId: source.documentId,
                    draftId: source.draftId,
                    mode,
                    title: `${source.title} ${titleSuffix}`.slice(0, 200),
                    messagesJson: serializeMessages(messages),
                    sourceConversationId: source.id,
                    sourceMessageId,
                }),
            );
            if (!tokenIsCurrent(token)) return null;
            upsertItem(created);
            applyConversation(created, messages);
            return created;
        } catch (error) {
            if (tokenIsCurrent(token)) setError(error);
            throw error;
        } finally {
            if (tokenIsCurrent(token)) state.loading = false;
        }
    }

    async function branch(messageId: string): Promise<void> {
        const source = state.current;
        if (!source) throw new Error("Open a conversation before branching.");
        if (!canSendNow()) throw new Error("This conversation is read-only or still loading.");
        const index = chat.messages.findIndex((message) => message.id === messageId);
        if (index < 0) throw new Error("Message not found.");
        await createDerivedConversation(
            source,
            chat.messages.slice(0, index + 1),
            messageId,
            "(branch)",
        );
    }

    async function runSend(text: string, turn?: EditorialTurn): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed) throw new Error("Message cannot be empty.");
        const originScope = scopeNow();
        if (!hasActiveScope(originScope)) throw new Error("Open a draft before sending a message.");
        if (!canSendNow()) throw new Error("This conversation is read-only or still loading.");

        const originGeneration = generation;
        const beforeMessages = clone(chat.messages);
        const originId = state.current?.id ?? newId(chat);
        const provider = requestSettings?.() ?? { provider: "unknown", model: "unknown" };
        const metadata = mergeMetadata(
            undefined,
            writingContextMetadata(originScope, trimmed, provider.provider, provider.model),
        );
        let persistedPrompt = false;
        let providerStarted = false;
        let operationError: unknown;
        state.busy = true;
        clearError();

        try {
            if (!state.current) {
                const created = normalizeConversation(
                    await createConversation({
                        id: originId,
                        documentId: originScope.documentId,
                        draftId: originScope.draftId,
                        mode,
                        title: titleForMessage(trimmed),
                        messagesJson: "[]",
                    }),
                );
                if (!tokenIsCurrent(originGeneration) || !sameScope(originScope, scopeNow())) {
                    throw new Error("Writing target changed before sending.");
                }
                upsertItem(created);
                state.current = created;
            }

            if (
                !tokenIsCurrent(originGeneration) ||
                !state.current ||
                state.current.id !== originId ||
                !sourceMatchesActive(state.current, originScope)
            ) {
                throw new Error("This conversation belongs to another draft.");
            }

            if (beforeMessages.length === 0 && state.current.title === NEW_CONVERSATION_TITLE) {
                const title = titleForMessage(trimmed);
                await renameConversation(originId, title);
                if (
                    !tokenIsCurrent(originGeneration) ||
                    !sameScope(originScope, scopeNow()) ||
                    state.current?.id !== originId
                ) {
                    throw new Error("Writing target changed before sending.");
                }
                const renamed = {
                    ...state.current,
                    title,
                    updatedAt: Date.now(),
                };
                upsertItem(renamed);
                state.current = renamed;
            }

            const userMessage: UIMessage = {
                id: newId(chat),
                role: "user",
                parts: [{ type: "text", text: trimmed }],
                metadata,
            };
            chat.messages = [...chat.messages, userMessage];
            await queueSave(originId, serializeMessages(chat.messages));
            persistedPrompt = true;

            if (
                !tokenIsCurrent(originGeneration) ||
                !sameScope(originScope, scopeNow()) ||
                state.current?.id !== originId
            ) {
                throw new Error("Writing target changed before sending.");
            }

            providerStarted = true;
            const send = chat.sendMessage as unknown as (
                message: { text: string; messageId: string; metadata?: unknown },
                options?: ChatRequestOptions,
            ) => Promise<void>;
            await send(
                { text: trimmed, messageId: userMessage.id, metadata },
                {
                    body: {
                        ...(turn?.task ? { editorialTask: turn.task } : {}),
                        ...(turn?.exactWordCount === undefined
                            ? {}
                            : { exactWordCount: turn.exactWordCount }),
                    },
                },
            );
            if (chat.status === "error") throw chat.error ?? new Error("AI request failed.");
        } catch (error) {
            operationError = error;
        } finally {
            if (persistedPrompt || providerStarted) {
                try {
                    await queueSave(originId, serializeMessages(chat.messages));
                } catch (error) {
                    operationError ??= error;
                }
            }
            state.busy = false;
            if (operationError && sameScope(originScope, scopeNow())) setError(operationError);
        }

        if (operationError) throw operationError;
    }

    async function runRetry(): Promise<void> {
        const originScope = scopeNow();
        if (!hasActiveScope(originScope))
            throw new Error("Open a draft before retrying a response.");
        if (!canSendNow()) throw new Error("This conversation is read-only or still loading.");
        const originId = state.current?.id;
        if (!originId) throw new Error("Open a conversation before retrying a response.");
        const originGeneration = generation;
        let operationError: unknown;
        let providerStarted = false;
        state.busy = true;
        clearError();
        try {
            if (!tokenIsCurrent(originGeneration) || !sameScope(originScope, scopeNow())) {
                throw new Error("Writing target changed before retrying.");
            }
            if (typeof chat.regenerate !== "function") {
                throw new Error("This chat cannot regenerate a response.");
            }
            providerStarted = true;
            await chat.regenerate({});
            if (chat.status === "error") throw chat.error ?? new Error("AI request failed.");
        } catch (error) {
            operationError = error;
        } finally {
            if (providerStarted) {
                try {
                    await queueSave(originId, serializeMessages(chat.messages));
                } catch (error) {
                    operationError ??= error;
                }
            }
            state.busy = false;
            if (operationError && sameScope(originScope, scopeNow())) setError(operationError);
        }
        if (operationError) throw operationError;
    }

    async function edit(messageId: string, text: string): Promise<void> {
        const source = state.current;
        if (!source) throw new Error("Open a conversation before editing a message.");
        if (!canSendNow()) throw new Error("This conversation is read-only or still loading.");
        const index = chat.messages.findIndex((message) => message.id === messageId);
        if (index < 0 || chat.messages[index].role !== "user") {
            throw new Error("Only user messages can be edited.");
        }
        const created = await createDerivedConversation(
            source,
            chat.messages.slice(0, index),
            messageId,
            "(edit)",
        );
        if (!created) return;
        await trackSend(runSend(text));
    }

    async function retry(messageId: string): Promise<void> {
        const source = state.current;
        if (!source) throw new Error("Open a conversation before retrying a response.");
        if (!canSendNow()) throw new Error("This conversation is read-only or still loading.");
        const index = chat.messages.findIndex((message) => message.id === messageId);
        if (index < 0 || chat.messages[index].role !== "assistant") {
            throw new Error("Only assistant messages can be retried.");
        }
        const originScope = scopeNow();
        if (!hasActiveScope(originScope))
            throw new Error("Open a draft before retrying a response.");
        const prefix = clone(chat.messages.slice(0, index));
        if (prefix.at(-1)?.role !== "user")
            throw new Error("No user prompt precedes this response.");
        const retryPrompt = textFromMessage(prefix.at(-1));
        const retrySettings = requestSettings?.() ?? { provider: "unknown", model: "unknown" };
        const retryUser = prefix.at(-1);
        if (retryUser) {
            retryUser.metadata = mergeMetadata(
                retryUser.metadata,
                writingContextMetadata(
                    originScope,
                    retryPrompt,
                    retrySettings.provider,
                    retrySettings.model,
                ),
            );
        }
        const created = await createDerivedConversation(source, prefix, messageId, "(retry)");
        if (!created) return;
        await trackSend(runRetry());
    }

    function trackSend(promise: Promise<void>): Promise<void> {
        activeSends.add(promise);
        const cleanup = promise.finally(() => activeSends.delete(promise));
        void cleanup.catch(() => undefined);
        return promise;
    }

    function sendMessage(text: string, turn?: EditorialTurn): Promise<void> {
        return trackSend(runSend(text, turn));
    }

    function subscribe(): () => void {
        if (unsubscribeScope) return unsubscribeScope;
        const scope = derived([currentDocumentId, currentDraftId], ([$documentId, $draftId]) => ({
            documentId: $documentId,
            draftId: $draftId,
        }));
        const unsubscribe = scope.subscribe((nextScope) =>
            untrack(() => {
                const token = beginReplacement();
                void loadScope(nextScope, token);
            }),
        );
        unsubscribeScope = () => {
            unsubscribe();
            unsubscribeScope = null;
        };
        return unsubscribeScope;
    }

    async function dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        generation += 1;
        unsubscribeScope?.();
        unsubscribeScope = null;
        beforeMessageReplacement();
        await waitForActiveWork();
        state.loading = false;
    }

    const conversations = {
        get current(): Conversation | null {
            return state.current;
        },
        get items(): Conversation[] {
            return state.items;
        },
        get loading(): boolean {
            return state.loading;
        },
        get error(): string | null {
            return state.error;
        },
        get canSend(): boolean {
            return canSendNow();
        },
        refresh,
        open,
        newConversation,
        rename,
        archive,
        remove,
        branch,
        edit,
        retry,
        dispose,
    };

    return {
        conversations,
        refresh,
        open,
        newConversation,
        rename,
        archive,
        remove,
        branch,
        edit,
        retry,
        sendMessage,
        subscribe,
        dispose,
        reportError: setError,
    };
}
