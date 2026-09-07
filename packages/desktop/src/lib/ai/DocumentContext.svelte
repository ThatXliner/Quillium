<!--
    DocumentContext.svelte — Writer's document-context panel.

    A freeform writer brief plus explicit, removable editorial decisions.
    The brief can describe the goal, audience, tone, constraints, and emphasis.

    Also supports AI generation: paste a writing prompt or brief and
    click "Generate context" to have the LLM populate the textarea.

    State persisted per document in SQLite via saveDocumentContext.
-->
<script lang="ts">
import { generateContext } from "$lib/ai/clientStreams";
import {
    aiSettings,
    beginAiTask,
    documentContext,
    endAiTask,
    ensureApiKeyLoaded,
    getAiAbortSignal,
    hasApiKey,
    saveDocumentContext,
} from "$lib/ai/settings.svelte";
import posthog from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import type { SidebarPanelProps } from "$lib/sidebar/panels";
import { currentDocumentId } from "$lib/stores";
import { SparklesIcon } from "lucide-svelte";
import { get } from "svelte/store";

// Built-in request adapters retain their existing lifecycle and validated operations.
let { active: _active, session: _session }: SidebarPanelProps = $props();

let promptInput = $state("");
let decisionInput = $state("");
let generating = $state(false);
let generateError = $state("");

$effect(() => {
    $currentDocumentId;
    promptInput = "";
    decisionInput = "";
    generateError = "";
});

async function generate() {
    if (!promptInput.trim() || generating || !appSettings.aiEnabled || !hasApiKey()) return;
    generating = true;
    generateError = "";
    const task = beginAiTask("document-context");
    const abortSignal = getAiAbortSignal();
    const documentId = get(currentDocumentId);
    try {
        await ensureApiKeyLoaded();
        if (abortSignal.aborted) return;
        const generated = await generateContext({
            prompt: promptInput,
            provider: aiSettings.provider,
            model: aiSettings.model,
            apiKey: aiSettings.apiKey,
            abortSignal,
        });
        if (abortSignal.aborted || get(currentDocumentId) !== documentId) return;
        documentContext.freeform = generated;
        saveDocumentContext();
    } catch (e) {
        if (!abortSignal.aborted) generateError = String(e);
    } finally {
        generating = false;
        endAiTask(task);
    }
}

function clearAll() {
    posthog.capture("context_cleared");
    documentContext.freeform = "";
    promptInput = "";
    saveDocumentContext();
}

function addDecision(event: SubmitEvent) {
    event.preventDefault();
    const decision = decisionInput.trim();
    if (!decision) return;
    if (
        documentContext.decisions.some(
            (existing) => existing.toLocaleLowerCase() === decision.toLocaleLowerCase(),
        )
    ) {
        decisionInput = "";
        return;
    }
    documentContext.decisions = [...documentContext.decisions, decision];
    decisionInput = "";
    saveDocumentContext();
    posthog.capture("editorial_decision_saved");
}

function removeDecision(index: number) {
    documentContext.decisions = documentContext.decisions.filter(
        (_decision, decisionIndex) => decisionIndex !== index,
    );
    saveDocumentContext();
    posthog.capture("editorial_decision_removed");
}
</script>

<div class="flex flex-col h-full overflow-y-auto">
    <!-- Prompt input section -->
    <div class="p-3 border-b border-black/10 flex flex-col gap-2">
        <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider">
            Writing Prompt or Brief
        </p>
        <textarea
            bind:value={promptInput}
            placeholder="Paste your essay prompt, assignment, or brief here and the AI will generate context below…"
            rows={4}
            class="w-full resize-none rounded-lg bg-white/50 border border-black/10 px-2.5 py-2
                text-xs text-black/70 placeholder:text-black/25 outline-none leading-relaxed
                focus:border-blue-400 transition-colors"
        ></textarea>
        <button
            onclick={generate}
            disabled={!promptInput.trim() || generating || !appSettings.aiEnabled || !hasApiKey()}
            class="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-colors
                {generating
                    ? 'bg-blue-500/10 text-blue-600/60 cursor-wait'
                    : 'bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 disabled:opacity-40 disabled:cursor-not-allowed'}"
        >
            {#if generating}
                <span class="inline-block animate-pulse">●</span>
                Analyzing…
            {:else}
                <SparklesIcon size={12} />
                Generate context
            {/if}
        </button>
        {#if generateError}
            <p class="text-[10px] text-red-600/80 leading-relaxed">{generateError}</p>
        {/if}
        {#if !aiSettings.apiKey}
            <p class="text-[10px] text-black/35 leading-relaxed">Set an API key in settings to generate context automatically.</p>
        {/if}
    </div>

    <!-- Freeform context textarea -->
    <div class="flex flex-col gap-2 p-3 pb-4">
        <div class="flex items-center justify-between">
            <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider">
                Document Context
            </p>
            {#if documentContext.freeform.trim()}
                <button
                    onclick={clearAll}
                    class="text-[10px] text-black/30 hover:text-red-500/70 transition-colors"
                >
                    Clear
                </button>
            {/if}
        </div>
        <textarea
            bind:value={documentContext.freeform}
            onblur={saveDocumentContext}
            placeholder="Describe whatever context is relevant to this piece — what it needs to accomplish, who's reading it, the tone to aim for, what to emphasize or avoid, any constraints. E.g: Goal: … / Audience: … / Tone: …"
            rows={9}
            class="w-full resize-none rounded-lg bg-white/50 border border-black/10 px-2.5 py-2
                text-xs text-black/70 placeholder:text-black/20 outline-none leading-relaxed
                focus:border-blue-400/60 transition-colors"
        ></textarea>
    </div>

    <div class="flex flex-col gap-2 border-t border-black/10 p-3 pb-4">
        <div>
            <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider">
                Saved Editorial Decisions
            </p>
            <p class="mt-0.5 text-[10px] leading-relaxed text-black/35">
                Explicit choices the AI should respect for this document.
            </p>
        </div>

        {#if documentContext.decisions.length > 0}
            <ul class="space-y-1.5" aria-label="Saved editorial decisions">
                {#each documentContext.decisions as decision, index (`${index}:${decision}`)}
                    <li
                        class="flex items-start gap-2 rounded-lg border border-black/10 bg-white/50 px-2.5 py-2"
                    >
                        <span class="min-w-0 flex-1 text-xs leading-relaxed text-black/65">
                            {decision}
                        </span>
                        <button
                            type="button"
                            onclick={() => removeDecision(index)}
                            aria-label={`Remove decision: ${decision}`}
                            class="shrink-0 text-[10px] text-black/30 transition-colors hover:text-red-500/70"
                        >
                            Remove
                        </button>
                    </li>
                {/each}
            </ul>
        {:else}
            <p class="rounded-lg bg-black/[0.025] px-2.5 py-2 text-[10px] text-black/30">
                No decisions saved yet.
            </p>
        {/if}

        <form class="flex gap-1.5" onsubmit={addDecision}>
            <input
                bind:value={decisionInput}
                aria-label="New editorial decision"
                maxlength="500"
                placeholder="Keep the ending unresolved"
                class="min-w-0 flex-1 rounded-lg border border-black/10 bg-white/50 px-2.5 py-1.5 text-xs text-black/70 outline-none placeholder:text-black/25 focus:border-blue-400/60"
            />
            <button
                type="submit"
                disabled={!decisionInput.trim()}
                class="rounded-lg bg-blue-500/15 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
                Save
            </button>
        </form>
    </div>
</div>
