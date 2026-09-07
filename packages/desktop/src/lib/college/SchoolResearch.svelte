<!-- SchoolResearch.svelte — Explicit public research and source review for one tab. -->
<script lang="ts">
import { onDestroy, tick } from "svelte";
import type { CollegeCapabilities, CollegeCapabilitiesSnapshot } from "./capabilities";
import type { CollegeReference } from "./model";
import { type ResearchResult, findingKey } from "./research";
import { type ResearchTarget, collegeResearchSetupKey } from "./researchModel";

let { college, view }: { college: CollegeCapabilities; view: CollegeCapabilitiesSnapshot } =
    $props();
let opened = $state(false);
let running = $state(false);
let saving = $state(false);
let error = $state("");
let notice = $state("");
let target = $state<ResearchTarget | null>(null);
let promptIds = $state<string[]>([]);
let confirmed = $state(false);
let result = $state<ResearchResult | null>(null);
let selected = $state<string[]>([]);
let removed = $state<string[]>([]);
let controller: AbortController | null = null;
let heading = $state<HTMLHeadingElement>();
const groups = [
    { kind: "requirement", label: "Published requirements" },
    { kind: "official-advice", label: "Official guidance" },
    { kind: "editorial-guidance", label: "Possible connections to explore" },
] as const;
const setupKey = $derived(view.setup ? collegeResearchSetupKey(view.setup) : "");
const saved = $derived(view.setup?.references.filter((reference) => reference.research) ?? []);
const missing = $derived(
    result
        ? saved.filter(
              (reference) =>
                  !result?.findings.some(
                      (finding) => finding.url === reference.url && finding.kind === reference.kind,
                  ),
          )
        : [],
);
onDestroy(() => controller?.abort());
async function open(): Promise<void> {
    const setup = view.setup;
    if (!setup) return;
    const previous = setup.references.some(
        (reference) => reference.research?.setupKey === collegeResearchSetupKey(setup),
    )
        ? setup.researchReview?.target
        : undefined;
    target = {
        school: previous?.school ?? setup.school,
        cycle: previous?.cycle ?? setup.cycle,
        program: previous?.program ?? setup.program,
        sourceUrl:
            previous?.sourceUrl ??
            setup.prompts.find((prompt) => prompt.sourceUrl)?.sourceUrl ??
            "",
        prompts: setup.prompts.map(({ id, label, text }) => ({ id, label, text })),
    };
    promptIds = target.prompts.map((prompt) => prompt.id);
    opened = true;
    confirmed = false;
    result = null;
    error = "";
    notice = "";
    await tick();
    heading?.focus();
}
function close(): void {
    controller?.abort();
    opened = false;
    result = null;
}
async function research(): Promise<void> {
    if (!target || !confirmed || !promptIds.length) return;
    controller?.abort();
    const operation = new AbortController();
    controller = operation;
    running = true;
    result = null;
    selected = [];
    removed = [];
    error = "";
    notice = "";
    try {
        const response = await college.research(
            {
                ...target,
                prompts: target.prompts.filter((prompt) => promptIds.includes(prompt.id)),
            },
            operation.signal,
        );
        if (operation.signal.aborted) return;
        result = response;
        await tick();
        heading?.focus();
    } catch (cause) {
        if (controller !== operation) return;
        if (!operation.signal.aborted)
            error = cause instanceof Error ? cause.message : "Research failed. Try again.";
        else notice = "Research stopped. Saved sources are unchanged.";
    } finally {
        if (controller === operation) running = false;
    }
}
function previousFor(finding: CollegeReference): CollegeReference | undefined {
    return saved.find(
        (reference) =>
            reference.url === finding.url &&
            reference.kind === finding.kind &&
            JSON.stringify(reference.research?.promptIds) ===
                JSON.stringify(finding.research?.promptIds),
    );
}
function statusFor(finding: CollegeReference): string {
    if (
        saved.some(
            (reference) =>
                findingKey(reference) === findingKey(finding) &&
                view.setup &&
                reference.research?.setupKey === setupKey,
        )
    )
        return "Already saved";
    if (previousFor(finding)) return "Changed since your saved snapshot";
    if (view.setup?.researchReview?.rejectedKeys.includes(findingKey(finding)))
        return "Previously left out";
    return "New finding";
}
async function accept(): Promise<void> {
    if (!result) return;
    saving = true;
    error = "";
    try {
        await college.acceptResearch(result.id, selected, removed);
        result = null;
        notice = "Source review saved. Your essay and notes are unchanged.";
    } catch (cause) {
        error = cause instanceof Error ? cause.message : "Could not save these sources. Try again.";
    } finally {
        saving = false;
    }
}
</script>

