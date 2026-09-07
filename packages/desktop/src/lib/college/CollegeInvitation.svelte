<!-- CollegeInvitation.svelte — Document opt-in from AI Settings. -->
<script lang="ts">
import { tick } from "svelte";
import { currentDocumentId } from "$lib/stores";
import { collegeActivation, enableCollegeForDocument } from "./activation.svelte";
import { PRESET_LABELS } from "./presets";
import type { CollegeSetup } from "./model";

let { onCollegeSetup }: { onCollegeSetup?: (kind: CollegeSetup["kind"]) => void } = $props();
const enabled = $derived(collegeActivation.documentId === $currentDocumentId && collegeActivation.enabled);
async function choose(kind: CollegeSetup["kind"]): Promise<void> {
    const documentId = $currentDocumentId;
    if (!documentId || !onCollegeSetup) return;
    if (!enabled && !(await enableCollegeForDocument(documentId))) return;
    await tick();
    if ($currentDocumentId === documentId) onCollegeSetup(kind);
}
</script>

<section aria-label="College applications setup" class="border-t border-black/10 pt-3 space-y-2">
    <p class="text-xs font-semibold text-black/75">{enabled ? "College applications" : "Writing college applications?"}</p>
    <p class="text-xs text-black/60">{enabled ? "Add essay prompts to this document." : "Set up context and readers for your essays in this document."}</p>
    <div class="flex flex-wrap gap-2">
        {#each Object.entries(PRESET_LABELS) as [kind, label]}
            <button type="button" class="rounded-lg border border-black/10 bg-white/60 px-2.5 py-1.5 text-xs text-blue-700 hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50"
                disabled={!$currentDocumentId || collegeActivation.loading || collegeActivation.saving || !onCollegeSetup}
                onclick={() => choose(kind as CollegeSetup["kind"])}>{label}</button>
        {/each}
    </div>
    {#if !$currentDocumentId}<p class="text-xs text-black/60">Open a document to set up your essays.</p>{/if}
    {#if collegeActivation.error}<p role="alert" class="text-xs text-red-700">{collegeActivation.error}</p>{/if}
</section>
