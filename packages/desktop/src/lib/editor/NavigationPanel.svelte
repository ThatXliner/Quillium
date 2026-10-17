<!-- NavigationPanel.svelte — Shared surface and disclosure for editor navigation. -->
<script lang="ts">
import { ChevronDownIcon, ChevronRightIcon } from "lucide-svelte";
import type { Snippet } from "svelte";

let { label, expanded = true, ontoggle, icon, children }: {
    label: string;
    expanded?: boolean;
    ontoggle?: () => void;
    icon: Snippet;
    children: Snippet;
} = $props();
const contentId = $props.id();
</script>

<div class="w-full rounded-lg bg-gray-100 px-1.5 py-2 shadow-md">
    <h2 class="text-[11px] font-semibold uppercase tracking-wide text-black/50">
        {#if ontoggle}
            <button type="button" onclick={ontoggle}
                aria-label="{expanded ? 'Collapse' : 'Expand'} {label.toLowerCase()}"
                aria-expanded={expanded} aria-controls={contentId}
                class="flex min-h-7 w-full items-center gap-1.5 rounded-md px-2 text-left uppercase hover:bg-black/5 hover:text-black/70 focus-visible:outline-2 focus-visible:outline-blue-500">
                {@render icon()}
                <span class="flex-1">{label}</span>
                {#if expanded}<ChevronDownIcon size={12} />{:else}<ChevronRightIcon size={12} />{/if}
            </button>
        {:else}
            <span class="flex min-h-7 items-center gap-1.5 px-2">
                {@render icon()}<span>{label}</span>
            </span>
        {/if}
    </h2>
    <div id={contentId} hidden={!expanded} class:mt-1={expanded}>
        {#if expanded}{@render children()}{/if}
    </div>
</div>
