<!-- CollegeContext.svelte — The same tab-owned setup in general writing panels. -->
<script lang="ts">
import { documentContent } from "$lib/stores";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isCollegeReferenceCurrent } from "./researchModel";
import { resolveCollegeSetup } from "./sections";
import { collegeState, getActiveCollegeSetup } from "./state.svelte";
let {
    detailed = false,
    purpose = "context",
}: {
    detailed?: boolean;
    purpose?: "context" | "readers";
} = $props();
const setup = $derived(
    collegeState.setup ? resolveCollegeSetup(collegeState.setup, $documentContent) : null,
);
const effective = $derived(getActiveCollegeSetup());
</script>
{#if setup || collegeState.error || collegeState.status === "loading"}
    <section class="m-3 space-y-2 rounded-lg border border-amber-200/70 bg-white/60 p-3 text-xs" aria-label="College context for this tab">
        {#if collegeState.status === "loading"}<p role="status">Loading this tab’s writing settings…</p>{/if}
        {#if collegeState.error}<p role="alert" class="text-red-800">{collegeState.error}</p>{/if}
        {#if setup}
            <div class="flex items-center justify-between gap-2">
                <h3 class="truncate font-semibold text-black/80">
                    {purpose === "readers"
                        ? `${setup.school || "College"} readers`
                        : setup.school || "College application"}
                </h3>
                <span
                    class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium {effective
                        ? 'bg-green-100 text-green-700'
                        : 'bg-black/5 text-black/45'}"
                >{purpose === "readers"
                        ? effective
                            ? "This tab"
                            : "Defaults"
                        : effective
                          ? "Used by AI"
                          : "Paused"}</span>
            </div>
            <p class="text-black/55">
                {purpose === "readers"
                    ? effective
                        ? "Changes below apply only to this tab. Your default reader personas stay unchanged."
                        : "This College setup is paused. Changes below update your default reader personas."
                    : effective
                      ? "AI requests for this tab include its detected college prompts and matching saved guidance."
                      : "AI requests ignore this tab’s college prompt and saved guidance."}
            </p>
            {#if detailed}
                <details>
                    <summary class="cursor-pointer font-medium">Prompt and guidance</summary>
                    <div class="space-y-2 pt-2 text-black/60">
                        {#each setup.prompts as prompt (prompt.id)}
                            <div>
                                <p class="font-medium text-black/70">{prompt.label || "Prompt"}</p>
                                <p class="whitespace-pre-wrap">{prompt.text}</p>
                                {#each prompt.constraints as constraint (constraint.id)}<p>{constraint.min ?? "?"}–{constraint.max ?? "?"} {constraint.unit} · {constraint.detail}</p>{/each}
                            </div>
                        {/each}
                        {#if setup.intent}<p><span class="font-medium text-black/70">Main idea:</span> {setup.intent}</p>{/if}
                        {#if setup.feedbackFocus}<p><span class="font-medium text-black/70">Feedback focus:</span> {setup.feedbackFocus}</p>{/if}
                    </div>
                </details>
                <details><summary class="flex cursor-pointer items-center justify-between gap-2 font-medium"><span>Accepted source snapshots</span><span class="text-[10px] font-normal text-black/40">{setup.references.length}</span></summary>
                    {#each setup.references as reference (reference.id)}
                        <div class="py-2 space-y-1">{#if reference.research}{#if !isCollegeReferenceCurrent(reference, setup)}<p class="text-amber-900">Prompt missing or changed. Saved for recovery; excluded from requests.</p>{/if}<p>{reference.research.school} · {reference.research.targetCycle || "Target cycle unknown"} · {reference.research.promptIds.length} selected prompt(s)</p><blockquote class="border-l-2 border-black/20 pl-2">{reference.research.evidence}</blockquote>{/if}<p>{reference.kind}: {reference.summary}</p><p class="text-black/60">{reference.publisher} · {reference.cycle || "Cycle unknown"} · Checked {reference.checkedDate || "unknown"}</p>{#if reference.url}<a class="text-blue-700 underline" href={reference.url} onclick={(event) => { event.preventDefault(); void openUrl(reference.url); }}>View source</a>{/if}</div>
                    {/each}
                </details>
            {/if}
        {/if}
    </section>
{/if}
