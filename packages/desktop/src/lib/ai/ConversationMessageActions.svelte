<!-- ConversationMessageActions.svelte — Preserve an existing path before branching, editing, or retrying. -->
<script lang="ts">
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
    <div class="flex gap-3 justify-end">
        <button class="hover:underline" {disabled} onclick={() => act(() => conversations.branch(message.id))}>Branch here</button>
        {#if message.role === "user"}
            <button class="hover:underline" disabled={disabled || !conversations.canSend} onclick={() => { text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"); editing = true; }}>Edit as new path</button>
        {:else if message.role === "assistant"}
            <button class="hover:underline" disabled={disabled || !conversations.canSend} onclick={() => act(() => conversations.retry(message.id))}>Retry as new path</button>
        {/if}
    </div>
    {#if provenance}
        <details><summary>Context at this turn</summary>
            <p>Draft {provenance.draftId} · {provenance.capturedAt ? new Date(provenance.capturedAt).toLocaleString() : "Time unavailable"}</p>
            <p>{provenance.provider} · {provenance.model}</p>
            {#if provenance.selectedText}<p class="whitespace-pre-wrap">Selection: {provenance.selectedText}</p>{/if}
            {#if provenance.draftText}
                <p>Saved draft excerpt (up to 2,000 characters):</p>
                <pre class="whitespace-pre-wrap font-sans max-h-40 overflow-y-auto">{provenance.draftText}</pre>
            {/if}
        </details>
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
