/**
 * conversationStore.ts — Typed access to document-scoped AI conversation history.
 *
 * Rust owns the SQLite rows and returns records in camelCase. Message JSON is
 * kept opaque here so callers can validate it with the AI SDK when restoring
 * a conversation and search the stored text locally when browsing history.
 */
import { invoke } from "@tauri-apps/api/core";

export type ConversationMode = "chat" | "feedback" | "revise";

export type Conversation = {
    id: string;
    documentId: string;
    draftId: string;
    draftLabel: string;
    mode: ConversationMode;
    title: string;
    createdAt: number;
    updatedAt: number;
    archived: boolean;
    messagesJson: string;
    sourceConversationId: string | null;
    sourceMessageId: string | null;
};

export type CreateConversationInput = {
    id: string;
    documentId: string;
    draftId: string;
    mode: ConversationMode;
    title: string;
    messagesJson: string;
    sourceConversationId?: string;
    sourceMessageId?: string;
};

export async function listConversations(documentId: string): Promise<Conversation[]> {
    return invoke<Conversation[]>("cmd_list_ai_conversations", { documentId });
}

export async function getConversation(id: string): Promise<Conversation | null> {
    return invoke<Conversation | null>("cmd_get_ai_conversation", { id });
}

export async function createConversation(input: CreateConversationInput): Promise<Conversation> {
    return invoke<Conversation>("cmd_create_ai_conversation", input);
}

export async function saveConversationMessages(id: string, messagesJson: string): Promise<void> {
    return invoke<void>("cmd_save_ai_conversation_messages", { id, messagesJson });
}

export async function renameConversation(id: string, title: string): Promise<void> {
    return invoke<void>("cmd_rename_ai_conversation", { id, title });
}

export async function archiveConversation(id: string, archived: boolean): Promise<void> {
    return invoke<void>("cmd_archive_ai_conversation", { id, archived });
}

export async function deleteConversation(id: string): Promise<void> {
    return invoke<void>("cmd_delete_ai_conversation", { id });
}
