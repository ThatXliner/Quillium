<!-- CollegePanel.svelte — Document-wide college tools with independent tab briefs. -->
<script lang="ts">
import { tick } from "svelte";
import type { SidebarPanelProps } from "$lib/sidebar/panels";
import { collegeSetupSchema, type CollegeSetup } from "./model";
import { COMMON_APP_PROMPTS, PRESET_LABELS, UC_PROMPTS, newCollegePrompt, newCollegeSetup } from "./presets";

let { active, session, college }: SidebarPanelProps = $props();
let view = $derived(college?.read());
let editing = $state<CollegeSetup | null>(null);
let stage = $state<"panel" | "edit" | "preview" | "remove">("panel");
let error = $state("");
let panelHeading: HTMLHeadingElement | undefined;
async function focusPanelStart(): Promise<void> {
    await tick();
    panelHeading?.focus();
}
let formTarget = $state("");
const targetKey = $derived(session ? JSON.stringify(session.target) : "");
$effect(() => {
    if (!active || targetKey !== formTarget) {
        editing = null;
        stage = "panel";
        error = "";
        formTarget = targetKey;
    }
});
function start(kind?: CollegeSetup["kind"]): void {
    editing = kind ? newCollegeSetup(kind) : JSON.parse(JSON.stringify(view?.setup));
    formTarget = targetKey;
    error = "";
    stage = "edit";
    void focusPanelStart();
}
function preview(): void {
    if (!editing) return;
    if (editing.prompts.some((prompt) => !prompt.text.trim())) {
        error = "Enter a prompt for each response before reviewing setup.";
        return;
    }
    const parsed = collegeSetupSchema.safeParse(editing);
    if (!parsed.success) {
        error = parsed.error.issues[0]?.message ?? "Check the setup fields.";
        return;
    }
    editing = parsed.data;
    error = "";
    stage = "preview";
    void focusPanelStart();
}
async function save(setup: CollegeSetup | null): Promise<void> {
    if (!college || formTarget !== targetKey) return;
    error = "";
    const savingTarget = targetKey;
    try {
        await college.save(setup);
        if (savingTarget !== targetKey) return;
        stage = "panel";
        editing = null;
        void focusPanelStart();
    } catch (cause) {
        if (savingTarget !== targetKey) return;
        error = cause instanceof Error ? cause.message : "Setup could not be saved. Try again.";
    }
}
function request(action: "prompt-fit" | "specificity" | "plan"): void {
    try { college?.request(action); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Could not start this action."; }
}
function choosePrompt(index: number): void {
    if (!editing) return;
    const options = editing.kind === "uc-piq" ? UC_PROMPTS : COMMON_APP_PROMPTS;
    const chosen = options[index];
    if (!chosen) return;
    editing.prompts[0].label = chosen.label;
    editing.prompts[0].text = chosen.text;
}
function rangeText(constraint: CollegeSetup["prompts"][number]["constraints"][number]): string {
    const bounds = constraint.min !== null && constraint.max !== null
        ? `${constraint.min}–${constraint.max}`
        : constraint.max !== null ? `At most ${constraint.max}`
        : constraint.min !== null ? `At least ${constraint.min}` : "Length unknown";
    return `${bounds} ${constraint.unit === "other" ? "" : constraint.unit}`;
}
</script>

<div class="college-panel p-4 space-y-4 text-sm text-black/80">
    <header>
        <h2 bind:this={panelHeading} tabindex="-1" class="text-base font-semibold">College applications</h2>
        {#if view?.documentId && view.tabId}
            <p class="text-xs text-black/60 mt-1" aria-label="Writing target">{view.documentLabel} · {view.tabLabel}</p>
        {/if}
    </header>
    {#if !view || !view.documentId || !view.tabId}
        <p>Open a document to get started.</p>
    {:else}
        {#if error || view.error}<p role="alert" class="rounded-lg bg-red-50 text-red-800 p-3 text-xs">{error || view.error}</p>{/if}
        {#if view.status === "loading"}
            <p role="status">Loading your prompt…</p>
        {:else if view.status === "error" || view.status === "unsupported"}
            <p class="text-xs">We couldn’t load this tab’s setup. Try again before requesting feedback.</p>
            <button class="secondary" onclick={() => college?.retry().catch((cause) => error = String(cause))}>Retry loading</button>
            {#if view.status === "unsupported"}<button class="secondary" onclick={() => stage = "remove"}>Remove unsupported setup</button>{/if}
        {/if}
        {#if stage === "remove"}
            <section class="space-y-3" aria-label="Remove setup preview">
                <h3 class="font-semibold">Remove this setup?</h3>
                <p class="text-xs">Removes this tab’s prompts and writing preferences. Your writing, shared notes, and saved decisions stay.</p>
                <div class="flex flex-wrap gap-2">
                    <button class="secondary" onclick={() => stage = "panel"} disabled={view.saving}>Cancel</button>
                    <button class="secondary text-red-700" onclick={() => save(null)} disabled={view.saving}>Remove setup</button>
                </div>
            </section>
        {:else if view.status === "ready" && stage === "panel"}
            {#if view.setup}
                {@const setup = view.setup}
                <div class="flex items-center justify-between gap-2">
                    <span class="font-medium">{setup.school || PRESET_LABELS[setup.kind]}</span>
                    <button class="text-link" onclick={() => start()}>Edit setup</button>
                </div>
                {#if !setup.active}<p class="text-xs">Paused. Resume when you want feedback to use this prompt.</p><button class="secondary" disabled={view.saving} onclick={() => save({...setup, active: true})}>Resume setup</button>{/if}
                {#each setup.prompts as prompt (prompt.id)}
                    <section class="rounded-lg bg-white/60 p-3 space-y-2">
                        <h3 class="font-semibold text-xs">{prompt.label || "Your prompt"}</h3>
                        <p class="whitespace-pre-wrap text-sm leading-relaxed">{prompt.text}</p>
                        {#each prompt.constraints as constraint (constraint.id)}<p class="text-xs text-black/60">{rangeText(constraint)}</p>{/each}
                        {#if !prompt.constraints.length}<p class="text-xs text-black/60">No length limit set</p>{/if}
                    </section>
                {/each}
                {#if setup.intent}<div><h3 class="font-medium text-xs">What I want to convey</h3><p class="text-sm whitespace-pre-wrap mt-1">{setup.intent}</p></div>{/if}
                {#if view.aiEnabled}
                    <section class="space-y-2" aria-label="College writing actions">
                        {#if view.hasProse}
                            <button class="primary w-full" disabled={!setup.active || !view.canRequest || view.saving} onclick={() => request("prompt-fit")}>Check prompt fit</button>
                        {:else}
                            <button class="primary w-full" disabled={!setup.active || !view.canRequest || view.saving} onclick={() => request("plan")}>Help me get started</button>
                        {/if}
                        {#if setup.feedbackReaders && view.requestCount > 1}<p class="text-xs text-black/60">Feedback uses {view.requestCount} reader requests.</p>{/if}
                        {#if !view.canRequest}<p class="text-xs text-black/60">Connect a model in Settings when you’re ready for AI help.</p>{/if}
                        <details>
                            <summary class="text-link">More ways to get help</summary>
                            <div class="space-y-2 pt-2">
                                <button class="action" disabled={!setup.active || !view.canRequest || !view.hasProse || view.saving} onclick={() => request("specificity")}>Find claims that need examples</button>
                                {#if view.hasProse}<button class="action" disabled={!setup.active || !view.canRequest || view.saving} onclick={() => request("plan")}>Help me plan an answer</button>{/if}
                            </div>
                        </details>
                    </section>
                {/if}
                <details class="border-t border-black/10 pt-3">
                    <summary class="text-link">More options</summary>
                    <div class="space-y-3 pt-3">
                        <p class="text-xs text-black/60">This setup is shared by the drafts in {view.tabLabel}. Other tabs have their own prompts.</p>
                        <p class="text-xs">Cycle: {setup.cycle || "Not set"} · Current draft: {view.draftLabel}</p>
                        {#if setup.feedbackFocus}<p class="text-xs">Feedback focus: {setup.feedbackFocus}</p>{/if}
                        {#each setup.prompts as prompt (prompt.id)}
                            {#if prompt.sourceUrl}<a href={prompt.sourceUrl} target="_blank" rel="noreferrer" class="source-link block text-xs">{prompt.label || "Prompt"} · original source</a>{/if}
                            {#each prompt.constraints as constraint (constraint.id)}{#if constraint.detail}<p class="text-xs">{constraint.detail}</p>{/if}{/each}
                        {/each}
                        {@render references(setup)}
                        {#if view.sharedBrief}<p class="text-xs whitespace-pre-wrap">{view.sharedBrief}</p>{/if}
                        {#if view.decisions.length}<p class="text-xs">{view.decisions.length} saved decision{view.decisions.length === 1 ? "" : "s"}.</p>{/if}
                        {#if view.aiEnabled}<div class="flex flex-wrap gap-2">
                            <button class="secondary" onclick={() => college?.openPanel("context")}>Context</button>
                            <button class="secondary" onclick={() => college?.openPanel("readers")}>Readers</button>
                            <button class="secondary" onclick={() => college?.openPanel("settings")}>Settings</button>
                        </div>{/if}
                        <div class="flex flex-wrap gap-2">
                            {#if setup.active}<button class="secondary" disabled={view.saving} onclick={() => save({...setup, active: false})}>Pause setup</button>{/if}
                            <button class="text-link text-red-700" onclick={() => stage = "remove"}>Remove setup…</button>
                        </div>
                        <p class="text-xs text-black/60">Pause to stop using this setup in feedback. Closing the panel keeps it active.</p>
                    </div>
                </details>
            {:else}
                <div class="space-y-1"><h3 class="font-medium">What are you working on?</h3><p class="text-sm text-black/60">Choose a starting point. You can change it later.</p></div>
                <div class="space-y-2">
                    {#each Object.entries(PRESET_LABELS) as [kind, label]}
                        <button class="action" aria-label={label} onclick={() => start(kind as CollegeSetup["kind"])}>
                            <span class="block font-semibold">{label}</span>
                            <span class="block text-xs text-black/60 mt-1">{kind === "uc-piq" ? "Choose a UC personal insight question" : kind === "common-app" ? "Start your Common App essay" : "Add a school’s own essay prompt"}</span>
                        </button>
                    {/each}
                </div>
            {/if}
        {:else if editing && (stage === "edit" || stage === "preview")}
            {#if stage === "edit"}
                <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); preview(); }}>
                    <h3 class="font-semibold">{PRESET_LABELS[editing.kind]}</h3>
                    {#if editing.kind === "supplemental"}<label>School or application system<input maxlength="200" bind:value={editing.school} placeholder="Which school?" /></label>{/if}
                    {#if editing.kind !== "supplemental"}
                        <label>Choose a prompt
                            <select value={(editing.kind === "uc-piq" ? UC_PROMPTS : COMMON_APP_PROMPTS).findIndex(option => option.text === editing?.prompts[0]?.text)} onchange={(event) => choosePrompt(Number(event.currentTarget.value))}>
                                <option value="-1">Custom prompt</option>
                                {#each editing.kind === "uc-piq" ? UC_PROMPTS : COMMON_APP_PROMPTS as option, index}<option value={index}>{option.label}</option>{/each}
                            </select>
                        </label>
                    {/if}
                    {#each editing.prompts as prompt, index (prompt.id)}
                        <fieldset class="space-y-3">
                            {#if editing.prompts.length > 1}<legend class="font-medium text-xs mb-2">Prompt {index + 1}</legend>{/if}
                            <label>Prompt<textarea rows="3" maxlength="4000" bind:value={prompt.text} required placeholder="Paste your essay question"></textarea></label>
                            {#if prompt.constraints[0]}
                                {@const limit = prompt.constraints[0]}
                                <div class="grid grid-cols-2 gap-2">
                                    <label>Maximum<input type="number" min="0" step="1" value={limit.max ?? ""} placeholder="Not sure yet" oninput={(event) => limit.max = event.currentTarget.value === "" ? null : Number(event.currentTarget.value)} /></label>
                                    <label>Count in<select aria-label="Constraint unit" bind:value={limit.unit}><option value="words">Words</option><option value="characters">Characters</option><option value="other">Other</option></select></label>
                                </div>
                            {/if}
                            <details>
                                <summary class="text-link">Prompt details</summary>
                                <div class="space-y-3 pt-3">
                                    <label>Response label<input maxlength="200" bind:value={prompt.label} /></label>
                                    <label>Prompt source URL (optional)<input type="url" maxlength="2000" bind:value={prompt.sourceUrl} placeholder="https://…" /></label>
                                    {#each prompt.constraints as constraint, constraintIndex (constraint.id)}
                                        <div class="space-y-2">
                                            {#if constraintIndex > 0}
                                                <label>Constraint unit<select bind:value={constraint.unit}><option value="words">Words</option><option value="characters">Characters</option><option value="other">Other requirement</option></select></label>
                                                <label>Maximum<input type="number" min="0" step="1" value={constraint.max ?? ""} oninput={(event) => constraint.max = event.currentTarget.value === "" ? null : Number(event.currentTarget.value)} /></label>
                                            {/if}
                                            <label>Minimum<input type="number" min="0" step="1" value={constraint.min ?? ""} oninput={(event) => constraint.min = event.currentTarget.value === "" ? null : Number(event.currentTarget.value)} /></label>
                                            <label>Constraint details<textarea rows="2" maxlength="500" bind:value={constraint.detail}></textarea></label>
                                            <button type="button" class="text-link" onclick={() => prompt.constraints.splice(constraintIndex, 1)}>Remove constraint</button>
                                        </div>
                                    {/each}
                                    <button type="button" class="secondary" disabled={prompt.constraints.length >= 8} onclick={() => prompt.constraints.push({id: crypto.randomUUID(), unit: "words", min: null, max: null, detail: ""})}>Add constraint</button>
                                    {#if editing.prompts.length > 1}<button type="button" class="text-link" onclick={() => editing?.prompts.splice(index, 1)}>Remove response</button>{/if}
                                </div>
                            </details>
                        </fieldset>
                    {/each}
                    <label>What I want to convey<textarea rows="2" maxlength="2000" bind:value={editing.intent} placeholder="An experience, a quality, or an idea (optional)"></textarea></label>
                    <details>
                        <summary class="text-link">More options</summary>
                        <div class="space-y-4 pt-3">
                            <button type="button" class="secondary" disabled={editing.prompts.length >= 12} onclick={() => editing?.prompts.push(newCollegePrompt())}>Add another prompt</button>
                            <label>Application cycle<input maxlength="100" bind:value={editing.cycle} placeholder="Not set" /></label>
                            {#if editing.kind !== "supplemental"}<label>School or application system<input maxlength="200" bind:value={editing.school} /></label>{/if}
                            <label>Program (optional)<input maxlength="200" bind:value={editing.program} /></label>
                            <label>What I want feedback on<textarea rows="2" maxlength="2000" bind:value={editing.feedbackFocus}></textarea></label>
                                                <fieldset class="space-y-3"><legend class="font-semibold text-xs mb-2">Editorial approach for this tab</legend>
                        <label>Stance<select bind:value={editing.preferences.stance}><option value="author-first">Author-first</option><option value="collaborative">Collaborative</option><option value="exploratory">Exploratory</option></select></label>
                        <label>Feedback density<select bind:value={editing.preferences.feedbackDensity}><option value="quiet">Quiet</option><option value="focused">Focused</option><option value="thorough">Thorough</option></select></label>
                        <label>Voice latitude<select bind:value={editing.preferences.voiceLatitude}><option value="preserve">Preserve</option><option value="adapt">Adapt</option><option value="transform">Transform</option></select></label>
                    </fieldset>
                    <fieldset class="space-y-2"><legend class="font-semibold text-xs mb-2">Optional readers</legend>
                        {#each editing.readers as reader (reader.id)}<label class="check"><input type="checkbox" bind:checked={reader.enabled} /><span>{reader.name}<small class="block text-black/60">{reader.description}</small></span></label>{/each}
                        <label class="check"><input type="checkbox" bind:checked={editing.feedbackReaders} />Use selected readers for Feedback</label>
                        <p class="text-xs text-black/60">{editing.feedbackReaders ? Math.max(1, editing.readers.filter((reader) => reader.enabled).length) : 1} request(s) per Feedback action. Applying setup does not enable AutoAI.</p>
                    </fieldset>

                        </div>
                    </details>
                    <div class="flex gap-2"><button type="button" class="secondary" onclick={() => { editing = null; stage = "panel"; }}>Cancel</button><button class="primary flex-1" type="submit">Review setup</button></div>
                </form>
            {:else}
                <section class="space-y-3" aria-label="Setup preview">
                    <h3 class="font-semibold">Ready to write?</h3>
                    <p class="text-xs text-black/60">Your prompt for {view.tabLabel}.</p>
                    {#each editing.prompts as prompt (prompt.id)}
                        <div class="rounded-lg bg-white/60 p-3 space-y-2"><p class="text-sm whitespace-pre-wrap">{prompt.text}</p>{#each prompt.constraints as constraint}<p class="text-xs text-black/60">{rangeText(constraint)}</p>{/each}{#if !prompt.constraints.length}<p class="text-xs">No length limit set</p>{/if}</div>
                    {/each}
                    {#if editing.intent}<p class="text-sm whitespace-pre-wrap">{editing.intent}</p>{/if}
                    <p class="text-xs text-black/60">Check the exact prompt and limit in your application before submitting.</p>
                    <div class="flex flex-wrap gap-2"><button class="secondary" disabled={view.saving} onclick={() => stage = "edit"}>Back</button><button class="primary flex-1" disabled={view.saving} onclick={() => save(editing)}>{view.saving ? "Saving…" : "Use this prompt"}</button></div>
                    <button class="text-link" disabled={view.saving} onclick={() => { editing = null; stage = "panel"; }}>Cancel</button>
                    <details>
                        <summary class="text-link">Setup details and sources</summary>
                        <div class="space-y-3 pt-3">
                            <p class="text-xs">Applies to the drafts in this tab. Your writing, shared notes, and saved decisions stay.</p>
                            <p class="text-xs">Cycle: {editing.cycle || "Not set"} · {editing.school || "School not set"}</p>
                            <p class="text-xs">{editing.preferences.stance} · {editing.preferences.feedbackDensity} · {editing.preferences.voiceLatitude}</p>
                            <p class="text-xs">Feedback uses {editing.feedbackReaders ? Math.max(1, editing.readers.filter((reader) => reader.enabled).length) : 1} request(s).</p>
                            {@render references(editing)}
                        </div>
                    </details>
                </section>
            {/if}
        {/if}
    {/if}
</div>

{#snippet references(setup: CollegeSetup)}
    <details class="rounded-lg bg-white/50 p-3">
        <summary class="cursor-pointer font-medium text-xs">Accepted guidance and sources ({setup.references.length})</summary>
        <div class="space-y-3 mt-3">
            {#each setup.references as reference (reference.id)}
                <section class="space-y-1 text-xs">
                    <h4 class="font-semibold">{reference.kind === "requirement" ? "Official requirement" : reference.kind === "official-advice" ? "Official advice" : "Quillium editorial guidance"}</h4>
                    <p>{reference.summary}</p>
                    <p class="text-black/60">{reference.publisher} · Cycle: {reference.cycle || "Unknown"} · Checked: {reference.checkedDate || "Unknown"}</p>
                    {#if reference.url}<a class="source-link break-all" href={reference.url} target="_blank" rel="noreferrer">View source</a>{/if}
                </section>
            {/each}
            <p class="text-xs text-black/60">Saved guidance is a snapshot. It does not refresh silently. Verify current requirements in the application before submitting.</p>
        </div>
    </details>
{/snippet}

<style>
    .college-panel label { display: flex; flex-direction: column; gap: .35rem; font-size: .75rem; font-weight: 500; }
    .college-panel label.check { flex-direction: row; align-items: flex-start; gap: .5rem; font-weight: 400; }
    .college-panel input:not([type="checkbox"]), .college-panel textarea, .college-panel select { width: 100%; min-width: 0; padding: .5rem; border: 1px solid rgb(0 0 0 / .15); border-radius: .4rem; background: rgb(255 255 255 / .8); font-size: .75rem; }
    .college-panel input[type="checkbox"] { margin-top: .15rem; flex-shrink: 0; }
    .college-panel button { cursor: pointer; }
    .college-panel button:disabled { opacity: .45; cursor: default; }
    .secondary, .primary { padding: .45rem .65rem; border-radius: .4rem; font-size: .75rem; border: 1px solid rgb(0 0 0 / .12); }
    .secondary { background: rgb(255 255 255 / .6); }
    .primary { background: #2563eb; color: white; }
    .action { width: 100%; text-align: left; padding: .7rem; border: 1px solid rgb(0 0 0 / .1); border-radius: .5rem; background: rgb(255 255 255 / .7); font-size: .8rem; }
    .text-link { font-size: .75rem; color: #374151; cursor: pointer; text-underline-offset: 3px; }
    button.text-link:hover { text-decoration: underline; }
    .source-link { color: #1d4ed8; text-decoration: underline; }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
</style>
