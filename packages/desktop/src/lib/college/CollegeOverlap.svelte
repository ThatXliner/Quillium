<!-- CollegeOverlap.svelte — A transient essay picker contributed to Feedback. -->
<script lang="ts">
import type { FeedbackActionProps } from "$lib/ai/feedbackActions";
import { hasApiKey } from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import { documentContent } from "$lib/stores";
import { tick } from "svelte";
import {
    type OverlapChoice,
    type OverlapPreview,
    listOverlapChoices,
    prepareOverlap,
    runOverlap,
} from "./overlap";
import { collegeState } from "./state.svelte";

let { session, disabled, onBusyChange }: FeedbackActionProps = $props();
let open = $state(false);
let choices = $state<OverlapChoice[]>([]);
let selected = $state<Record<string, string>>({});
let school = $state("");
let fixedSchool = $derived(
    collegeState.setup?.school ||
        (collegeState.setup?.kind === "uc-piq" ? "University of California" : ""),
);
let relevantChoices = $derived(
    choices.filter(
        (choice) =>
            !fixedSchool ||
            !choice.school ||
            choice.school.trim().toLowerCase() === fixedSchool.trim().toLowerCase(),
    ),
);
let loading = $state(false);
let running = $state(false);
let error = $state("");
let status = $state("");
let preview = $state.raw<OverlapPreview | null>(null);
let controller: AbortController | undefined;
let container: HTMLDivElement;
let trigger: HTMLButtonElement;
let generation = 0;

async function show(): Promise<void> {
    open = true;
    loading = true;
    error = "";
    status = "";
    school = fixedSchool;
    try {
        const result = await listOverlapChoices(session);
        if (!session.isCurrent() || !open) return;
        choices = result;
        selected = Object.fromEntries(
            result
                .filter(
                    (choice) =>
                        !choice.school ||
                        choice.school.trim().toLowerCase() === school.trim().toLowerCase(),
                )
                .slice(0, 3)
                .map((choice) => [choice.tabId, choice.selectedDraftId]),
        );
        await tick();
        container
            .querySelector<HTMLElement>('[role="dialog"] input, [role="dialog"] button')
            ?.focus();
    } catch (cause) {
        error = cause instanceof Error ? cause.message : "Could not load essays.";
    } finally {
        loading = false;
    }
}

function close(): void {
    controller?.abort();
    open = false;
    preview = null;
    generation++;
    trigger?.focus();
}

$effect(() => {
    if (!open) return;
    const selections = Object.entries(selected).map(([tabId, draftId]) => ({ tabId, draftId }));
    const scope = school;
    const text = $documentContent;
    const currentSession = session;
    const request = ++generation;
    preview = null;
    if (!selections.length || !scope.trim() || !text.trim()) return;
    let cancelled = false;
    void prepareOverlap(currentSession, selections, scope)
        .then((result) => {
            if (!cancelled && request === generation && open) {
                preview = result;
                error = "";
            }
        })
        .catch((cause) => {
            if (!cancelled && request === generation && open)
                error = String(cause instanceof Error ? cause.message : cause);
        });
    return () => {
        cancelled = true;
    };
});

$effect(() => {
    const signal = session.signal;
    const abort = () => {
        controller?.abort();
        open = false;
        generation++;
    };
    signal.addEventListener("abort", abort);
    return () => {
        signal.removeEventListener("abort", abort);
        abort();
    };
});

async function review(): Promise<void> {
    if (!preview || running) return;
    controller = new AbortController();
    const signal = controller.signal;
    running = true;
    onBusyChange(true);
    error = "";
    try {
        const result = await runOverlap(session, preview, signal);
        if (signal.aborted || !session.isCurrent()) return;
        status = result.applied
            ? `${result.applied} overlap comment${result.applied === 1 ? "" : "s"} added.`
            : "No new overlap comments.";
        if (result.skipped)
            status += ` ${result.skipped} unsupported or stale finding${result.skipped === 1 ? "" : "s"} skipped.`;
        close();
    } catch (cause) {
        if (!signal.aborted)
            error = cause instanceof Error ? cause.message : "Could not check overlap.";
    } finally {
        running = false;
        onBusyChange(false);
    }
}
</script>

