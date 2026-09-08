<!-- ConversationMessageActions.svelte — Preserve an existing path before branching, editing, or retrying. -->
<script lang="ts">
import { GitBranch, Pencil, RotateCcw, Info } from "lucide-svelte";
import type { UIMessage } from "ai";
import type { createAiChat } from "./chatFactory";
let {
    message,
    conversations,
    disabled = false,
}: {
    message: UIMessage;
    conversations: NonNullable<ReturnType<typeof createAiChat>["conversations"]>;
    disabled?: boolean;
} = $props();
let editing = $state(false);
let showContext = $state(false);
let text = $state("");
let error = $state("");
const provenance = $derived(
    (
        message.metadata as
            | {
                  writingContext?: {
                      draftId?: string;
                      capturedAt?: number;
                      provider?: string;
                      model?: string;
                      draftText?: string;
                      selectedText?: string;
                  };
              }
            | undefined
    )?.writingContext,
);
async function act(action: () => Promise<unknown>) {
    error = "";
    try {
        await action();
        editing = false;
    } catch (cause) {
        error = String(cause);
    }
}
</script>
<div class="text-xs text-black/60 space-y-1" data-message-id={message.id}>
    <div class="flex gap-1 justify-end">
        <button class="message-action" aria-label="Branch here" title="Branch here" {disabled} onclick={() => act(() => conversations.branch(message.id))}><GitBranch size={14} aria-hidden="true" /></button>
        {#if message.role === "user"}
            <button class="message-action" aria-label="Edit as new path" title="Edit as new path" disabled={disabled || !conversations.canSend} onclick={() => { text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"); editing = true; }}><Pencil size={14} aria-hidden="true" /></button>
        {:else if message.role === "assistant"}
            <button class="message-action" aria-label="Retry as new path" title="Retry as new path" disabled={disabled || !conversations.canSend} onclick={() => act(() => conversations.retry(message.id))}><RotateCcw size={14} aria-hidden="true" /></button>
        {/if}
        {#if provenance}
            <button class="message-action" aria-label="Context at this turn" title="Context at this turn" aria-expanded={showContext} onclick={() => showContext = !showContext}><Info size={14} aria-hidden="true" /></button>
        {/if}
    </div>
    {#if provenance && showContext}
        <div class="rounded-lg bg-white/30 p-2 space-y-1">
            <p>Draft {provenance.draftId} · {provenance.capturedAt ? new Date(provenance.capturedAt).toLocaleString() : "Time unavailable"}</p>
            <p>{provenance.provider} · {provenance.model}</p>
            {#if provenance.selectedText}<p class="whitespace-pre-wrap">Selection: {provenance.selectedText}</p>{/if}
            {#if provenance.draftText}
                <p>Saved draft excerpt (up to 2,000 characters):</p>
                <pre class="whitespace-pre-wrap font-sans max-h-40 overflow-y-auto">{provenance.draftText}</pre>
            {/if}
        </div>
    {/if}
    {#if editing}
        <form class="space-y-2" onsubmit={(event) => { event.preventDefault(); void act(() => conversations.edit(message.id, text)); }}>
            <textarea aria-label="Edited prompt" bind:value={text} class="w-full rounded border border-black/20 bg-white p-2" rows="3" required></textarea>
            <button type="submit" disabled={!text.trim()} class="mr-3">Send as new path</button>
            <button type="button" onclick={() => editing = false}>Cancel</button>
        </form>
    {/if}
    {#if error}<p role="alert" class="text-red-700">{error}</p>{/if}
</div>

<style>
.message-action { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 9999px; color: rgb(0 0 0 / 55%); transition: background-color 150ms, color 150ms; }
.message-action:hover { background: rgb(255 255 255 / 50%); color: rgb(0 0 0 / 85%); }
.message-action:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
.message-action:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
