<script lang="ts">
import { ListTreeIcon } from "lucide-svelte";
import NavigationPanel from "./NavigationPanel.svelte";
import type { OutlineHeading } from "./documentOutline";

let { headings, cursor, onselect, expanded, ontoggle }: {
    headings: OutlineHeading[];
    cursor: number;
    onselect: (from: number) => void;
    expanded: boolean;
    ontoggle: () => void;
} = $props();
let active = $derived(headings.findLast((heading) => heading.from <= cursor)?.from);
</script>

<nav id="document-outline" aria-label="Document outline" data-annotation-occluder
    class="w-full">
    <NavigationPanel label="Outline" {expanded} {ontoggle}>
        {#snippet icon()}<ListTreeIcon size={12} />{/snippet}
        <div class="max-h-[60vh] overflow-y-auto">
            {#if headings.length === 0}
                <p class="px-2 py-1.5 text-xs leading-relaxed text-black/50">Add headings with the Format menu to see your document’s outline.</p>
            {:else}
                {#each headings as heading (heading.from)}
                    <button type="button" onclick={() => onselect(heading.from)}
                        aria-current={active === heading.from ? "location" : undefined}
                        title={heading.label}
                        style:padding-left="{13 + (heading.level - 1) * 16}px"
                        class="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 {active === heading.from ? "bg-white font-medium text-black/80 shadow-sm" : "text-black/50 hover:bg-white/50 hover:text-black/70"}">
                        <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full {active === heading.from ? 'bg-amber-500' : 'bg-black/20'}"></span>
                        <span class="min-w-0 truncate">{heading.label}</span>
                    </button>
                {/each}
            {/if}
        </div>
    </NavigationPanel>
</nav>