<svelte:window onkeydown={(event) => { if (open && event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); } }} onclick={(event) => { if (open && event.target instanceof Node && !container.contains(event.target)) close(); }} />
<div class="relative border-b border-black/10 px-3 py-2" bind:this={container}>
    <button bind:this={trigger} class="action" aria-expanded={open} aria-haspopup="dialog" disabled={disabled || !$documentContent.trim()} onclick={() => open ? close() : show()}>Check overlap with other essays</button>
    {#if status}<p class="mt-1 text-xs text-black/60" role="status">{status}</p>{/if}
    {#if open}
        <div role="dialog" aria-label="Check essay overlap" class="picker">
            <div class="flex justify-between items-center gap-2"><strong class="font-medium">Compare with</strong><button aria-label="Close essay picker" onclick={close}>×</button></div>
            {#if loading}<p role="status">Loading essays…</p>{/if}
            {#if relevantChoices.length}
                <fieldset disabled={running} class="space-y-2">
                    {#each relevantChoices as choice (choice.tabId)}
                        <div>
                            <label class="flex gap-2 items-start">
                                <input type="checkbox" checked={!!selected[choice.tabId]} disabled={!selected[choice.tabId] && Object.keys(selected).length >= 3} onchange={(event) => { const next = { ...selected }; if (event.currentTarget.checked) next[choice.tabId] = choice.selectedDraftId; else delete next[choice.tabId]; selected = next; }} />
                                <span>{choice.tabLabel}{#if choice.school && choice.school !== school}<span class="block text-black/50">{choice.school}</span>{/if}</span>
                            </label>
                            {#if selected[choice.tabId] && choice.drafts.length > 1}
                                <select aria-label={`Draft for ${choice.tabLabel}`} value={selected[choice.tabId]} onchange={(event) => (selected = { ...selected, [choice.tabId]: event.currentTarget.value })}>
                                    {#each choice.drafts as draft (draft.id)}<option value={draft.id}>{draft.label}</option>{/each}
                                </select>
                            {:else if selected[choice.tabId]}<p class="ml-5 text-black/50">{choice.drafts[0]?.label}</p>{/if}
                        </div>
                    {/each}
                    {#if fixedSchool}<p class="text-black/60">Read together for {fixedSchool}.</p>
                    {:else}<label class="block">Read together for<input class="school" bind:value={school} placeholder="School or application" maxlength="200" /></label>{/if}
                </fieldset>
                <p class="text-black/60">Comments go on your current draft.</p>
                {#if preview?.omittedChars}<p class="text-amber-800">{preview.omittedChars.toLocaleString()} characters omitted. Only the beginnings will be compared.</p>{/if}
                {#if hasApiKey()}
                    <button class="review" disabled={!preview || running || disabled} onclick={review}>{running ? "Checking…" : "Check overlap"}</button>
                    {#if running}<button onclick={close}>Stop</button>{/if}
                {:else}<button class="review" onclick={() => appEventBus.emit({ type: "ai-open-settings" })}>Connect a model</button>{/if}
            {:else if !loading}<p>Add another College essay for this application to compare.</p>{/if}
            {#if error}<p role="alert" class="text-red-800">{error}</p>{/if}
        </div>
    {/if}
</div>

<style>
    .action { text-align:left; font-size:12px; padding:8px 10px; border-radius:8px; background:rgb(255 255 255 / .5); color:rgb(0 0 0 / .7); width:100%; }
    button { cursor:pointer; }
    button:disabled { opacity:.45; cursor:default; }
    .picker { position:absolute; top:100%; left:12px; right:12px; z-index:50; padding:14px; border-radius:12px; background:#f3f4f6; box-shadow:0 8px 24px #0002; font-size:12px; display:flex; flex-direction:column; gap:12px; max-height:min(380px,55vh); overflow-y:auto; overflow-wrap:anywhere; }
    select,.school { display:block; width:100%; padding:6px; background:#fff9; border:1px solid #0002; border-radius:5px; margin-top:5px; }
    input[type=checkbox] { margin-top:2px; accent-color:#16a34a; }
    .review { background:#15803d; color:white; padding:8px 12px; border-radius:6px; }
    button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid #15803d; outline-offset:2px; }
</style>
