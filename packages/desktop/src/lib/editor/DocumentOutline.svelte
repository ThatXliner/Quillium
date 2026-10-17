<script lang="ts">
import { ListTreeIcon, XIcon } from "lucide-svelte";
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
    class="w-full rounded-lg shadow-md">
    <div class="overflow-hidden rounded-lg bg-gray-100 px-1.5 py-2">
        <div class="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-black/35">
            <ListTreeIcon size={12} />
            <h2 class="flex-1">Outline</h2>
            <button type="button" aria-label="Hide document outline" onclick={onclose}
                class="rounded-full p-1 text-black/30 transition-colors hover:bg-black/5 hover:text-black/60 focus-visible:outline-2 focus-visible:outline-blue-500">
                <XIcon size={12} />
            </button>
        </div>
        <div class="max-h-[60vh] overflow-y-auto">
            {#if headings.length === 0}
                <p class="px-2 py-1.5 text-xs leading-relaxed text-black/50">Add headings with the Format menu to see your document’s outline.</p>
            {:else}
                {#each headings as heading (heading.from)}
                    <button type="button" onclick={() => onselect(heading.from)}
                        aria-current={active === heading.from ? "location" : undefined}
                        title={heading.label}
                        style:padding-left="{8 + (heading.level - 1) * 12}px"
                        class="block w-full rounded-md py-1.5 pr-2 text-left text-xs break-words transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 {active === heading.from ? "bg-white font-medium text-black/80 shadow-sm" : "text-black/50 hover:bg-white/50 hover:text-black/70"}">
                        {heading.label}
                    </button>
                {/each}
            {/if}
        </div>
    </div>
</nav>
