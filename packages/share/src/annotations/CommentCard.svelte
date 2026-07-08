<script lang="ts">
/**
 * CommentCard.svelte — Shared presentational comment card. Used by the desktop
 * editor (via Comment.svelte adapter) and the web preview.
 *
 * Editing affordances (delete, expand-to-modal, jump-to-text, reply, AI) render
 * only when their callbacks are provided. The read-only web preview passes a
 * bare thread and gets a pure display; the editor passes the full wiring.
 */
import { Maximize2, Trash2 } from "lucide-svelte";
import type { Thread as ThreadType } from "../core/models";
import { type Persona } from "./avatar";
import Thread from "./Thread.svelte";

let {
    selectedText = "",
    thread,
    isActive = false,
    personas = [],
    onDelete,
    onExpand,
    onJumpTo,
    onUpdateThread,
    replyValue = "",
    onReplyInput,
    onSend,
    onEscape,
    onAiSuggest,
}: {
    selectedText?: string;
    thread: ThreadType;
    isActive?: boolean;
    personas?: Persona[];
    onDelete?: () => void;
    onExpand?: () => void;
    onJumpTo?: () => void;
    onUpdateThread?: (thread: ThreadType) => void;
    replyValue?: string;
    onReplyInput?: (value: string) => void;
    onSend?: () => void;
    onEscape?: () => void;
    onAiSuggest?: () => void;
} = $props();
</script>

<div
    class="transition-all duration-200
        {isActive ? 'shadow-xl rounded-[14px]' : 'shadow-lg rounded-[12px] opacity-90 hover:opacity-100'}"
>
  <div
      class="border overflow-hidden
          {isActive
              ? 'bg-blue-50/90 border-blue-200/60 rounded-[14px]'
              : 'bg-blue-50/60 border-blue-200/40 rounded-[12px]'}"
      style="backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-3 pt-3 pb-0">
        <h3 class="text-[10px] font-semibold text-blue-600/70 uppercase tracking-wider">Comment</h3>
        <div class="flex items-center gap-0.5">
            {#if onExpand}
                <button
                    class="p-1 rounded-md text-blue-400/50 hover:text-blue-600/70 hover:bg-white/40 transition-colors"
                    onclick={onExpand}
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
    </div>

    <!-- Quoted text chip -->
    {#if selectedText}
        <div class="px-3 pt-3 pb-0">
            {#if onJumpTo}
                <button
                    class="w-full text-left text-xs text-black/50 border-l-2 border-yellow-400/80 pl-2 truncate italic hover:text-black/70 hover:border-yellow-500/80 transition-colors cursor-pointer"
                    onclick={onJumpTo}
                    title="Jump to this comment in the document"
                >
                    {selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}
                </button>
            {:else}
                <p class="w-full text-left text-xs text-black/50 border-l-2 border-yellow-400/80 pl-2 truncate italic">
                    {selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}
                </p>
            {/if}
        </div>
    {/if}

    <!-- Thread -->
    <div class="px-3 pt-3 pb-3">
        <Thread
            {thread}
            {personas}
            previewOnly={!isActive}
            {onUpdateThread}
            {replyValue}
            {onReplyInput}
            {onSend}
            {onEscape}
            {onAiSuggest}
            accentClass="text-blue-600/80 hover:text-blue-700"
        />
    </div>
  </div>
</div>
