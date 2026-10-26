/**
 * persistence.ts — Typed persistence helpers for AI conversations.
 *
 * Rust stores message arrays as opaque JSON. This module validates loaded
 * data against the AI SDK's UIMessage schema before it reaches a Chat.
 */
import {
    type PersistedAiConversationMode,
    clearAiConversation as clearStoredConversation,
    loadAiConversation as loadStoredConversation,
    saveAiConversation as saveStoredConversation,
} from "$lib/db";
import { type UIMessage, safeValidateUIMessages } from "ai";

export type AiConversationMode = PersistedAiConversationMode;

export function isPersistentConversationMode(mode: string): mode is AiConversationMode {
    return mode === "chat" || mode === "feedback" || mode === "revise";
}

export async function loadAiConversation(
    draftId: string,
    mode: AiConversationMode,
): Promise<UIMessage[]> {
    const messagesJson = await loadStoredConversation(draftId, mode);
    if (!messagesJson) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(messagesJson);
    } catch (error) {
        console.warn("[aiPersistence] ignored invalid conversation JSON", error);
        return [];
    }
    if (Array.isArray(parsed) && parsed.length === 0) return [];

    const result = await safeValidateUIMessages({ messages: parsed });
    if (result.success) return result.data;

    console.warn("[aiPersistence] ignored invalid conversation messages", result.error);
    return [];
}

export async function saveAiConversation(
    draftId: string,
    mode: AiConversationMode,
    messages: UIMessage[],
): Promise<void> {
    if (messages.length === 0) {
        await clearStoredConversation(draftId, mode);
        return;
    }
    await saveStoredConversation(draftId, mode, JSON.stringify(messages));
}

export async function clearAiConversation(
    draftId: string,
    mode: AiConversationMode,
): Promise<void> {
    await clearStoredConversation(draftId, mode);
}
