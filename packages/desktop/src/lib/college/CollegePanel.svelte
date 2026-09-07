<!-- CollegePanel.svelte — Choose prompts, then create essay tabs or pick a workspace tab. -->
<script lang="ts">
import type { SidebarPanelProps } from "$lib/sidebar/panels";
import { tick } from "svelte";
import RelatedEssays from "./RelatedEssays.svelte";
import SchoolResearch from "./SchoolResearch.svelte";
import { type CollegeSetup, collegeSetupSchema } from "./model";
import { COMMON_APP_PROMPTS, UC_PROMPTS, newCollegeSetup } from "./presets";

let { active, session, college }: SidebarPanelProps = $props();
let view = $derived(college?.read());
let choosing = $state(false);
let replacing = $state(false);
let kind = $state<CollegeSetup["kind"]>("uc-piq");
let selected = $state<number[]>([]);
let school = $state("");
let customPrompt = $state("");
let max = $state<number | undefined>(undefined);
let unit = $state<"words" | "characters">("words");
let busy = $state(false);
let error = $state("");
let removing = $state(false);
let relatedOpen = $state(false);
let heading = $state<HTMLHeadingElement>();
let previousTarget = $state("");
const targetKey = $derived(session ? JSON.stringify(session.target) : "");
const options = $derived(kind === "uc-piq" ? UC_PROMPTS : COMMON_APP_PROMPTS);
const selectedCount = $derived(kind === "supplemental" ? (customPrompt.trim() ? 1 : 0) : selected.length);
$effect(() => {
    if (!active || previousTarget !== targetKey) {
        previousTarget = targetKey;
        choosing = false;
        replacing = false;
        removing = false;
        selected = [];
        school = "";
        customPrompt = "";
        max = undefined;
        error = "";
        busy = false;
    }
});
function label(index: number): string {
    const text = options[index].label.replace(/\s*\(summary\)$/, "");
    return kind === "uc-piq" ? `PIQ ${index + 1} · ${text}` : text;
}
function start(replace = false): void {
    replacing = replace;
    choosing = true;
    selected = [];
    error = "";
    if (replace && view?.setup) {
        kind = view.setup.kind;
        school = view.setup.school;
        customPrompt = view.setup.prompts[0]?.text ?? "";
        const limit = view.setup.prompts[0]?.constraints.find(c => c.unit === "words" || c.unit === "characters");
        max = limit?.max ?? undefined;
        unit = limit?.unit === "characters" ? "characters" : "words";
        const index = (kind === "uc-piq" ? UC_PROMPTS : COMMON_APP_PROMPTS).findIndex(p => p.text === customPrompt);
        if (index >= 0) selected = [index];
    }
    void tick().then(() => heading?.focus());
}
function select(index: number, checked: boolean): void {
    selected = replacing ? [index] : checked ? [...selected, index] : selected.filter(i => i !== index);
}
function setups(): CollegeSetup[] {
    const indices = kind === "supplemental" ? [0] : selected;
    return indices.map(index => {
        const setup = newCollegeSetup(kind);
        if (kind === "supplemental") {
            setup.school = school.trim();
            setup.prompts[0].label = school.trim() || "School supplement";
            setup.prompts[0].text = customPrompt.trim();
            setup.prompts[0].constraints = [{id: crypto.randomUUID(), unit, min: null, max: max ?? null, detail: ""}];
        } else {
            setup.prompts[0].label = label(index);
            setup.prompts[0].text = options[index].text;
        }
        if (replacing && view?.setup) {
            setup.intent = view.setup.intent;
            setup.feedbackFocus = view.setup.feedbackFocus;
            setup.preferences = { ...view.setup.preferences };
            setup.readers = JSON.parse(JSON.stringify(view.setup.readers));
            setup.feedbackReaders = view.setup.feedbackReaders;
            setup.reviseReaders = view.setup.reviseReaders;
        }
        return collegeSetupSchema.parse(setup);
    });
}
async function apply(mode: "create" | "existing" | "replace"): Promise<void> {
    if (!college || !selectedCount || busy) return;
    const origin = targetKey;
    error = "";
    busy = true;
    try {
        const next = setups();
        if (mode === "existing") college.applyToExistingTab(next[0]);
        else if (mode === "replace") await college.save(next[0]);
        else await college.createTabs(next);
        if (origin === targetKey) choosing = false;
    } catch (cause) {
        if (origin === targetKey) error = cause instanceof Error ? cause.message : "Could not save your prompts. Try again.";
    } finally {
        if (origin === targetKey) busy = false;
    }
}
async function update(setup: CollegeSetup | null): Promise<void> {
    const origin = targetKey;
    busy = true;
    try { await college?.save(setup); if (origin === targetKey) removing = false; }
    catch (cause) { if (origin === targetKey) error = String(cause); }
    finally { if (origin === targetKey) busy = false; }
}
</script>

