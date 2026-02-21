<script lang="ts">
    import { SparklesIcon } from "lucide-svelte";
    import ThreadMessage from "./ThreadMessage.svelte";
    import type { Thread as ThreadType } from ".";

    let {
        thread,
        updateThread,
        // When true shows only the first message (collapsed comment card preview)
        previewOnly = false,
        // When provided, renders the AI suggest button in the reply footer
        onAiSuggest = undefined,
        // Accent colour class for the Send button and focus ring; defaults to blue
        accentClass = "text-blue-600/80 hover:text-blue-700",
    }: {
        thread: ThreadType;
        updateThread: (thread: ThreadType) => void;
        previewOnly?: boolean;
        onAiSuggest?: (() => void) | undefined;
        accentClass?: string;
    } = $props();

    let newMessage = $state("");
    let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined);

    function send() {
        if (!newMessage.trim()) return;
        updateThread([
            ...thread,
            { message: newMessage.trim(), author: "User", time: Date.now() },
        ]);
        newMessage = "";
    }
</script>

<!-- Messages -->
{#if thread.length > 0}
    <div class="space-y-3 {previewOnly ? '' : 'mb-0'}">
        {#each thread as message, i}
            {#if !previewOnly || i === 0}
                <ThreadMessage
                    {message}
                    index={i}
                    {updateThread}
                    {thread}
                    truncate={previewOnly && i === 0}
                />
            {/if}
        {/each}

        {#if previewOnly && thread.length > 1}
            <p class="text-[10px] text-black/40 pl-9">
                {thread.length - 1} more repl{thread.length === 2 ? "y" : "ies"}
            </p>
        {/if}
    </div>
{/if}

<!-- Reply input — hidden in previewOnly mode -->
{#if !previewOnly}
    <div class="mt-3 rounded-[10px] bg-white/40 inset-shadow-sm inset-shadow-white overflow-hidden">
        <textarea
            bind:this={textareaEl}
            bind:value={newMessage}
            placeholder="Reply…"
            rows="2"
            class="w-full text-xs bg-transparent px-3 pt-2.5 pb-1 resize-none focus:outline-none
                text-black/70 placeholder:text-black/30"
            onkeydown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    send();
                }
            }}
        ></textarea>
        <div class="flex items-center justify-between px-2 pb-1.5">
            <div class="flex items-center gap-1">
                {#if onAiSuggest}
                    <button
                        aria-label="Get AI suggestion"
                        title="Get AI suggestion"
                        class="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
                            text-black/35 hover:text-black/60 hover:bg-white/50 transition-colors"
                        onclick={onAiSuggest}
                    >
                        <SparklesIcon size={11} />
                        <span>Suggest</span>
                    </button>
                {/if}
            </div>
            <div class="flex items-center gap-2">
                {#if newMessage.trim()}
                    <button
                        onclick={send}
                        class="text-xs font-medium transition-colors {accentClass}"
                    >Send</button>
                {:else}
                    <span class="text-[10px] text-black/25">⌘↵ to send</span>
                {/if}
            </div>
        </div>
    </div>
{/if}
