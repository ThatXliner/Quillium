<!--
    DocumentContext.svelte — Writer's document-context panel.

    A single freeform textarea where the writer can describe whatever
    is relevant: goal, audience, tone, constraints, what to emphasize,
    what to avoid. The placeholder suggests a structure but doesn't
    enforce it.

    Also supports AI generation: paste a writing prompt or brief and
    click "Generate context" to have the LLM populate the textarea.

    State persisted to localStorage via saveDocumentContext.
-->
<script lang="ts">
import { SparklesIcon } from "lucide-svelte";
import posthog from "$lib/posthog";
import { documentContext, saveDocumentContext, aiSettings, setAiProcessing, ensureApiKeyLoaded } from "$lib/ai/settings.svelte";
import { generateContext } from "$lib/ai/clientStreams";

let promptInput = $state("");
let generating = $state(false);
let generateError = $state("");

async function generate() {
    if (!promptInput.trim() || generating) return;
    generating = true;
    generateError = "";
    setAiProcessing(true);
    try {
        await ensureApiKeyLoaded();
        documentContext.freeform = await generateContext({
            prompt: promptInput,
            provider: aiSettings.provider,
            model: aiSettings.model,
            apiKey: aiSettings.apiKey,
        });
        saveDocumentContext();
    } catch (e) {
        generateError = String(e);
    } finally {
        generating = false;
        setAiProcessing(false);
    }
}

function clearAll() {
    posthog.capture("context_cleared");
    documentContext.freeform = "";
    promptInput = "";
    saveDocumentContext();
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
            disabled={!promptInput.trim() || generating || !aiSettings.apiKey}
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
</div>
