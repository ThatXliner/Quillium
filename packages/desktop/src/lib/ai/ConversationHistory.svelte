<!-- ConversationHistory.svelte — Document-wide discussion search and lifecycle actions. -->
<script lang="ts">
import { currentDraftId } from "$lib/stores";
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import { History, MoreHorizontal, Plus, Search, X } from "lucide-svelte";
import type { createAiChat } from "./chatFactory";
let { conversations, disabled = false, onopen }: {
    conversations: NonNullable<ReturnType<typeof createAiChat>["conversations"]>;
    disabled?: boolean;
    onopen?: () => void;
} = $props();
let browsing = $state(false);
let restoreSize = $state<(() => void) | undefined>();
let search = $state("");
let archived = $state(false);
let currentDraftOnly = $state(false);
let renameId = $state<string | null>(null);
let title = $state("");
let deleteId = $state<string | null>(null);
let actionError = $state("");
const busy = $derived(disabled || conversations.loading);
function showModal(node: HTMLDialogElement) {
    const previous = document.activeElement;
    node.showModal();
    return { destroy() { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); } };
}
function messageTexts(json: string): string[] {
    try {
        const messages = JSON.parse(json);
        if (!Array.isArray(messages)) return [];
        return messages.flatMap(message => Array.isArray(message?.parts) ? message.parts : [])
            .filter(part => part?.type === "text" && typeof part.text === "string")
            .map(part => part.text);
    } catch { return []; }
}
const indexed = $derived(conversations.items.map(item => ({ item, texts: messageTexts(item.messagesJson) })));
const matches = $derived(indexed.filter(({ item, texts }) =>
    item.archived === archived &&
    (!currentDraftOnly || item.draftId === $currentDraftId) &&
    `${item.title} ${texts.join(" ")}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()),
));
function activityDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toDateString() === new Date().toDateString()
        ? `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
async function act(action: () => Promise<unknown>) {
    actionError = "";
    try { await action(); } catch (error) { actionError = String(error); }
}
</script>

<div data-conversation-history class="shrink-0 border-b border-black/10 px-3 py-2 text-xs">
    <div class="flex items-center justify-between gap-2">
        <button data-history-trigger class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-black/70 hover:bg-white/60" aria-expanded={browsing} onclick={() => { browsing = true; void act(() => conversations.refresh()); }}><History size={14} />History</button>
        <button class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-black/70 hover:bg-white/60 disabled:opacity-40" disabled={busy} onclick={() => act(() => conversations.newConversation())}><Plus size={14} />New discussion</button>
    </div>
    {#if conversations.loading}<p role="status" class="px-2 py-1 text-black/60">Loading discussion…</p>{/if}
    {#if (conversations.error || actionError) && !browsing}<p role="alert" class="px-2 py-1 text-red-800">{actionError || conversations.error}</p>{/if}
</div>
{#if browsing}
    <dialog aria-label="Past discussions" use:showModal onclose={() => browsing = false} class="history-modal rounded-2xl border border-white/60 bg-gray-100 text-sm shadow-xl">
        <header class="shrink-0 space-y-4 border-b border-black/10 p-5">
            <div class="flex items-start justify-between gap-3">
                <div><h2 class="text-sm font-semibold text-black/85">Past discussions</h2><p class="mt-1 text-xs text-black/60">Every discussion in this document, together.</p></div>
                <div class="flex items-center gap-1"><RestoreSizeButton {restoreSize} /><button aria-label="Close history" class="rounded-full p-1.5 text-black/60 hover:bg-black/5" onclick={() => browsing = false}><X size={16} /></button></div>
            </div>
            <label class="flex items-center gap-2 rounded-lg border border-black/15 bg-white/80 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/50"><Search size={15} class="shrink-0 text-black/50" /><input aria-label="Search conversations" placeholder="Search discussions…" bind:value={search} class="min-w-0 w-full bg-transparent text-sm outline-none" /></label>
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div class="flex gap-1 rounded-lg bg-black/5 p-0.5" aria-label="Discussion status">
                    <button aria-pressed={!archived} class="rounded-md px-3 py-1.5 {archived ? 'text-black/60' : 'bg-white/90 text-black/85 shadow-sm'}" onclick={() => archived = false}>Active</button>
                    <button aria-pressed={archived} class="rounded-md px-3 py-1.5 {archived ? 'bg-white/90 text-black/85 shadow-sm' : 'text-black/60'}" onclick={() => archived = true}>Archived</button>
                </div>
                <label class="flex items-center gap-1.5 text-black/70"><input type="checkbox" bind:checked={currentDraftOnly} />Current draft only</label>
            </div>
            {#if conversations.error || actionError}<p role="alert" class="text-xs text-red-800">{actionError || conversations.error}</p>{/if}
        </header>
        <ul class="min-h-0 flex-1 space-y-1 overflow-y-auto p-3" aria-label="Conversation history">
            {#each matches as { item, texts } (item.id)}
                <li class="rounded-xl border border-transparent bg-white/40 p-3 aria-[current=true]:border-blue-200 aria-[current=true]:bg-white/80" aria-current={item.id === conversations.current?.id ? "true" : undefined}>
                    <div class="flex items-start gap-2">
                        <button aria-label={item.title} class="min-w-0 flex-1 text-left" disabled={busy} onclick={() => act(async () => { await conversations.open(item.id); browsing = false; onopen?.(); })}>
                            <span class="block break-words text-sm font-medium text-black/85">{item.title}</span>
                            <span class="mt-1 block truncate text-xs text-black/65">{texts.at(-1) || "No messages yet"}</span>
                            <span class="mt-2 block text-[11px] text-black/60">{item.draftLabel} · {activityDate(item.updatedAt)}</span>
                        </button>
                        <details class="relative shrink-0">
                            <summary aria-label={`Manage ${item.title}`} class="list-none cursor-pointer rounded-full p-1.5 text-black/60 hover:bg-black/5"><MoreHorizontal size={16} /></summary>
                            <div class="absolute right-0 top-full z-10 min-w-32 rounded-lg border border-black/10 bg-gray-100 p-1 shadow-lg">
                                <button class="block w-full rounded px-3 py-2 text-left text-xs hover:bg-white" disabled={busy} onclick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); renameId = item.id; deleteId = null; title = item.title; }}>Rename</button>
                                <button class="block w-full rounded px-3 py-2 text-left text-xs hover:bg-white" disabled={busy} onclick={() => act(() => conversations.archive(item.id, !item.archived))}>{item.archived ? "Restore" : "Archive"}</button>
                                <button class="block w-full rounded px-3 py-2 text-left text-xs text-red-800 hover:bg-red-50" disabled={busy} onclick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); deleteId = item.id; renameId = null; }}>Delete</button>
                            </div>
                        </details>
                    </div>
                    {#if renameId === item.id}
                        <form class="mt-3 flex flex-wrap gap-2 text-xs" onsubmit={(event) => { event.preventDefault(); void act(async () => { await conversations.rename(item.id, title); renameId = null; }); }}>
                            <input aria-label="Conversation title" class="min-w-0 flex-1 rounded border border-black/15 bg-white px-2 py-1.5" bind:value={title} maxlength="200" required />
                            <button type="submit" disabled={busy}>Save</button><button type="button" onclick={() => renameId = null}>Cancel</button>
                        </form>
                    {/if}
                    {#if deleteId === item.id}
                        <div class="mt-3 rounded-lg bg-red-50 p-3 text-xs"><p>Delete “{item.title}” permanently?</p><p class="mt-1 text-black/60">Your writing and other discussions will stay.</p><div class="mt-3 flex gap-4"><button class="font-medium text-red-800" disabled={busy} onclick={() => act(async () => { await conversations.remove(item.id); deleteId = null; })}>Delete permanently</button><button onclick={() => deleteId = null}>Cancel</button></div></div>
                    {/if}
                </li>
            {:else}
                <li class="px-4 py-10 text-center text-sm text-black/60">{search.trim() ? "No discussions match your search." : archived ? "No archived discussions." : "No discussions yet."}</li>
            {/each}
        </ul>
        <footer class="shrink-0 border-t border-black/10 px-5 py-3 text-xs text-black/60">{matches.length} {matches.length === 1 ? "discussion" : "discussions"}</footer>
        <ModalResizeHandles bind:restoreSize />
    </dialog>
{/if}
<style>
.history-modal { margin: auto; position: fixed; inset: 0; width: min(600px, calc(100vw - 32px)); height: min(580px, calc(100dvh - 64px)); max-height: calc(100dvh - 32px); overflow: hidden; color: #27272a; padding: 0; }
.history-modal[open] { display: flex; flex-direction: column; }
.history-modal::backdrop { background: rgb(0 0 0 / 25%); backdrop-filter: blur(3px); }
summary::-webkit-details-marker { display: none; }
</style>
