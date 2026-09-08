<script lang="ts">
/** RestoreSizeButton.svelte — The shared header control for custom panel and modal sizes. */
import { Minimize2 } from "lucide-svelte";

let {
    restoreSize,
    label = "Restore original size",
}: {
    restoreSize?: () => void;
    label?: string;
} = $props();
</script>

{#if restoreSize}
    <button
        type="button"
        onclick={restoreSize}
        aria-label={label}
        title={label}
        class="p-1.5 rounded-full text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-blue-500"
    ><Minimize2 size={14} /></button>
{/if}
