<!-- CollegePanel.svelte — Create essay tabs and add prompts as ordinary H1 sections. -->
<script lang="ts">
import type { SidebarPanelProps } from "$lib/sidebar/panels";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tick, untrack } from "svelte";
import { isCollegeReferenceCurrent } from "./researchModel";
import SchoolResearch from "./SchoolResearch.svelte";
import { type CollegeSetup, collegeSetupSchema } from "./model";
import { COMMON_APP_PROMPTS, UC_PROMPTS, newCollegeSetup } from "./presets";

let { active, session, college, collegePreset }: SidebarPanelProps = $props();
let view = $derived(college?.read());
let choosing = $state(false);
let adding = $state(false);
let kind = $state<CollegeSetup["kind"]>(untrack(() => collegePreset ?? "uc-piq"));
let selected = $state<number[]>([]);
let school = $state("");
let customPrompt = $state("");
let max = $state<number | undefined>(undefined);
let unit = $state<"words" | "characters">("words");
let busy = $state(false);
let error = $state("");
let removing = $state(false);
let heading = $state<HTMLHeadingElement>();
let previousTarget = $state("");
const targetKey = $derived(session ? JSON.stringify(session.target) : "");
const options = $derived(kind === "uc-piq" ? UC_PROMPTS : COMMON_APP_PROMPTS);
const selectedCount = $derived(
    kind === "supplemental" ? (customPrompt.trim() ? 1 : 0) : selected.length,
);
$effect(() => {
    if (!active || previousTarget !== targetKey) {
        previousTarget = targetKey;
        choosing = false;
        adding = false;
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
function start(add = false): void {
    adding = add;
    choosing = true;
    selected = [];
    error = "";
    customPrompt = "";
    max = undefined;
    if (view?.setup) {
        kind = view.setup.kind;
        school = view.setup.school;
    }
    void tick().then(() => heading?.focus());
}
function select(index: number, checked: boolean): void {
    selected = adding
        ? [index]
        : checked
          ? [...selected, index]
          : selected.filter((i) => i !== index);
}
function setups(): CollegeSetup[] {
    const indices = kind === "supplemental" ? [0] : selected;
    return indices.map((index) => {
        const setup = newCollegeSetup(kind);
        if (kind === "supplemental") {
            setup.school = school.trim();
            setup.prompts[0].label = school.trim() || "School supplement";
            setup.prompts[0].text = customPrompt.trim();
            setup.prompts[0].constraints = [
                { id: crypto.randomUUID(), unit, min: null, max: max ?? null, detail: "" },
            ];
        } else {
            setup.prompts[0].label = label(index);
            setup.prompts[0].text = options[index].text;
        }
        return collegeSetupSchema.parse(setup);
    });
}
async function apply(): Promise<void> {
    if (!college || !selectedCount || busy) return;
    const origin = targetKey;
    error = "";
    busy = true;
    try {
        const next = setups();
        if (adding) await college.addPrompt(next[0].prompts[0]);
        else await college.createTabs(next);
        if (origin === targetKey) choosing = false;
    } catch (cause) {
        if (origin === targetKey)
            error =
                cause instanceof Error ? cause.message : "Could not save your prompts. Try again.";
    } finally {
        if (origin === targetKey) busy = false;
    }
}
async function update(setup: CollegeSetup | null): Promise<void> {
    const origin = targetKey;
    busy = true;
    try {
        await college?.save(setup);
        if (origin === targetKey) removing = false;
    } catch (cause) {
        if (origin === targetKey) error = String(cause);
    } finally {
        if (origin === targetKey) busy = false;
    }
}
</script>

<div data-sidebar-size={!choosing && view?.setup ? "compact" : undefined} class="college-panel p-4 space-y-4 text-sm text-black/80">
    {#if choosing || !view?.setup}<h2 bind:this={heading} tabindex="-1" class="font-semibold">{choosing || !view?.setup ? (adding ? "Add another prompt" : "Which prompts are you answering?") : view.tabLabel}</h2>{/if}
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
        <p class="text-xs text-black/60">{adding ? "This prompt starts a new section below your existing answers." : "Each prompt gets its own tab. You can add more prompts to that tab as you write."}</p>
        <fieldset disabled={busy || view.saving} class="space-y-4">
            <div class="flex flex-wrap gap-1" aria-label="Application">
                {#each [["uc-piq", "UC PIQs"], ["common-app", "Common App"], ["supplemental", "School supplement"]] as [value, title]}
                    <button class="family" aria-pressed={kind === value} onclick={() => {kind = value as CollegeSetup["kind"]; selected = [];}}>{title}</button>
                {/each}
            </div>
            {#if kind === "supplemental"}
                {#if !adding}<label>School (optional)<input maxlength="200" bind:value={school} placeholder="School name" /></label>{/if}
                <label>Prompt<textarea rows="4" maxlength="4000" bind:value={customPrompt} placeholder="Paste the essay question"></textarea></label>
                <div class="grid grid-cols-2 gap-2">
                    <label>Length limit (optional)<input type="number" min="1" max="10000000" step="1" bind:value={max} placeholder="If specified" /></label>
                    <label>Count in<select bind:value={unit}><option value="words">Words</option><option value="characters">Characters</option></select></label>
                </div>
            {:else}
                <p class="text-xs text-black/60">Official prompts · {kind === "uc-piq" ? "350 words each" : "2026–27"}</p>
                <div class="space-y-2">
                    {#each options as option, index}
                        <label class="choice" class:chosen={selected.includes(index)}>
                            <input type={adding ? "radio" : "checkbox"} name="college-prompt" checked={selected.includes(index)} onchange={event => select(index, event.currentTarget.checked)} />
                            <span><strong class="font-medium">{label(index)}</strong><span class="block text-xs text-black/60 mt-1">{option.text}</span></span>
                        </label>
                    {/each}
                </div>
            {/if}
            <div class="space-y-2">
                <button class="primary w-full" disabled={!selectedCount} onclick={() => apply()}>{busy ? "Saving…" : adding ? "Add prompt to this tab" : selectedCount > 1 ? `Create ${selectedCount} essay tabs` : "Create essay tab"}</button>
                {#if view.setup}<button class="link" onclick={() => choosing = false}>Back to writing</button>{/if}
            </div>
        </fieldset>
    {:else}
        {@const setup = view.setup}
        {#each view.sections as section, index (section.prompt.id)}
            {@const prompt = section.prompt}
            {@const sources = setup.references.filter(ref => ref.research?.promptIds.includes(prompt.id) && view.effectiveSetup && isCollegeReferenceCurrent(ref, view.effectiveSetup))}
            <section class="space-y-2" aria-label={prompt.label || "Your prompt"}>
                <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h2 class="font-semibold">{setup.kind === "supplemental" ? `Prompt ${index + 1}` : prompt.label || "Your prompt"}</h2>
                    {#each prompt.constraints.filter(c => c.unit !== "other") as constraint (constraint.id)}
                        <span class="text-xs text-black/60 whitespace-nowrap tabular-nums" aria-label="Essay length">{constraint.unit === "characters" ? section.characterCount : section.wordCount}{constraint.max !== null ? ` / ${constraint.max}` : ""} {constraint.unit}</span>
                    {/each}
                </div>
                {#if !prompt.constraints.some(c => c.unit !== "other")}<span class="text-xs text-black/60 tabular-nums" aria-label="Essay length">{section.wordCount} words · no limit</span>{/if}
                <p class="whitespace-pre-wrap leading-relaxed">{prompt.text}</p>
                {#if sources.length}<details><summary class="text-xs text-black/60">Research for this prompt ({sources.length})</summary>{#each sources as source (source.id)}<p class="text-xs mt-2">{source.summary} <a class="source-link" href={source.url} onclick={(event) => { event.preventDefault(); void openUrl(source.url); }}>{source.publisher}</a></p>{/each}</details>{/if}
                {#if prompt.sourceUrl}<a class="source-link" href={prompt.sourceUrl} onclick={(event) => { event.preventDefault(); void openUrl(prompt.sourceUrl); }}>{setup.kind === "supplemental" ? "View prompt source" : "View official prompt source"}<span aria-hidden="true"> ↗</span></a>{/if}
            </section>
        {/each}
        {#if view.sectionMode}<p class="text-xs text-black/60">Edit prompts and limits in the H1 headings. Counts include answer text only.</p>{/if}
        {#if !view.sections.length}<p class="text-xs text-black/60">No prompt headings found. Add a prompt or restore an H1 to reconnect its saved context.</p>{/if}
        {#if !setup.active}<p class="text-xs text-black/60">Paused. Feedback isn’t using this prompt.</p>{/if}
        <div class="flex flex-wrap gap-2">
            <button class="secondary" disabled={busy || view.saving || !view.canEdit} onclick={() => start(true)}>Add another prompt</button>
            <button class="link" onclick={() => start()}>Create another essay tab</button>
        </div>
        {#if view.aiEnabled && college}
            <SchoolResearch {college} view={{...view, setup: view.effectiveSetup}} />
        {/if}
        <details class="border-t border-black/10 pt-3">
            <summary class="text-xs cursor-pointer">Sources and settings</summary>
            <div class="space-y-3 pt-3 text-xs">
                {#if setup.school || setup.cycle}<p class="text-black/60">{[setup.school, setup.cycle].filter(Boolean).join(" · ")}</p>{/if}
                <div class="space-y-3">
                    {#each setup.references as ref (ref.id)}
                        <div class="source-card">
                            {#if ref.research && view.effectiveSetup && !isCollegeReferenceCurrent(ref, view.effectiveSetup)}<p class="text-amber-900 mb-2">Prompt missing or changed. Saved for recovery; excluded from AI context.</p>{/if}
                            {#if ref.url}<a class="source-link font-medium" href={ref.url} onclick={(event) => { event.preventDefault(); void openUrl(ref.url); }}>{ref.publisher}<span aria-hidden="true"> ↗</span></a>{:else}<p class="font-medium">{ref.publisher}</p>{/if}
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
