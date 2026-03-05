<!--
    DocumentContext.svelte — Writer's document-context editor panel.

    Allows the writer to define structured metadata about their document
    (goal, tone, audience, emphasize, avoid, notes). These fields are
    injected into every AI system prompt via `buildDocumentContextPrompt`
    in utils.ts, letting the LLM tailor its responses.

    Features two input modes:
      1. Manual editing — directly fill in each field's textarea.
      2. AI generation — paste a writing prompt/brief and click
         "Generate context" to have the LLM auto-populate all fields
         via the `generateContext` non-streaming call in clientStreams.ts.

    State variables:
      `promptInput`    — text area for the AI generation prompt.
      `generating`     — true while the generateContext call is in flight.
      `generateError`  — error message from a failed generation attempt.

    All fields are persisted to localStorage via `saveDocumentContext`
    (called on textarea blur and after AI generation).

    Dependencies: settings.svelte.ts (documentContext, saveDocumentContext,
    aiSettings), clientStreams.ts (generateContext).
-->
<script lang="ts">
    import { SparklesIcon } from "lucide-svelte";
    import { documentContext, saveDocumentContext, aiSettings } from "$lib/ai/settings.svelte";
    import { generateContext } from "$lib/ai/clientStreams";

    const FIELDS: { key: keyof typeof documentContext; label: string; placeholder: string }[] = [
        { key: "goal", label: "Goal", placeholder: "What should this piece accomplish?" },
        { key: "tone", label: "Tone", placeholder: "e.g. reflective and personal, formal, darkly comic" },
        { key: "audience", label: "Audience", placeholder: "Who's reading this and what are they looking for?" },
        { key: "emphasize", label: "Emphasize", placeholder: "Themes, qualities, or details to foreground" },
        { key: "avoid", label: "Avoid", placeholder: "Pitfalls or moves that would hurt this piece" },
        { key: "notes", label: "Notes", placeholder: "Any other context, constraints, or strategy" },
    ];

    let promptInput = $state("");
    let generating = $state(false);
    let generateError = $state("");

    function hasContext() {
        return FIELDS.some((f) => documentContext[f.key].trim() !== "");
    }

    // AI-powered context generation.
    // State: idle -> generating (API call in flight) -> idle.
    // On success, each returned field is written into documentContext
    // and persisted to localStorage. On failure, generateError is set.
    async function generate() {
        if (!promptInput.trim() || generating) return;
        generating = true;
        generateError = "";
        try {
            const data = await generateContext({
                prompt: promptInput,
                provider: aiSettings.provider,
                model: aiSettings.model,
                apiKey: aiSettings.apiKey,
            });
            applyGeneratedContext(data);
        } catch (e) {
            generateError = String(e);
        } finally {
            generating = false;
        }
    }

    /** Write AI-generated fields into reactive state and persist. */
    function applyGeneratedContext(
        data: Record<string, string>,
    ) {
        for (const f of FIELDS) {
            if (data[f.key]) documentContext[f.key] = data[f.key];
        }
        saveDocumentContext();
    }

    function clearAll() {
        for (const f of FIELDS) documentContext[f.key] = "";
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
            placeholder="Paste your essay prompt, assignment, or brief here and the AI will configure the context fields below…"
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

    <!-- Editable fields -->
    <div class="flex flex-col gap-0 p-3 pb-4">
        <div class="flex items-center justify-between mb-2.5">
            <p class="text-[10px] font-semibold text-black/40 uppercase tracking-wider">
                Document Context
            </p>
            {#if hasContext()}
                <button
                    onclick={clearAll}
                    class="text-[10px] text-black/30 hover:text-red-500/70 transition-colors"
                >
                    Clear all
                </button>
            {/if}
        </div>

        <div class="flex flex-col gap-3">
            {#each FIELDS as field}
                <div class="flex flex-col gap-1">
                    <label class="text-[10px] font-medium text-black/50">
                        {field.label}
                    </label>
                    <textarea
                        bind:value={documentContext[field.key]}
                        onblur={saveDocumentContext}
                        placeholder={field.placeholder}
                        rows={2}
                        class="w-full resize-none rounded-lg bg-white/50 border border-black/10 px-2.5 py-2
                            text-xs text-black/70 placeholder:text-black/20 outline-none leading-relaxed
                            focus:border-blue-400/60 transition-colors"
                    ></textarea>
                </div>
            {/each}
        </div>
    </div>
</div>