{#if !opened}
    <button class="research-link" disabled={!view.setup?.active || view.saving} onclick={open}>Research this school's prompt</button>
{:else}
    <section class="space-y-3 border-t border-black/10 pt-3" aria-label="School research">
        <div class="flex items-center justify-between gap-2">
            <h3 class="font-semibold text-sm" tabindex="-1" bind:this={heading}>{result ? "Review sources" : "Research this school's prompt"}</h3>
            <button class="research-link" disabled={saving} onclick={close}>Close</button>
        </div>
        <p class="text-xs text-black/60">{view.tabLabel} · {view.draftLabel}</p>
        {#if error}<p role="alert" class="text-xs text-red-800">{error}</p>{/if}
        {#if notice}<p role="status" class="text-xs">{notice}</p>{/if}
        {#if view.researchUnavailable}<p class="text-xs">{view.researchUnavailable}</p>{/if}
        {#if target && !result}
            <form class="space-y-3" onsubmit={(event) => { event.preventDefault(); void research(); }}>
                <fieldset class="space-y-3" disabled={running || saving}>
                    <label>School and campus<input required maxlength="200" bind:value={target.school} /></label>
                    <div class="grid grid-cols-2 gap-2">
                        <label>Application cycle<input maxlength="100" bind:value={target.cycle} placeholder="Unknown" /></label>
                        <label>Program (optional)<input maxlength="200" bind:value={target.program} /></label>
                    </div>
                    <label>Official admissions page<input type="url" required maxlength="2000" bind:value={target.sourceUrl} placeholder="https://admissions.school.edu/…" oninput={() => confirmed = false} /></label>
                    <p class="text-xs text-black/60">Uses this as the confirmed official source and limits research to this hostname. Use a public page without a login.</p>
                    <label class="check"><input type="checkbox" bind:checked={confirmed} />I checked that this is the official site for this school and campus.</label>
                    <fieldset class="space-y-2">
                        <legend class="font-medium text-xs mb-2">Prompts to research</legend>
                        {#each target.prompts as prompt (prompt.id)}
                            <label class="check"><input type="checkbox" bind:group={promptIds} value={prompt.id} /><span>{prompt.label || "Prompt"}<span class="block font-normal whitespace-pre-wrap mt-1">{prompt.text}</span></span></label>
                        {/each}
                    </fieldset>
                    <p class="text-xs text-black/60">Edit setup to change a prompt. Only the school, cycle, program, selected public prompts, and public source content go to {view.researchProvider || "your model"}. Research uses the network and may incur AI usage.</p>
                    <button class="research-button" type="submit" disabled={!confirmed || !promptIds.length || !!view.researchUnavailable}>Start research</button>
                </fieldset>
            </form>
        {/if}
        {#if running}
            <p role="status" class="text-xs">Checking public sources…</p>
            <button class="research-button" onclick={() => controller?.abort()}>Cancel research</button>
        {/if}
        {#if result}
            <p class="text-xs">{result.target.school} · {result.target.cycle || "Cycle unknown"}{result.target.program ? ` · ${result.target.program}` : ""}</p>
            <p class="text-xs text-black/60">AI-extracted findings from the site you confirmed. Check the evidence before adding it to this tab's context.</p>
            {#each result.warnings as warning}<p class="text-xs rounded bg-amber-50 p-2">{warning}</p>{/each}
            {#if !result.findings.length}<p class="text-xs">No supported findings to add. Try a more specific official page.</p>{/if}
            {#each groups as group}
                {@const findings = result.findings.filter(finding => finding.kind === group.kind)}
                {#if findings.length}
                    <fieldset class="space-y-3" disabled={saving}>
                        <legend class="font-semibold text-xs mb-2">{group.label}</legend>
                        {#if group.kind === "editorial-guidance"}<p class="text-xs">Interpretation, not an admission preference or prediction.</p>{/if}
                        {#each findings as finding (finding.id)}
                            {@const previous = previousFor(finding)}
                            <div class="rounded-lg bg-white/60 p-3 space-y-2">
                                <p class="text-xs text-black/60">{statusFor(finding)}</p>
                                <label class="check"><input type="checkbox" bind:group={selected} value={finding.id} disabled={statusFor(finding) === "Already saved"} /><span>{finding.summary}</span></label>
                                <blockquote class="text-xs border-l-2 border-black/20 pl-2 whitespace-pre-wrap">{finding.research?.evidence}</blockquote>
                                <p class="text-xs text-black/60">{finding.publisher} · {finding.cycle || "Cycle unknown"} · Checked {finding.checkedDate}</p>
                                <a class="research-link break-all" href={finding.url} target="_blank" rel="noreferrer">{finding.url}</a>
                                {#if previous && statusFor(finding) !== "Already saved"}
                                    <details><summary class="research-link">Compare saved finding</summary><p class="text-xs py-2">{previous.summary}</p><label class="check"><input type="checkbox" bind:group={removed} value={previous.id} />Remove this older finding when saving this review</label></details>
                                {/if}
                            </div>
                        {/each}
                    </fieldset>
                {/if}
            {/each}
            {#if saved.length}
                <details>
                    <summary class="research-link">Saved research ({saved.length})</summary>
                    <p class="text-xs mt-2">Sources not found this time may be outside this search or temporarily unavailable. They stay saved unless you select removal.</p>
                    {#each saved as reference (reference.id)}
                        <div class="py-2 space-y-1">
                            {#if missing.some(item => item.id === reference.id)}<p class="text-xs">Not found this time</p>{/if}
                            <label class="check"><input type="checkbox" bind:group={removed} value={reference.id} disabled={saving} /><span>Remove saved finding: {reference.summary}</span></label>
                        </div>
                    {/each}
                </details>
            {/if}
            <div class="flex flex-wrap gap-2">
                <button class="research-button" disabled={saving || !!view.researchUnavailable} onclick={accept}>{saving ? "Saving…" : selected.length ? "Add to essay context" : "Save review choices"}</button>
                <button class="research-link" disabled={saving} onclick={() => { result = null; confirmed = false; }}>Change target or retry</button>
            </div>
            <p class="text-xs text-black/60">Nothing is added automatically. Adding keeps your existing sources; only checked removals are deleted. Up to 12 sources fit in a setup, with 6,000 characters available to requests.</p>
            <details><summary class="research-link">Sources returned ({result.pages.length})</summary>{#each result.pages as page}<a class="block research-link mt-2 break-all" href={page.url} target="_blank" rel="noreferrer">{page.title || page.url}</a>{/each}</details>
        {/if}
    </section>
{/if}

<style>
    label { display: flex; flex-direction: column; gap: .375rem; font-size: .75rem; font-weight: 500; }
    input:not([type="checkbox"]) { width: 100%; min-width: 0; border: 1px solid #0002; border-radius: .375rem; background: #fffb; padding: .5rem; font-size: .75rem; }
    .check { flex-direction: row; align-items: flex-start; gap: .5rem; font-weight: 400; }
    .check input { flex-shrink: 0; margin-top: .15rem; }
    .research-link { font-size: .75rem; color: #374151; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    .research-button { font-size: .75rem; border: 1px solid #0002; border-radius: .5rem; padding: .5rem .75rem; background: #fffb; }
    button:disabled, fieldset:disabled { opacity: .55; cursor: default; }
    :is(button, input, summary, a):focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
</style>
