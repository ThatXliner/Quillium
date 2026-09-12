<!-- BundledGuidance.svelte — Review shipped guidance before replacing saved snapshots. -->
<script lang="ts">
import { openUrl } from "@tauri-apps/plugin-opener";
import { tick } from "svelte";
import { bundledReferencesFor, previewBundledGuidance } from "./bundledGuidance";
import type { CollegeCapabilities } from "./capabilities";
import { type CollegeSetup, collegeSetupSchema } from "./model";

let { college, setup, saving }: {
    college: CollegeCapabilities;
    setup: CollegeSetup;
    saving: boolean;
} = $props();
let expected = $state<CollegeSetup | null>(null);
let busy = $state(false);
let error = $state("");
let notice = $state("");
let heading = $state<HTMLHeadingElement>();
const preview = $derived(expected ? previewBundledGuidance(expected) : null);
const hasChanges = $derived(preview && (preview.added.length + preview.changed.length + preview.removed.length > 0));
const stale = $derived(expected && JSON.stringify(expected) !== JSON.stringify(setup));

async function check(): Promise<void> {
    expected = collegeSetupSchema.parse(setup);
    error = "";
    notice = "";
    await tick();
    heading?.focus();
}
async function accept(): Promise<void> {
    if (!expected || stale || busy) return;
    busy = true;
    error = "";
    try {
        await college.acceptBundledGuidance(expected);
        expected = null;
        notice = "Bundled guidance saved to this tab.";
    } catch (cause) {
        error = cause instanceof Error ? cause.message : "Could not save guidance. Try again.";
    } finally {
        busy = false;
    }
}
</script>

<div class="space-y-2 text-xs">
    {#if !expected}
        <button class="guidance-link" disabled={saving || !setup.prompts.length} onclick={check}>Check for updated guidance</button>
    {:else if preview}
        <section class="space-y-3 border-t border-black/10 pt-3" aria-label="Bundled guidance review">
            <div class="flex items-center justify-between gap-2">
                <h3 class="font-semibold text-sm" tabindex="-1" bind:this={heading}>Bundled guidance</h3>
                <button class="guidance-link" disabled={busy} onclick={() => expected = null}>Close</button>
            </div>
            <p class="text-black/60">Compares your saved sources with guidance included in this version of Quillium. Works offline.</p>
            {#if hasChanges}
                {#each [...preview.added.map(next => ({previous: null, next})), ...preview.changed] as change (change.next.id)}
                    <div class="rounded-lg bg-white/60 p-3 space-y-2">
                        <p class="font-medium">{change.previous ? "Updated guidance" : "New guidance"}</p>
                        {#if change.previous}<p><span class="font-medium">Saved:</span> {change.previous.summary}</p><p class="text-black/60">Checked {change.previous.checkedDate || "unknown"} · {change.previous.cycle || "Cycle unknown"}</p>{/if}
                        <p><span class="font-medium">{change.previous ? "Updated:" : "Guidance:"}</span> {change.next.summary}</p>
                        <p class="text-black/60">{change.next.kind === "requirement" ? "Official requirement" : change.next.kind === "official-advice" ? "Official advice" : "Editorial guidance"} · Checked {change.next.checkedDate || "unknown"} · {change.next.cycle || "Cycle unknown"}</p>
                        <a class="guidance-link" href={change.next.url} onclick={(event) => { event.preventDefault(); void openUrl(change.next.url); }}>{change.next.publisher}</a>
                    </div>
                {/each}
                {#each preview.removed as reference (reference.id)}
                    <div class="rounded-lg bg-white/60 p-3 space-y-2"><p class="font-medium">Removed from bundled guidance</p><p>{reference.summary}</p><p class="text-black/60">{reference.publisher} · Checked {reference.checkedDate || "unknown"}</p></div>
                {/each}
                {#if stale}<p role="status">Your prompt or setup changed. Check again to review the current guidance.</p>{/if}
                <button class="guidance-button" disabled={busy || saving || !!stale} onclick={accept}>{busy ? "Saving…" : "Apply guidance update"}</button>
                {#if stale}<button class="guidance-link" disabled={busy || saving} onclick={check}>Check again</button>{/if}
            {:else if !bundledReferencesFor(expected).length}
                <p role="status">No bundled guidance is available for these prompts.</p>
            {:else}
                <p role="status">Your saved guidance is up to date with this version of Quillium.</p>
            {/if}
        </section>
    {/if}
    {#if error}<p role="alert" class="text-red-800">{error}</p>{/if}
    {#if notice}<p role="status">{notice}</p>{/if}
</div>

<style>
    .guidance-link { color: #374151; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    .guidance-button { border: 1px solid #0002; border-radius: .5rem; padding: .5rem .75rem; background: #fffb; }
    button:disabled { opacity: .55; cursor: default; }
    :is(button, a):focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
</style>
