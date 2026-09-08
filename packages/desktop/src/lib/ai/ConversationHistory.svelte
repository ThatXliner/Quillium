<!-- ConversationHistory.svelte — Local conversation navigation and explicit lifecycle actions. -->
<script lang="ts">
import { currentDraftId } from "$lib/stores";
import type { createAiChat } from "./chatFactory";
import type { AiConversationMode } from "./persistence";
let {
    conversations,
    mode,
    disabled = false,
    onopen,
}: {
    conversations: NonNullable<ReturnType<typeof createAiChat>["conversations"]>;
    mode: AiConversationMode;
    disabled?: boolean;
    onopen?: (opener: HTMLElement) => void;
} = $props();
function showModal(node: HTMLDialogElement) {
    const previous = document.activeElement;
    node.showModal();
    return { destroy() { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); } };
}
let browsing = $state(false);
let historyButton: HTMLButtonElement;
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

async function act(action: () => Promise<unknown>) {
    actionError = "";
    try {
        await action();
    } catch (error) {
        actionError = String(error);
    }
}
</script>

<div data-conversation-history class="shrink-0 border-b border-black/10 p-3 space-y-2 text-xs">
    <div class="flex items-center justify-between gap-2">
        <span class="font-medium text-black/60">Discussions</span>
        <button class="rounded px-2 py-1 hover:bg-white/50" disabled={disabled || conversations.loading}
            onclick={() => act(() => conversations.newConversation())}>New chat</button>
    </div>
    {#if !browsing}
        <ul class="space-y-1" aria-label="Recent conversations">
            {#each conversations.items.filter(item => item.mode === mode && !item.archived).slice(0, 3) as item (item.id)}
                <li><button aria-current={item.id === conversations.current?.id ? "true" : undefined} title={item.title} class="w-full truncate rounded px-2 py-1.5 text-left hover:bg-white/50 aria-[current=true]:bg-white/30" disabled={disabled || conversations.loading}
                    onclick={(event) => { const opener = event.currentTarget; void act(async () => { await conversations.open(item.id); onopen?.(opener); }); }}>{item.title}</button></li>
            {/each}
        </ul>
    {/if}
    <button bind:this={historyButton} data-history-trigger class="rounded px-2 py-1 text-black/60 hover:bg-white/50" aria-expanded={browsing}
        onclick={() => { browsing = !browsing; if (browsing) void act(() => conversations.refresh()); }}>History</button>
    {#if !onopen && conversations.current}
        {#if conversations.current.archived}
            <p>Archived. Restore this discussion from History to continue.</p>
        {:else if conversations.current.draftId !== $currentDraftId}
            <p>Open the source draft to continue this discussion.</p>
        {/if}
        {#if conversations.current.sourceConversationId}
            <button class="underline" disabled={disabled || conversations.loading} onclick={() => act(() => conversations.open(conversations.current!.sourceConversationId!))}>Open origin conversation</button>
        {/if}
    {/if}
    {#if conversations.loading}<p role="status">Loading conversation…</p>{/if}
    {#if conversations.error || actionError}<p role="alert" class="text-red-700">{actionError || conversations.error}</p>{/if}
    {#if browsing}
        <dialog aria-label="Past discussions" use:showModal onclose={() => browsing = false} class="history-modal rounded-2xl bg-gray-100 p-6 shadow-xl">
        <div class="mb-5 flex items-center justify-between"><h2 class="text-base font-semibold">Past discussions</h2><button aria-label="Close history" onclick={() => browsing = false}>Close</button></div>
        {#if conversations.error || actionError}<p role="alert" class="text-red-700">{actionError || conversations.error}</p>{/if}
        <input aria-label="Search conversations" placeholder="Search titles and messages…" bind:value={search}
            class="w-full rounded border border-black/20 bg-white/70 px-2 py-1.5" />
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={archived} />Archived conversations</label>
        <p class="text-black/60">{mode === "chat" ? "Chat" : mode === "feedback" ? "Feedback" : "Revise"} conversations in this document</p>
        <ul class="max-h-[55dvh] overflow-y-auto space-y-2 mt-3" aria-label="Conversation history">
            {#each matches as item (item.id)}
                <li class="rounded bg-white/50 p-2 space-y-1" aria-current={item.id === conversations.current?.id ? "true" : undefined}>
                    <button class="text-left font-medium w-full break-words hover:underline" disabled={disabled || conversations.loading}
                        onclick={() => act(async () => { await conversations.open(item.id); browsing = false; onopen?.(historyButton); })}>{item.title}</button>
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
        </dialog>
    {/if}
</div>
<style>
.history-modal { margin: auto; position: fixed; inset: 0; width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 64px); color: #27272a; }
.history-modal::backdrop { background: rgb(0 0 0 / 25%); backdrop-filter: blur(3px); }
</style>
