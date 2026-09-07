<!-- CollegeContext.svelte — The same tab-owned setup in general writing panels. -->
<script lang="ts">
import { collegeResearchSetupKey } from "./researchModel";
import { collegeState, getActiveCollegeSetup } from "./state.svelte";
let { detailed = false }: { detailed?: boolean } = $props();
const setup = $derived(collegeState.setup);
const effective = $derived(getActiveCollegeSetup());
</script>
{#if setup || collegeState.error || collegeState.status === "loading"}
    <section class="m-3 rounded-lg border border-amber-200/70 bg-white/60 p-3 space-y-2 text-xs" aria-label="Tab college context">
        <h3 class="font-semibold text-black/80">College setup for this tab</h3>
        {#if collegeState.status === "loading"}<p role="status">Loading this tab’s writing settings…</p>{/if}
        {#if collegeState.error}<p role="alert" class="text-red-800">{collegeState.error}</p>{/if}
        {#if setup}
            <p class="text-black/60">{effective ? "Active for all drafts and runs in this tab. Changes here save to this tab." : "Paused or disabled. Device preferences apply; saved college guidance is excluded."}</p>
            <p class="text-black/60">Shared notes and decisions belong to the document. Edit prompts and accepted sources in College applications.</p>
            {#if detailed}
                <p>Cycle: {setup.cycle || "Unknown"} · {setup.school || "School not specified"}</p>
                {#each setup.prompts as prompt (prompt.id)}
                    <details><summary class="cursor-pointer font-medium">{prompt.label || "Prompt"}</summary><p class="whitespace-pre-wrap py-2">{prompt.text}</p>
                        {#each prompt.constraints as constraint (constraint.id)}<p>{constraint.min ?? "?"}–{constraint.max ?? "?"} {constraint.unit} · {constraint.detail}</p>{/each}
                    </details>
                {/each}
                {#if setup.intent}<p>Intent: {setup.intent}</p>{/if}
                {#if setup.feedbackFocus}<p>Feedback focus: {setup.feedbackFocus}</p>{/if}
                <details><summary class="cursor-pointer font-medium">Accepted source snapshots</summary>
                    {#each setup.references as reference (reference.id)}
                        <div class="py-2 space-y-1">{#if reference.research}{#if reference.research.setupKey !== collegeResearchSetupKey(setup)}<p class="text-amber-900">Saved for an earlier setup. Excluded from requests; research this prompt again to review.</p>{/if}<p>{reference.research.school} · {reference.research.targetCycle || "Target cycle unknown"} · {reference.research.promptIds.length} selected prompt(s)</p><blockquote class="border-l-2 border-black/20 pl-2">{reference.research.evidence}</blockquote>{/if}<p>{reference.kind}: {reference.summary}</p><p class="text-black/60">{reference.publisher} · {reference.cycle || "Cycle unknown"} · Checked {reference.checkedDate || "unknown"}</p>{#if reference.url}<a class="text-blue-700 underline" href={reference.url} target="_blank" rel="noreferrer">View source</a>{/if}</div>
                    {/each}
                </details>
                <p class="text-black/60">Requests include up to 8,000 characters of tab brief and 6,000 of reference guidance. Context Lens shows omissions.</p>
            {/if}
        {/if}
    </section>
{/if}
