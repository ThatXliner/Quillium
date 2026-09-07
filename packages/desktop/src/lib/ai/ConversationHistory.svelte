<!-- ConversationHistory.svelte — Local conversation navigation and explicit lifecycle actions. -->
<script lang="ts">
import { currentDraftId, currentDraftLabel } from "$lib/stores";
import { tick } from "svelte";
import type { createAiChat } from "./chatFactory";
import type { AiConversationMode } from "./persistence";
let {
    conversations,
    mode,
    disabled = false,
}: {
    conversations: NonNullable<ReturnType<typeof createAiChat>["conversations"]>;
    mode: AiConversationMode;
    disabled?: boolean;
} = $props();
let browsing = $state(false);
let search = $state("");
let archived = $state(false);
let renameId = $state<string | null>(null);
let title = $state("");
let deleteId = $state<string | null>(null);
let actionError = $state("");
const matches = $derived(
    conversations.items.filter(
        (item) =>
            item.mode === mode &&
            item.archived === archived &&
            `${item.title} ${messageText(item.messagesJson)}`
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
    ),
);
function messageText(json: string): string {
    try {
        const messages = JSON.parse(json);
        if (!Array.isArray(messages)) return "";
        return messages
            .flatMap((message) => (Array.isArray(message?.parts) ? message.parts : []))
            .filter((part) => part?.type === "text" && typeof part.text === "string")
            .map((part) => part.text)
            .join(" ");
    } catch {
        return "";
    }
}

async function openOrigin() {
    const source = conversations.current;
    if (!source?.sourceConversationId) return;
    await conversations.open(source.sourceConversationId);
    await tick();
    const message = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]")).find(
        (element) =>
            element.dataset.messageId === source.sourceMessageId && element.offsetParent !== null,
    );
    message?.scrollIntoView({ block: "center" });
}

async function act(action: () => Promise<unknown>) {
    actionError = "";
    try {
        await action();
    } catch (error) {
        actionError = String(error);
    }
}
</script>

<div data-conversation-history class="shrink-0 max-h-[55%] overflow-y-auto border-b border-black/10 p-3 space-y-2 text-xs">
    <div class="flex items-center justify-between gap-2">
        <button class="rounded px-2 py-1 hover:bg-white/50" aria-expanded={browsing}
            onclick={() => { browsing = !browsing; if (browsing) void act(() => conversations.refresh()); }}>
            History
        </button>
        <button class="rounded px-2 py-1 hover:bg-white/50" disabled={disabled || conversations.loading}
            onclick={() => act(() => conversations.newConversation())}>New chat</button>
    </div>
    {#if conversations.current}
        <p class="font-medium truncate" title={conversations.current.title}>{conversations.current.title}</p>
        <p class="text-black/60 break-words">
            Source draft: {conversations.current.draftLabel} · {conversations.current.draftId.slice(0, 8)}
        </p>
        {#if conversations.current.archived}
            <p>Archived. Restore this conversation to continue.</p>
        {:else if conversations.current.draftId !== $currentDraftId}
            <p>Open the source draft to continue. If it was deleted, this conversation remains available to read.</p>
        {:else}
            <p class="text-black/60">Next turn uses the source draft as it is now.</p>
        {/if}
        {#if conversations.current.sourceConversationId}
            <button class="underline" disabled={disabled || conversations.loading}
                onclick={() => act(openOrigin)}>
                Open origin conversation
            </button>
        {/if}
    {:else if $currentDraftId}
        <p class="text-black/60">Next turn uses {$currentDraftLabel || "this draft"} · {$currentDraftId.slice(0, 8)} as it is now.</p>
    {/if}
    {#if conversations.loading}<p role="status">Loading conversation…</p>{/if}
    {#if conversations.error || actionError}<p role="alert" class="text-red-700">{actionError || conversations.error}</p>{/if}
    {#if browsing}
        <input aria-label="Search conversations" placeholder="Search titles and messages…" bind:value={search}
            class="w-full rounded border border-black/20 bg-white/70 px-2 py-1.5" />
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={archived} />Archived conversations</label>
        <p class="text-black/60">{mode === "chat" ? "Chat" : mode === "feedback" ? "Feedback" : "Revise"} conversations in this document</p>
        <ul class="max-h-52 overflow-y-auto space-y-2" aria-label="Conversation history">
            {#each matches as item (item.id)}
                <li class="rounded bg-white/50 p-2 space-y-1" aria-current={item.id === conversations.current?.id ? "true" : undefined}>
                    <button class="text-left font-medium w-full break-words hover:underline" disabled={disabled || conversations.loading}
                        onclick={() => act(() => conversations.open(item.id))}>{item.title}</button>
                    <p class="text-black/60">{item.draftLabel} · {new Date(item.updatedAt).toLocaleDateString()}</p>
                    <div class="flex gap-3">
                        <button disabled={disabled || conversations.loading} onclick={() => { renameId = item.id; title = item.title; }}>Rename</button>
                        <button disabled={disabled || conversations.loading} onclick={() => act(() => conversations.archive(item.id, !item.archived))}>{item.archived ? "Restore" : "Archive"}</button>
                        <button disabled={disabled || conversations.loading} onclick={() => deleteId = item.id}>Delete</button>
                    </div>
                    {#if renameId === item.id}
                        <form class="flex gap-2" onsubmit={(event) => { event.preventDefault(); void act(async () => { await conversations.rename(item.id, title); renameId = null; }); }}>
                            <input aria-label="Conversation title" class="min-w-0 w-full rounded px-2 py-1" bind:value={title} maxlength="200" required />
                            <button type="submit" disabled={disabled || conversations.loading}>Save</button>
                            <button type="button" onclick={() => renameId = null}>Cancel</button>
                        </form>
                    {/if}
                    {#if deleteId === item.id}
                        <p>Permanently delete “{item.title}”?</p>
                        <div class="flex gap-3">
                            <button class="text-red-700" disabled={disabled || conversations.loading} onclick={() => act(async () => { await conversations.remove(item.id); deleteId = null; })}>Delete permanently</button>
                            <button onclick={() => deleteId = null}>Cancel</button>
                        </div>
                    {/if}
                </li>
            {:else}<li class="text-black/60">No conversations found.</li>{/each}
        </ul>
    {/if}
</div>
