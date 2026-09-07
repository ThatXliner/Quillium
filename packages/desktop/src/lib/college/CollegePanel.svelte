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
let acknowledged = $state(false);
let formTarget = $state("");
const targetKey = $derived(session ? JSON.stringify(session.target) : "");
$effect(() => {
    if (!active || targetKey !== formTarget) {
        editing = null;
        stage = "panel";
        error = "";
        acknowledged = false;
        formTarget = targetKey;
    }
});
function start(kind?: CollegeSetup["kind"]): void {
    editing = kind ? newCollegeSetup(kind) : JSON.parse(JSON.stringify(view?.setup));
    formTarget = targetKey;
    acknowledged = false;
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
    return `${bounds} ${constraint.unit === "other" ? "" : constraint.unit}${constraint.detail ? ` · ${constraint.detail}` : ""}`;
}
</script>

<div class="college-panel p-4 space-y-4 text-sm text-black/80">
    <header>
        <h2 bind:this={panelHeading} tabindex="-1" class="text-base font-semibold">College applications</h2>
        <p class="text-xs text-black/60 mt-1">One document, independent writing briefs for each tab.</p>
    </header>
    {#if !view || !view.documentId || !view.tabId}
        <p>Open a document and a writing tab to begin.</p>
    {:else}
        <section class="rounded-lg bg-white/60 p-3 space-y-1" aria-label="Writing target">
            <p class="text-xs text-black/60">{view.documentLabel}</p>
            <h3 class="font-semibold break-words">{view.tabLabel}</h3>
            <p class="text-xs text-black/60">Current draft: {view.draftLabel}</p>
            <p class="text-xs">This brief applies to every draft and run in this tab. To change the target, choose another document tab.</p>
        </section>
        {#if error || view.error}<p role="alert" class="rounded-lg bg-red-50 text-red-800 p-3 text-xs">{error || view.error}</p>{/if}
        {#if view.status === "loading"}
            <p role="status">Loading this tab's setup…</p>
        {:else if view.status === "error" || view.status === "unsupported"}
            <p class="text-xs">This setup is unavailable. Editorial requests are paused so they cannot use incomplete context.</p>
            <button class="secondary" onclick={() => college?.retry().catch((cause) => error = String(cause))}>Retry loading</button>
            {#if view.status === "unsupported"}
                <button class="secondary" onclick={() => stage = "remove"}>Remove unsupported setup</button>
            {/if}
        {/if}
        {#if stage === "remove"}
            <section class="space-y-3 rounded-lg border border-red-200 bg-white/70 p-3" aria-label="Remove setup preview">
                <h3 class="font-semibold">Remove this tab's setup?</h3>
                <p class="text-xs">This removes its prompts, constraints, accepted guidance, readers, and editorial overrides. Shared writer notes, saved decisions, draft prose, and annotations stay in place. Other tabs keep their setups.</p>
                <div class="flex flex-wrap gap-2">
                    <button class="secondary" onclick={() => stage = "panel"} disabled={view.saving}>Cancel</button>
                    <button class="secondary text-red-700" onclick={() => save(null)} disabled={view.saving}>Remove setup</button>
                </div>
            </section>
        {:else if view.status === "ready" && stage === "panel"}
            {#if view.setup}
                {@const setup = view.setup}
                <div class="flex flex-wrap gap-2 items-center">
                    <span class="font-medium">{PRESET_LABELS[setup.kind]}</span>
                    <span class="text-xs text-black/60">{setup.active ? "Active for this tab" : "Paused"}</span>
                </div>
                <p class="text-xs text-black/60">Cycle: {setup.cycle || "Unknown; verify in your application"}</p>
                {#if setup.school}<p>{setup.school}{setup.program ? ` · ${setup.program}` : ""}</p>{/if}
                {#each setup.prompts as prompt (prompt.id)}
                    <section class="rounded-lg bg-white/70 p-3 space-y-2">
                        <h3 class="font-semibold">{prompt.label || "Prompt"}</h3>
                        <p class="whitespace-pre-wrap text-xs leading-relaxed">{prompt.text}</p>
                        {#if prompt.sourceUrl}<a href={prompt.sourceUrl} target="_blank" rel="noreferrer" class="source-link">Prompt source · writer verification required</a>{/if}
                        {#if prompt.constraints.length === 0}<p class="text-xs text-black/60">Length limit unknown</p>{/if}
                        {#each prompt.constraints as constraint (constraint.id)}<p class="text-xs text-black/60">{rangeText(constraint)}</p>{/each}
                    </section>
                {/each}
                {#if setup.intent}<div><h3 class="font-medium text-xs">What I want to convey</h3><p class="text-xs whitespace-pre-wrap mt-1">{setup.intent}</p></div>{/if}
                {#if setup.feedbackFocus}<div><h3 class="font-medium text-xs">Feedback focus</h3><p class="text-xs whitespace-pre-wrap mt-1">{setup.feedbackFocus}</p></div>{/if}
                <p class="text-xs">{setup.preferences.stance} · {setup.preferences.feedbackDensity} · {setup.preferences.voiceLatitude}</p>
                {#if view.aiEnabled}
                <section class="space-y-2" aria-label="College writing actions">
                    <p class="text-xs text-black/60">Feedback: {view.requestCount} request{view.requestCount === 1 ? "" : "s"} per action. Planning: 1 Chat request.</p>
                    <button class="action" disabled={!setup.active || !view.canRequest || !view.hasProse || view.saving} onclick={() => request("prompt-fit")}>Check prompt fit</button>
                    <button class="action" disabled={!setup.active || !view.canRequest || !view.hasProse || view.saving} onclick={() => request("specificity")}>Find claims that need examples</button>
                    <button class="action" disabled={!setup.active || !view.canRequest || view.saving} onclick={() => request("plan")}>Help me plan an answer</button>
                    {#if !view.canRequest}<p class="text-xs text-black/60">Connect a model in Settings to use these actions. Setup and guidance work without one.</p>{/if}
                    {#if !view.hasProse}<p class="text-xs text-black/60">Write some draft text to request Feedback. You can plan an answer with an empty draft.</p>{/if}
                </section>
                {/if}
                <div class="flex flex-wrap gap-2">
                    <button class="secondary" onclick={() => start()}>Edit setup</button>
                    <button class="secondary" disabled={view.saving} onclick={() => save({ ...setup, active: !setup.active })}>{setup.active ? "Pause setup" : "Resume setup"}</button>
                    <button class="secondary" onclick={() => stage = "remove"}>Remove setup…</button>
                </div>
                <p class="text-xs text-black/60">Hiding this panel keeps active guidance in requests. Pause setup to exclude it. Disabling the plugin also excludes it.</p>
                {@render references(setup)}
            {:else}
                <p class="text-xs leading-relaxed">Choose a starting point for this tab. Review the prompts, constraints, and sources before applying. No AI requests are made during setup.</p>
                <div class="space-y-2">
                    {#each Object.entries(PRESET_LABELS) as [kind, label]}
                        <button class="action" onclick={() => start(kind as CollegeSetup["kind"])}>{label}</button>
                    {/each}
                </div>
            {/if}
            <section class="space-y-2 border-t border-black/10 pt-3">
                <h3 class="font-medium text-xs">Shared document context</h3>
                <p class="text-xs whitespace-pre-wrap">{view.sharedBrief || "No shared writer notes yet."}</p>
                <p class="text-xs text-black/60">{view.decisions.length} saved decision{view.decisions.length === 1 ? "" : "s"}. These stay separate from setup.</p>
                {#if view.aiEnabled}
                <div class="flex flex-wrap gap-2">
                    <button class="secondary" onclick={() => college?.openPanel("context")}>Context</button>
                    <button class="secondary" onclick={() => college?.openPanel("readers")}>Readers</button>
                    <button class="secondary" onclick={() => college?.openPanel("settings")}>Settings</button>
                </div>
                {/if}
            </section>
        {:else if editing && (stage === "edit" || stage === "preview")}
            {#if stage === "edit"}
                <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); preview(); }}>
                    <h3 class="font-semibold">Set up {PRESET_LABELS[editing.kind]}</h3>
                    <label>Application cycle<input maxlength="100" bind:value={editing.cycle} placeholder="Unknown until verified" /></label>
                    <label>School or application system<input maxlength="200" bind:value={editing.school} placeholder="School name" /></label>
                    <label>Program (optional)<input maxlength="200" bind:value={editing.program} /></label>
                    {#if editing.kind !== "supplemental"}
                        <label>Start from a prompt summary
                            <select onchange={(event) => choosePrompt(Number(event.currentTarget.value))}>
                                <option value="-1">Choose a summary…</option>
                                {#each editing.kind === "uc-piq" ? UC_PROMPTS : COMMON_APP_PROMPTS as option, index}<option value={index}>{option.label}</option>{/each}
                            </select>
                        </label>
                        <p class="text-xs text-black/60">Summaries are paraphrases. Check the linked source and paste the exact prompt from your application when wording matters.</p>
                    {/if}
                    {#each editing.prompts as prompt, index (prompt.id)}
                        <fieldset class="rounded-lg bg-white/60 p-3 space-y-3">
                            <legend class="text-xs font-semibold px-1">Response {index + 1}</legend>
                            <label>Response label<input maxlength="200" bind:value={prompt.label} /></label>
                            <label>Prompt<textarea rows="4" maxlength="4000" bind:value={prompt.text} required></textarea></label>
                            <label>Prompt source URL (optional)<input type="url" maxlength="2000" bind:value={prompt.sourceUrl} placeholder="https://…" /></label>
                            {#each prompt.constraints as constraint, constraintIndex (constraint.id)}
                                <div class="space-y-2 border-t border-black/10 pt-2">
                                    <label>Constraint unit<select bind:value={constraint.unit}><option value="words">Words</option><option value="characters">Characters</option><option value="other">Other requirement</option></select></label>
                                    <div class="grid grid-cols-2 gap-2">
                                        <label>Minimum<input type="number" min="0" step="1" value={constraint.min ?? ""} oninput={(event) => constraint.min = event.currentTarget.value === "" ? null : Number(event.currentTarget.value)} /></label>
                                        <label>Maximum<input type="number" min="0" step="1" value={constraint.max ?? ""} oninput={(event) => constraint.max = event.currentTarget.value === "" ? null : Number(event.currentTarget.value)} /></label>
                                    </div>
                                    <label>Constraint details<textarea rows="2" maxlength="500" bind:value={constraint.detail} placeholder="Leave unknown limits blank"></textarea></label>
                                    <button type="button" class="secondary" onclick={() => prompt.constraints.splice(constraintIndex, 1)}>Remove constraint</button>
                                </div>
                            {/each}
                            <button type="button" class="secondary" disabled={prompt.constraints.length >= 8} onclick={() => prompt.constraints.push({id: crypto.randomUUID(), unit: "words", min: null, max: null, detail: ""})}>Add constraint</button>
                            {#if editing.prompts.length > 1}<button type="button" class="secondary" onclick={() => editing?.prompts.splice(index, 1)}>Remove response</button>{/if}
                        </fieldset>
                    {/each}
                    <button type="button" class="secondary" disabled={editing.prompts.length >= 12} onclick={() => editing?.prompts.push(newCollegePrompt())}>Add another prompt</button>
                    <label>What I want to convey<textarea rows="3" maxlength="2000" bind:value={editing.intent}></textarea></label>
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
                    <div class="flex flex-wrap gap-2"><button type="button" class="secondary" onclick={() => { editing = null; stage = "panel"; }}>Cancel</button><button class="primary" type="submit">Review setup</button></div>
                </form>
            {:else}
                <section class="space-y-3" aria-label="Setup preview">
                    <h3 class="font-semibold">Review setup for {view.tabLabel}</h3>
                    <p class="text-xs">Applies to this tab's drafts and runs. Other tabs keep their own briefs. Device defaults, shared notes, and saved decisions stay unchanged.</p>
                    <p class="text-xs">Cycle: {editing.cycle || "Unknown"} · {editing.school || "School not specified"}</p>
                    {#each editing.prompts as prompt (prompt.id)}
                        <div class="rounded-lg bg-white/70 p-3 space-y-2"><h4 class="font-medium">{prompt.label || "Prompt"}</h4><p class="text-xs whitespace-pre-wrap">{prompt.text}</p>{#each prompt.constraints as constraint}<p class="text-xs text-black/60">{rangeText(constraint)}</p>{/each}{#if !prompt.constraints.length}<p class="text-xs">Limit unknown</p>{/if}</div>
                    {/each}
                    <p class="text-xs whitespace-pre-wrap">Intent: {editing.intent || "Not specified"}</p>
                    <p class="text-xs whitespace-pre-wrap">Feedback focus: {editing.feedbackFocus || "Not specified"}</p>
                    <p class="text-xs">{editing.preferences.stance} · {editing.preferences.feedbackDensity} · {editing.preferences.voiceLatitude}</p>
                    <p class="text-xs">Readers: {editing.readers.filter((reader) => reader.enabled).map((reader) => reader.name).join(", ") || "None"}. Feedback uses {editing.feedbackReaders ? Math.max(1, editing.readers.filter((reader) => reader.enabled).length) : 1} request(s). Planning uses 1.</p>
                    {@render references(editing)}
                    <label class="check"><input type="checkbox" bind:checked={acknowledged} />I have reviewed the prompt summaries, unknown limits, cycle, and source dates.</label>
                    <div class="flex flex-wrap gap-2"><button class="secondary" disabled={view.saving} onclick={() => stage = "edit"}>Back</button><button class="secondary" disabled={view.saving} onclick={() => { editing = null; stage = "panel"; }}>Cancel</button><button class="primary" disabled={!acknowledged || view.saving} onclick={() => save(editing)}>{view.saving ? "Saving…" : "Apply to this tab"}</button></div>
                    <p class="text-xs text-black/60">No AI request is made when you apply.</p>
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
    .source-link { color: #1d4ed8; text-decoration: underline; }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
</style>
