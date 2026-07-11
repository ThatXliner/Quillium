<script lang="ts">
import { Maximize2, Trash2 } from "lucide-svelte";
import type { Snippet } from "svelte";

let {
    annotationId,
    active,
    selectedText = "",
    onSelectText,
    onOpen,
    onDelete,
    thread,
}: {
    annotationId?: string | number;
    active: boolean;
    selectedText?: string;
    onSelectText?: () => void;
    onOpen?: () => void;
    onDelete?: () => void;
    thread: Snippet;
} = $props();
</script>

<!-- This is the desktop card shell. The outer layer owns the rounded shadow;
     the clipped inner layer owns the glass blur so WebKit keeps round corners. -->
<div
    data-annotation-card="comment"
    data-annotation-card-view="comment"
    data-annotation-id={annotationId}
    data-active={active}
    class="transition-all duration-200
        {active ? 'shadow-xl rounded-[14px]' : 'shadow-lg rounded-[12px] opacity-90 hover:opacity-100'}"
>
    <div
        class="border overflow-hidden
            {active
                ? 'bg-blue-50/90 border-blue-200/60 rounded-[14px]'
                : 'bg-blue-50/60 border-blue-200/40 rounded-[12px]'}"
        style="backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);"
    >
        <div class="flex items-center justify-between px-3 pt-3 pb-0">
            <h3 class="text-[10px] font-semibold text-blue-600/70 uppercase tracking-wider">
                Comment
            </h3>
            {#if onOpen || onDelete}
                <div class="flex items-center gap-0.5">
                    {#if onOpen}
                        <button
                            class="p-1 rounded-md text-blue-400/50 hover:text-blue-600/70 hover:bg-white/40 transition-colors"
                            onclick={onOpen}
                            title="Expand thread"
                            aria-label="Expand comment thread"
                        >
                            <Maximize2 size={14} />
                        </button>
                    {/if}
                    {#if onDelete}
                        <button
                            class="p-1 rounded-md text-blue-400/50 hover:text-red-500/60 hover:bg-white/40 transition-colors"
                            onclick={onDelete}
                            title="Delete comment"
                            aria-label="Delete comment"
                        >
                            <Trash2 size={16} />
                        </button>
                    {/if}
                </div>
            {/if}
        </div>

        {#if selectedText}
            <div class="px-3 pt-3 pb-0">
                <button
                    class="w-full text-left text-xs text-black/50 border-l-2 border-yellow-400/80 pl-2 truncate italic hover:text-black/70 hover:border-yellow-500/80 transition-colors cursor-pointer"
                    onclick={onSelectText}
                    disabled={!onSelectText}
                    title="Jump to this comment in the document"
                >
                    {selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}
                </button>
            </div>
        {/if}

        <div class="px-3 pt-3 pb-3">
            {@render thread()}
        </div>
    </div>
</div>