<div data-sidebar-size={!choosing && view?.setup ? "compact" : undefined} class="college-panel p-4 space-y-4 text-sm text-black/80">
    {#if choosing || !view?.setup}<h2 bind:this={heading} tabindex="-1" class="font-semibold">{choosing || !view?.setup ? (replacing ? "Choose a prompt" : "Which prompts are you answering?") : view.tabLabel}</h2>{/if}
    {#if error || view?.error}<p role="alert" class="rounded-lg bg-red-50 text-red-800 p-3">{error || view?.error}</p>{/if}
    {#if !view?.documentId || !view.tabId}
        <p>Open a document to get started.</p>
    {:else if view.status === "loading"}
        <p role="status">Loading your prompt…</p>
    {:else if view.status === "error" || view.status === "unsupported"}
        <p>We couldn’t load this tab’s setup.</p>
        <button class="secondary" onclick={() => college?.retry().catch(cause => error = String(cause))}>Retry loading</button>
        {#if view.status === "unsupported"}<button class="secondary" disabled={busy} onclick={() => update(null)}>Remove unsupported setup</button>{/if}
    {:else if removing}
        <p>Remove this tab’s prompt and College preferences? Your writing, shared notes, and saved decisions stay.</p>
        <button class="secondary" disabled={busy} onclick={() => removing = false}>Cancel</button>
        <button class="secondary" disabled={busy} onclick={() => update(null)}>Remove setup</button>
    {:else if choosing || !view.setup}
        <p class="text-xs text-black/60">{replacing ? "Your writing stays in this tab." : "Each prompt gets its own tab. Feedback uses its prompt and word limit automatically."}</p>
        <fieldset disabled={busy || view.saving} class="space-y-4">
            <div class="flex flex-wrap gap-1" aria-label="Application">
                {#each [["uc-piq", "UC PIQs"], ["common-app", "Common App"], ["supplemental", "School supplement"]] as [value, title]}
                    <button class="family" aria-pressed={kind === value} onclick={() => {kind = value as CollegeSetup["kind"]; selected = [];}}>{title}</button>
                {/each}
            </div>
            {#if kind === "supplemental"}
                <label>School<input maxlength="200" bind:value={school} placeholder="School name" /></label>
                <label>Prompt<textarea rows="4" maxlength="4000" bind:value={customPrompt} placeholder="Paste the essay question"></textarea></label>
                <div class="grid grid-cols-2 gap-2">
                    <label>Length limit (optional)<input type="number" min="1" max="10000000" step="1" bind:value={max} placeholder="If specified" /></label>
                    <label>Count in<select bind:value={unit}><option value="words">Words</option><option value="characters">Characters</option></select></label>
                </div>
            {:else}
                <p class="text-xs text-black/60">Prompt summaries · {kind === "uc-piq" ? "350 words each" : "2026–27"}</p>
                <div class="space-y-2">
                    {#each options as option, index}
                        <label class="choice" class:chosen={selected.includes(index)}>
                            <input type={replacing ? "radio" : "checkbox"} name="college-prompt" checked={selected.includes(index)} onchange={event => select(index, event.currentTarget.checked)} />
                            <span><strong class="font-medium">{label(index)}</strong><span class="block text-xs text-black/60 mt-1">{option.text}</span></span>
                        </label>
                    {/each}
                </div>
            {/if}
            <div class="space-y-2">
                <button class="primary w-full" disabled={!selectedCount} onclick={() => apply(replacing ? "replace" : "create")}>{busy ? "Saving…" : replacing ? "Use this prompt" : selectedCount > 1 ? `Create ${selectedCount} essay tabs` : "Create essay tab"}</button>
                {#if !replacing}
                    <button class="link" disabled={selectedCount !== 1} onclick={() => apply("existing")}>Apply to existing tab</button>
                    {#if selectedCount > 1}<p class="text-xs text-black/60">Select one prompt to use an existing tab.</p>{/if}
                {/if}
                {#if view.setup}<button class="link" onclick={() => choosing = false}>Back to writing</button>{/if}
            </div>
        </fieldset>
    {:else}
        {@const setup = view.setup}
        {#each setup.prompts as prompt (prompt.id)}
            <section class="space-y-2" aria-label={prompt.label || "Your prompt"}>
                <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h2 class="font-semibold">{prompt.label || "Your prompt"}</h2>
                    {#each prompt.constraints.filter(c => c.unit !== "other") as constraint (constraint.id)}
                        <span class="text-xs text-black/60 whitespace-nowrap tabular-nums" aria-label="Essay length">{constraint.unit === "characters" ? view.characterCount : view.wordCount}{constraint.max !== null ? ` / ${constraint.max}` : ""} {constraint.unit}</span>
                    {/each}
                </div>
                {#if !relatedOpen}
                <p class="whitespace-pre-wrap leading-relaxed">{prompt.text}</p>
                {#if prompt.sourceUrl}<a class="source-link" href={prompt.sourceUrl} target="_blank" rel="noreferrer">{setup.kind === "supplemental" ? "Original prompt" : "Prompt summary · View original"}<span aria-hidden="true"> ↗</span></a>{/if}
                {/if}
            </section>
        {/each}
        {#if setup.prompts.length > 1}<p class="text-xs text-black/60">This earlier setup has multiple prompts. Change prompt to replace it with one; your writing stays.</p>{/if}
        {#if !setup.active}<p class="text-xs text-black/60">Paused. Feedback isn’t using this prompt.</p>{/if}
        {#if !relatedOpen}
        <div class="flex flex-wrap gap-2">
            <button class="secondary" onclick={() => start(true)}>Change prompt</button>
            <button class="secondary" onclick={() => start()}>Add essays</button>
        </div>
        {/if}
        {#if college}
            <RelatedEssays {college} {view} onExpandedChange={(expanded) => (relatedOpen = expanded)} />
        {/if}
        <div hidden={relatedOpen} class="space-y-3">
        {#if view.aiEnabled && college}
            <SchoolResearch {college} {view} />
        {/if}
        <details class="border-t border-black/10 pt-3">
            <summary class="text-xs cursor-pointer">Sources and settings</summary>
            <div class="space-y-3 pt-3 text-xs">
                {#if setup.school || setup.cycle}<p class="text-black/60">{[setup.school, setup.cycle].filter(Boolean).join(" · ")}</p>{/if}
                <div class="space-y-3">
                    {#each setup.references as ref (ref.id)}
                        <div class="source-card">
                            {#if ref.url}<a class="source-link font-medium" href={ref.url} target="_blank" rel="noreferrer">{ref.publisher}<span aria-hidden="true"> ↗</span></a>{:else}<p class="font-medium">{ref.publisher}</p>{/if}
                            <p class="leading-relaxed mt-1">{ref.summary}</p>
                            <p class="text-black/50 mt-2">Checked {ref.checkedDate}{ref.cycle ? ` · ${ref.cycle}` : ""}</p>
                        </div>
                    {/each}
                </div>
                {#if view.aiEnabled}<div class="flex flex-wrap gap-2" aria-label="AI preferences"><button class="secondary" onclick={() => college?.openPanel("context")}>Context</button><button class="secondary" onclick={() => college?.openPanel("readers")}>Readers</button><button class="secondary" onclick={() => college?.openPanel("settings")}>AI settings</button></div>{/if}
                <div class="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-3">
                    <button class="secondary" disabled={busy || view.saving} onclick={() => update({...setup, active: !setup.active})}>{setup.active ? "Pause setup" : "Resume setup"}</button>
                    <button class="remove-action" disabled={busy || view.saving} onclick={() => removing = true}>Remove setup…</button>
                </div>
            </div>
        </details>
        </div>
    {/if}
</div>

<style>
    label:not(.choice) { display:flex; flex-direction:column; gap:.4rem; font-size:.75rem; }
    input:not([type="checkbox"]):not([type="radio"]), textarea, select { width:100%; min-width:0; padding:.6rem; border:1px solid rgb(0 0 0 / .15); border-radius:.5rem; background:rgb(255 255 255 / .8); }
    .choice { display:flex; align-items:flex-start; gap:.65rem; padding:.7rem; border:1px solid rgb(0 0 0 / .12); border-radius:.6rem; background:rgb(255 255 255 / .65); cursor:pointer; }
    .choice input { margin-top:.2rem; accent-color:#2563eb; }
    .chosen { border-color:#2563eb; background:#eff4ff; }
    button { cursor:pointer; }
    button:disabled { opacity:.45; cursor:default; }
    .family { padding:.45rem .55rem; border-radius:.45rem; font-size:.75rem; }
    .family[aria-pressed="true"] { background:rgb(255 255 255 / .8); }
    .primary { padding:.7rem; border-radius:.5rem; background:#2563eb; color:white; }
    .secondary { padding:.45rem .65rem; border-radius:.4rem; background:rgb(255 255 255 / .7); font-size:.75rem; }
    .link { font-size:.75rem; color:#1d4ed8; text-decoration:underline; text-underline-offset:3px; }
    .secondary:hover:not(:disabled) { background:rgb(255 255 255 / .95); }
    .source-link { color:rgb(0 0 0 / .6); font-size:.75rem; text-underline-offset:3px; }
    .source-link span { margin-left:.25rem; }
    .source-link:hover { text-decoration:underline; color:rgb(0 0 0 / .85); }
    .source-card { padding:.7rem; border-radius:.5rem; background:rgb(255 255 255 / .35); }
    .remove-action { padding:.45rem .2rem; font-size:.75rem; color:#991b1b; }
    .remove-action:hover:not(:disabled) { text-decoration:underline; text-underline-offset:3px; }
    a:focus-visible { outline:2px solid #2563eb; outline-offset:3px; border-radius:2px; }
    summary { cursor:pointer; }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible { outline:2px solid #2563eb; outline-offset:2px; }
</style>
