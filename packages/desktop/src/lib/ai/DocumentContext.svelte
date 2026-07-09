<!-- DocumentContext.svelte — Writer-owned context, prompt analysis, and editor preferences. -->
<script lang="ts">
import { generateContext } from "$lib/ai/clientStreams";
import {
    DEFAULT_DOCUMENT_CONTEXT,
    aiSettings,
    beginAiTask,
    type DocumentKind,
    documentContext,
    endAiTask,
    ensureApiKeyLoaded,
    getAiAbortSignal,
    saveDocumentContext,
} from "$lib/ai/settings.svelte";
import posthog from "$lib/posthog";
import { RotateCcwIcon, SparklesIcon } from "lucide-svelte";

const documentKinds: Array<{ value: DocumentKind; label: string }> = [
    { value: "general", label: "General writing" },
    { value: "college_application", label: "College application" },
    { value: "academic", label: "Academic or graded" },
    { value: "professional", label: "Professional" },
    { value: "personal", label: "Personal writing" },
    { value: "fiction", label: "Fiction" },
];

let promptInput = $state("");
let generating = $state(false);
let generateError = $state("");

async function generate(): Promise<void> {
    if (!promptInput.trim() || generating) return;
    generating = true;
    generateError = "";
    const task = beginAiTask("document-context");
    const abortSignal = getAiAbortSignal();
    try {
        await ensureApiKeyLoaded();
        documentContext.freeform = await generateContext({
            prompt: promptInput,
            provider: aiSettings.provider,
            model: aiSettings.model,
            apiKey: aiSettings.apiKey,
            abortSignal,
        });
        saveDocumentContext();
        posthog.capture("document_context_generated");
    } catch (error) {
        if (!abortSignal.aborted) generateError = String(error);
    } finally {
        generating = false;
        endAiTask(task);
    }
}

function updateDocumentType(event: Event): void {
    documentContext.documentType = (event.currentTarget as HTMLSelectElement).value as DocumentKind;
    saveDocumentContext();
    posthog.capture("document_context_changed", {
        field: "document_type",
        value: documentContext.documentType,
    });
}

function save(): void {
    saveDocumentContext();
}

function clearAll(): void {
    Object.assign(documentContext, DEFAULT_DOCUMENT_CONTEXT);
    promptInput = "";
    saveDocumentContext();
    posthog.capture("context_cleared");
}
</script>

<div class="flex h-full flex-col overflow-y-auto">
    <section class="border-b border-black/10 p-3">
        <div class="mb-2 flex items-center justify-between">
            <p class="section-label">WRITING PROMPT OR BRIEF</p>
            <button type="button" onclick={clearAll} class="clear-button">
                <RotateCcwIcon size={11} /> Reset
            </button>
        </div>
        <textarea
            bind:value={promptInput}
            rows="4"
            placeholder="Paste an assignment, application prompt, or project brief..."
            class="context-input"
        ></textarea>
        <button
            type="button"
            onclick={generate}
            disabled={!promptInput.trim() || generating}
            class="generate-button"
        >
            {#if generating}
                <span class="pulse">●</span> Analyzing...
            {:else}
                <SparklesIcon size={12} /> Generate context
            {/if}
        </button>
        {#if generateError}
            <p class="mt-1.5 text-[10px] leading-relaxed text-red-600/80">{generateError}</p>
        {/if}
    </section>

    <section class="space-y-3 p-3 pb-4">
        <label class="field">
            <span>DOCUMENT CONTEXT</span>
            <textarea
                bind:value={documentContext.freeform}
                onblur={save}
                rows="7"
                placeholder="Goal, audience, tone, constraints, what to emphasize, and what to avoid..."
                class="context-input"
            ></textarea>
        </label>

        <details class="details-panel">
            <summary>Writing details</summary>
            <div class="mt-3 space-y-3">
                <label class="field">
                    <span>WHAT ARE YOU WRITING?</span>
                    <select value={documentContext.documentType} onchange={updateDocumentType}>
                        {#each documentKinds as kind}
                            <option value={kind.value}>{kind.label}</option>
                        {/each}
                    </select>
                </label>
                <label class="field">
                    <span>WHO WILL READ IT?</span>
                    <input
                        bind:value={documentContext.audience}
                        onblur={save}
                        placeholder="Hiring managers, classmates, newsletter readers..."
                    />
                </label>
                <label class="field">
                    <span>WHAT SHOULD HAPPEN FOR THE READER?</span>
                    <textarea
                        bind:value={documentContext.purpose}
                        onblur={save}
                        rows="2"
                        placeholder="Understand the argument, trust the proposal, feel the tension..."
                    ></textarea>
                </label>
                <label class="field">
                    <span>REQUIREMENTS</span>
                    <textarea
                        bind:value={documentContext.constraints}
                        onblur={save}
                        rows="2"
                        placeholder="Word limit, rubric, house style, required claims..."
                    ></textarea>
                </label>
                <label class="field">
                    <span>KEEP INTACT</span>
                    <input
                        bind:value={documentContext.preserve}
                        onblur={save}
                        placeholder="Direct tone, technical terms, fragmented rhythm..."
                    />
                </label>
            </div>
        </details>

        <details class="details-panel">
            <summary>Custom editor instructions</summary>
            <textarea
                bind:value={documentContext.editorInstructions}
                onblur={save}
                rows="5"
                placeholder="Example: Be blunt. Prioritize argument over polish. Never suggest changing my short sentences."
                class="context-input mt-3"
            ></textarea>
            <p class="mt-1.5 text-[10px] leading-relaxed text-black/30">
                Applied to Quillium and AutoAI. Safety and authorship rules still apply.
            </p>
        </details>
    </section>
</div>

<style>
    .section-label,
    .field > span {
        color: rgb(0 0 0 / 38%);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .context-input,
    input,
    select,
    textarea {
        width: 100%;
        border: 1px solid rgb(0 0 0 / 10%);
        border-radius: 8px;
        background: rgb(255 255 255 / 52%);
        padding: 8px 9px;
        color: rgb(0 0 0 / 68%);
        font-size: 12px;
        line-height: 1.45;
        outline: none;
    }

    textarea {
        resize: vertical;
    }

    input:focus,
    select:focus,
    textarea:focus {
        border-color: rgb(59 130 246 / 55%);
    }

    .generate-button {
        display: flex;
        width: 100%;
        min-height: 30px;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin-top: 7px;
        border: 0;
        border-radius: 8px;
        background: rgb(59 130 246 / 12%);
        color: #1d4ed8;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
    }

    .generate-button:disabled {
        cursor: not-allowed;
        opacity: 0.4;
    }

    .clear-button {
        display: flex;
        align-items: center;
        gap: 4px;
        border: 0;
        background: transparent;
        color: rgb(0 0 0 / 30%);
        font-size: 10px;
        cursor: pointer;
    }

    .details-panel {
        border: 1px solid rgb(0 0 0 / 8%);
        border-radius: 8px;
        background: rgb(255 255 255 / 32%);
        padding: 9px 10px;
    }

    .details-panel summary {
        cursor: pointer;
        color: rgb(0 0 0 / 45%);
        font-size: 10px;
        font-weight: 600;
    }

    .pulse {
        animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
        50% { opacity: 0.35; }
    }
</style>
