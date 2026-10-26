<!--
    LicensesModal.svelte — Open Source Licenses overlay.

    Fetches /licenses.json at mount and renders direct JS and Rust
    dependencies grouped by ecosystem.

    Props:
      ondismiss — called when the user closes the modal
-->
<script lang="ts">
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import { openUrl } from "@tauri-apps/plugin-opener";
import { X } from "lucide-svelte";
import { onMount } from "svelte";

type LicenseEntry = {
    name: string;
    version: string;
    license: string;
    url?: string;
    ecosystem: "js" | "rust";
};

const { ondismiss }: { ondismiss: () => void } = $props();

let entries = $state<LicenseEntry[]>([]);
let loading = $state(true);
let error = $state(false);

onMount(async () => {
    try {
        const res = await fetch("/licenses.json");
        if (res.ok) {
            entries = await res.json();
        } else {
            error = true;
        }
    } catch {
        error = true;
    } finally {
        loading = false;
    }
});

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") ondismiss();
}

const jsEntries = $derived(entries.filter((e) => e.ecosystem === "js"));
const rustEntries = $derived(entries.filter((e) => e.ecosystem === "rust"));

let restoreSize = $state<(() => void) | undefined>();
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-[9999]" role="dialog" aria-modal="true" aria-label="Open Source Licenses">
    <button
        type="button"
        class="absolute inset-0 bg-black/55 border-0 p-0 cursor-default"
        aria-label="Close"
        tabindex="-1"
        onclick={ondismiss}
    ></button>

    <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-h-[75vh] bg-white shadow-2xl rounded-2xl flex flex-col overflow-hidden border border-black/[0.06]"
        role="document"
    >
        <!-- Header -->
        <div class="flex items-start justify-between px-7 pt-7 pb-0 shrink-0">
            <div>
                <h3 class="text-xl font-bold text-black/85 leading-tight">Open Source Licenses</h3>
                <p class="text-xs text-black/35 mt-1">Libraries that make Quillium possible</p>
            </div>
            <div class="flex items-center gap-1 shrink-0">
                <RestoreSizeButton {restoreSize} />
                <button
                    type="button"
                    onclick={ondismiss}
                    aria-label="Close"
                    class="flex items-center justify-center w-8 h-8 rounded-lg bg-black/[0.05] text-black/35 hover:text-black/60 hover:bg-black/[0.1] transition-colors"
                >
                    <X size={16} />
                </button>
            </div>
        </div>

        <!-- Scrollable content -->
        <div class="flex-1 overflow-y-auto px-7 pt-5 pb-7">
            {#if loading}
                <p class="text-sm text-black/35">Loading…</p>
            {:else if error}
                <p class="text-sm text-black/40">Could not load license information.</p>
            {:else}
                {#each [{ label: "JavaScript", items: jsEntries }, { label: "Rust", items: rustEntries }] as section}
                    {#if section.items.length > 0}
                        <h4 class="text-xs font-semibold uppercase tracking-wider text-black/30 mb-3 mt-5 first:mt-0">
                            {section.label}
                        </h4>
                        <ul class="space-y-2">
                            {#each section.items as entry}
                                <li class="flex items-center justify-between gap-4">
                                    <div class="flex items-center gap-2 min-w-0">
                                        {#if entry.url}
                                            <button
                                                type="button"
                                                class="text-sm font-medium text-black/75 hover:text-black truncate cursor-pointer bg-transparent border-0 p-0 text-left"
                                                onclick={() => openUrl(entry.url!)}
                                            >
                                                {entry.name}
                                            </button>
                                        {:else}
                                            <span class="text-sm font-medium text-black/75 truncate">{entry.name}</span>
                                        {/if}
                                        <span class="text-xs text-black/30 shrink-0">{entry.version}</span>
                                    </div>
                                    <span class="text-xs text-black/40 bg-black/[0.04] rounded px-2 py-0.5 shrink-0 font-mono">
                                        {entry.license}
                                    </span>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                {/each}
            {/if}
        </div>
        <ModalResizeHandles bind:restoreSize />
    </div>
</div>
