<script lang="ts">
import { XIcon } from "lucide-svelte";
import type { OutlineHeading } from "./documentOutline";

let { headings, cursor, onselect, onclose }: {
    headings: OutlineHeading[];
    cursor: number;
    onselect: (from: number) => void;
    onclose: () => void;
} = $props();
let active = $derived(headings.findLast((heading) => heading.from <= cursor)?.from);
</script>

<nav id="document-outline" aria-label="Document outline" data-annotation-occluder
    class="rounded-[14px] border border-white/30 bg-gray-300/70 p-4 shadow-lg backdrop-blur-md">
    <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="text-xs font-semibold text-black/60">Document outline</h2>
        <button type="button" aria-label="Hide document outline" onclick={onclose}
            class="rounded-full p-1.5 text-black/60 hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-blue-500">
            <XIcon size={14} />
        </button>
    </div>
    <div class="max-h-[60vh] overflow-y-auto">
        {#if headings.length === 0}
            <p class="text-xs leading-relaxed text-black/70">Add headings with the Format menu to see your document’s outline.</p>
        {:else}
            {#each headings as heading (heading.from)}
                <button type="button" onclick={() => onselect(heading.from)}
                    aria-current={active === heading.from ? "location" : undefined}
                    title={heading.label}
                    style:padding-left="{8 + (heading.level - 1) * 12}px"
                    class="block w-full rounded-lg py-2 pr-2 text-left text-xs break-words text-black/80 hover:bg-white/40 focus-visible:outline-2 focus-visible:outline-blue-500 {active === heading.from ? "bg-white/60 font-semibold" : ""}">
                    {heading.label}
                </button>
            {/each}
        {/if}
    </div>
</nav>
