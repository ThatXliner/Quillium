<script lang="ts">
import { cubicOut } from "svelte/easing";
import type { Snippet } from "svelte";
import { slide } from "svelte/transition";
import ThreadMessage from "./ThreadMessage.svelte";
import type { ThreadMessagePersonaView, ThreadMessageView } from "./types";

let {
    thread,
    previewOnly = false,
    getPersona,
    onEditMessage,
    messageRenderer,
}: {
    thread: ThreadMessageView[];
    previewOnly?: boolean;
    getPersona?: (message: ThreadMessageView) => ThreadMessagePersonaView | undefined;
    onEditMessage?: (index: number, message: string) => void;
    messageRenderer?: Snippet<[ThreadMessageView, number, boolean]>;
} = $props();
</script>

{#if thread.length > 0}
    <div class="space-y-3 {previewOnly ? '' : 'mb-0'}">
        {#each thread as message, index}
            {#if index === 0}
                {#if messageRenderer}
                    {@render messageRenderer(message, index, previewOnly)}
                {:else}
                    <ThreadMessage
                        {message}
                        truncate={previewOnly}
                        persona={getPersona?.(message)}
                        onEdit={onEditMessage
                            ? (value) => onEditMessage(index, value)
                            : undefined}
                    />
                {/if}
            {:else if !previewOnly}
                <div transition:slide={{ duration: 180, easing: cubicOut }}>
                    {#if messageRenderer}
                        {@render messageRenderer(message, index, false)}
                    {:else}
                        <ThreadMessage
                            {message}
                            persona={getPersona?.(message)}
                            onEdit={onEditMessage
                                ? (value) => onEditMessage(index, value)
                                : undefined}
                        />
                    {/if}
                </div>
            {/if}
        {/each}

        {#if previewOnly && thread.length > 1}
            <p
                transition:slide={{ duration: 180, easing: cubicOut }}
                class="pl-9 text-[10px] text-black/40"
            >
                {thread.length - 1} more repl{thread.length === 2 ? "y" : "ies"}
            </p>
        {/if}
    </div>
{/if}
