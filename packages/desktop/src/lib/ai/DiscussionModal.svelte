<script lang="ts">
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import type { Snippet } from "svelte";
import { X } from "lucide-svelte";
let {
    title,
    draft,
    error,
    returnFocus,
    onclose,
    children,
}: {
    title: string;
    draft?: string;
    error?: string | null;
    returnFocus?: HTMLElement;
    onclose: () => void;
    children: Snippet;
} = $props();
let restoreSize = $state<(() => void) | undefined>();
function show(node: HTMLDialogElement) {
    const previous = returnFocus ?? document.activeElement;
    const fallback =
        previous instanceof HTMLElement
            ? previous
                  .closest("[data-panel-id]")
                  ?.querySelector<HTMLElement>("[data-history-trigger]")
            : null;
    node.showModal();
    return {
        destroy() {
            node.close();
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
            else fallback?.focus();
        },
    };
}
</script>
<dialog aria-label={title} use:show onclose={onclose} class="discussion-modal rounded-2xl bg-gray-100 shadow-xl">
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 px-5 py-4">
        <div class="min-w-0"><h2 class="truncate text-sm font-semibold" title={title}>{title}</h2>{#if draft}<p class="mt-1 text-xs text-black/60">{draft}</p>{/if}</div>
        <div class="flex shrink-0 items-center gap-1">
            <RestoreSizeButton {restoreSize} />
            <button class="shrink-0 rounded-full p-2 text-black/50 hover:bg-black/5 hover:text-black/80" aria-label="Close discussion" title="Close discussion" onclick={onclose}><X size={16} /></button>
        </div>
    </div>
    {#if error}<p role="alert" class="shrink-0 px-5 py-2 text-sm text-red-700">{error}</p>{/if}
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">{@render children()}</div>
    <ModalResizeHandles bind:restoreSize />
</dialog>
<style>
.discussion-modal { margin: auto; position: fixed; inset: 0; width: min(760px, calc(100vw - 32px)); height: min(760px, calc(100dvh - 48px)); max-height: calc(100dvh - 48px); overflow: hidden; padding: 0; color: #27272a; }
.discussion-modal[open] { display: flex; flex-direction: column; }
.discussion-modal::backdrop { background: rgb(0 0 0 / 25%); backdrop-filter: blur(3px); }
</style>
