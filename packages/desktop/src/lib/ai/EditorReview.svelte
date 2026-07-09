<!-- EditorReview.svelte — Manuscript-centered Quillium review surface. -->
<script lang="ts">
import {
    applyEditorReview,
    buildEditorRequest,
    documentRiskForDocumentType,
    focusForReview,
    generateEditorReview,
    resolveWritingStage,
    summarizeExistingAnnotations,
    type DocumentRiskLevel,
    type PolicyPosture,
    type WritingStagePreference,
} from "$lib/ai/editor";
import { buildAiContextPacket } from "$lib/ai/context";
import {
    beginAiTask,
    documentContext,
    endAiTask,
    getAiAbortSignal,
    personaModes,
    setPersonasForMode,
} from "$lib/ai/settings.svelte";
import { autoAISettings, persistAutoAISettings } from "$lib/autoai/settings.svelte";
import posthog, { captureException } from "$lib/posthog";
import { getEnabledPersonas } from "$lib/readers/settings.svelte";
import {
    annotations,
    currentDocumentId,
    documentContent,
    editorView,
    selectedText,
} from "$lib/stores";
import {
    CheckIcon,
    FileTextIcon,
    LoaderCircleIcon,
    Settings2Icon,
    ShieldCheckIcon,
    SparklesIcon,
    UsersIcon,
} from "lucide-svelte";
import { get } from "svelte/store";

let {
    onOpenReaders = () => {},
    onOpenContext = () => {},
}: {
    onOpenReaders?: () => void;
    onOpenContext?: () => void;
} = $props();

const stageOptions: Array<{ value: WritingStagePreference; label: string }> = [
    { value: "auto", label: "Auto" },
    { value: "discovering", label: "Discovering" },
    { value: "shaping", label: "Shaping" },
    { value: "refining", label: "Refining" },
    { value: "proofing", label: "Proofing" },
];

const stageLabels = {
    discovering: "Discovering",
    shaping: "Shaping",
    refining: "Refining",
    proofing: "Proofing",
} as const;

let instruction = $state("");
let documentRiskPreference = $state<DocumentRiskLevel | "auto">("auto");
let policyPosture = $state<PolicyPosture>("normal");
let reviewState = $state<"idle" | "reviewing" | "complete" | "error">("idle");
let summary = $state("");
let appliedCount = $state(0);
let reviewedStage = $state("");
let errorMessage = $state("");

const stageResolution = $derived(
    resolveWritingStage(autoAISettings.stagePreference, $documentContent),
);
const stageLabel = $derived(stageLabels[stageResolution.stage]);
const targetLabel = $derived($selectedText ? "Selection" : "Current draft");
const canReview = $derived(reviewState !== "reviewing" && !!$documentContent.trim());
const documentRiskLevel = $derived(
    documentRiskPreference === "auto"
        ? documentRiskForDocumentType(documentContext.documentType)
        : documentRiskPreference,
);
const protectedMode = $derived(documentRiskLevel !== "ordinary" || policyPosture !== "normal");

function updateStage(event: Event): void {
    autoAISettings.stagePreference = (event.currentTarget as HTMLSelectElement)
        .value as WritingStagePreference;
    persistAutoAISettings();
    posthog.capture("ai_editor_stage_changed", {
        stage_preference: autoAISettings.stagePreference,
    });
}

function updateRisk(event: Event): void {
    documentRiskPreference = (event.currentTarget as HTMLSelectElement).value as
        | DocumentRiskLevel
        | "auto";
}

function updatePolicy(event: Event): void {
    policyPosture = (event.currentTarget as HTMLSelectElement).value as PolicyPosture;
}

function togglePersonaMode(): void {
    const next = !personaModes.editor;
    setPersonasForMode("editor", next);
    posthog.capture("persona_mode_toggled", { mode: "editor", enabled: next });
}

async function review(): Promise<void> {
    if (!canReview) return;
    const viewAtStart = get(editorView);
    const documentIdAtStart = get(currentDocumentId);
    const contentAtStart = $documentContent;
    const selectionAtStart = $selectedText;
    if (!viewAtStart || !contentAtStart.trim()) return;

    reviewState = "reviewing";
    errorMessage = "";
    summary = "";
    appliedCount = 0;
    const task = beginAiTask("quillium-review");
    const abortSignal = getAiAbortSignal();
    const stage = resolveWritingStage(autoAISettings.stagePreference, contentAtStart);
    const focus = focusForReview({ stage: stage.stage, userIntent: instruction });
    const contextPacket = buildAiContextPacket({
        mode: "feedback",
        documentContent: contentAtStart,
        selectedText: selectionAtStart || undefined,
        documentContext,
    });
    const request = buildEditorRequest({
        surface: "one_click_editor",
        selectedText: selectionAtStart || undefined,
        surroundingContext: contextPacket.surroundingText,
        fullDocumentExcerpt: contextPacket.documentText,
        documentContext: {
            documentType: documentContext.documentType,
            audience: documentContext.audience || undefined,
            purpose: documentContext.purpose || undefined,
            constraints: [documentContext.constraints, documentContext.freeform].filter(Boolean),
            preserve: documentContext.preserve ? [documentContext.preserve] : undefined,
        },
        existingAnnotations: summarizeExistingAnnotations(get(annotations) ?? {}, contentAtStart),
        userIntent:
            instruction.trim() ||
            "Review this writing and leave only the highest-leverage margin notes for its current stage.",
        writingStage: stage.stage,
        writingStageSource: stage.source,
        focus,
        documentRiskLevel,
        policyPosture,
        maxAnnotations: 5,
        persona: { enabledForThisSurface: personaModes.editor },
    });
    const personas = personaModes.editor ? getEnabledPersonas() : [];

    posthog.capture("ai_editor_requested", {
        has_selection: !!selectionAtStart,
        stage: stage.stage,
        stage_source: stage.source,
        focus,
        document_risk_level: documentRiskLevel,
        policy_posture: policyPosture,
        persona_count: personas.length,
    });

    try {
        const runs = personas.length > 0 ? personas : [undefined];
        const responses = await Promise.all(
            runs.map((persona) => generateEditorReview({ request, persona, abortSignal })),
        );
        if (abortSignal.aborted || get(currentDocumentId) !== documentIdAtStart) return;
        const liveView = get(editorView);
        if (!liveView) return;

        let totalApplied = 0;
        for (let index = 0; index < responses.length; index++) {
            const result = applyEditorReview({
                request,
                response: responses[index],
                view: liveView,
                author: personas[index]?.name ?? "Quillium",
            });
            totalApplied += result.applied;
        }
        const primaryResponse = responses[0];
        summary = primaryResponse.summaryForSidebar;
        appliedCount = totalApplied;
        reviewedStage = stageLabels[primaryResponse.stageAssessment.stage];
        reviewState = "complete";
    } catch (error) {
        if (abortSignal.aborted) return;
        console.error("[EditorReview] review failed:", error);
        captureException(error);
        errorMessage = "Quillium could not complete this review.";
        reviewState = "error";
    } finally {
        endAiTask(task);
        if (abortSignal.aborted) reviewState = "idle";
    }
}

function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    review();
}
</script>

<div class="flex min-h-0 flex-1 flex-col">
    <div class="shrink-0 border-b border-black/10 px-4 py-3">
        <div class="flex items-center gap-2">
            <div class="flex min-w-0 flex-1 items-center gap-2">
                <SparklesIcon class="h-4 w-4 text-teal-700" />
                <div class="min-w-0">
                    <p class="truncate text-xs font-semibold text-black/65">{targetLabel}</p>
                    <p class="text-[10px] text-black/35">
                        {#if autoAISettings.stagePreference === "auto"}Detected: {/if}{stageLabel}
                    </p>
                </div>
            </div>
            <label class="stage-control">
                <span class="sr-only">Writing stage</span>
                <select value={autoAISettings.stagePreference} onchange={updateStage}>
                    {#each stageOptions as option}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
            </label>
            <button
                type="button"
                onclick={review}
                disabled={!canReview}
                class="review-button"
            >
                {#if reviewState === "reviewing"}
                    <LoaderCircleIcon class="h-3.5 w-3.5 animate-spin" />
                {:else}
                    <SparklesIcon class="h-3.5 w-3.5" />
                {/if}
                Review
            </button>
        </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {#if reviewState === "reviewing"}
            <div class="status-panel">
                <LoaderCircleIcon class="h-5 w-5 animate-spin text-teal-600" />
                <div>
                    <p class="text-sm font-medium text-black/65">Reading the {targetLabel.toLowerCase()}</p>
                    <p class="mt-0.5 text-[11px] text-black/38">{stageLabel} pass</p>
                </div>
            </div>
        {:else if reviewState === "complete"}
            <div class="status-panel items-start">
                <CheckIcon class="mt-0.5 h-5 w-5 text-teal-600" />
                <div class="min-w-0">
                    <p class="text-sm font-medium text-black/68">
                        {appliedCount > 0
                            ? `${appliedCount} margin ${appliedCount === 1 ? "note" : "notes"}`
                            : "No high-value notes"}
                    </p>
                    <p class="mt-1 text-xs leading-relaxed text-black/48">{summary}</p>
                    <p class="mt-2 text-[10px] text-black/30">{reviewedStage} pass</p>
                </div>
            </div>
        {:else if reviewState === "error"}
            <div class="status-panel border-red-200 bg-red-50 text-red-700">
                <span class="text-xs">{errorMessage}</span>
            </div>
        {:else}
            <div class="flex flex-1 items-center justify-center py-10 text-center">
                <div>
                    <FileTextIcon class="mx-auto h-7 w-7 text-black/18" />
                    <p class="mt-3 text-sm font-medium text-black/45">Ready for a {stageLabel.toLowerCase()} pass</p>
                    <p class="mt-1 text-[11px] text-black/30">Notes will appear in the margin.</p>
                </div>
            </div>
        {/if}

        <details class="mt-4 border-t border-black/8 pt-3">
            <summary class="flex cursor-pointer list-none items-center gap-2 text-[11px] font-medium text-black/38">
                <Settings2Icon class="h-3.5 w-3.5" />
                Review settings
            </summary>
            <div class="mt-3 space-y-3">
                {#if protectedMode}
                    <div class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-snug text-amber-800">
                        <ShieldCheckIcon class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>Protected writing. Substantive language stays with the writer.</span>
                    </div>
                {/if}
                <div class="grid grid-cols-2 gap-2">
                    <label class="setting-field">
                        <span>Document</span>
                        <select value={documentRiskPreference} onchange={updateRisk}>
                            <option value="auto">From writing brief ({documentRiskLevel.replaceAll("_", " ")})</option>
                            <option value="ordinary">Ordinary</option>
                            <option value="high_stakes">High stakes</option>
                            <option value="college_application">College application</option>
                        </select>
                    </label>
                    <label class="setting-field">
                        <span>AI policy</span>
                        <select value={policyPosture} onchange={updatePolicy}>
                            <option value="normal">Normal</option>
                            <option value="unknown">Unknown</option>
                            <option value="grammar_only">Grammar only</option>
                            <option value="no_substantive_ai_content">Feedback only</option>
                            <option value="custom">Custom</option>
                        </select>
                    </label>
                </div>
                <div class="flex items-center justify-between rounded-md bg-white/50 px-2.5 py-2">
                    <span class="flex items-center gap-1.5 text-[11px] text-black/48">
                        <UsersIcon class="h-3.5 w-3.5" />
                        Reader perspectives
                    </span>
                    <button
                        type="button"
                        role="switch"
                        aria-label="Reader perspectives"
                        aria-checked={personaModes.editor}
                        onclick={togglePersonaMode}
                        class="toggle {personaModes.editor ? 'on' : ''}"
                    ><span></span></button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <button type="button" onclick={onOpenContext} class="secondary-button">Document context</button>
                    <button type="button" onclick={onOpenReaders} class="secondary-button">Configure readers</button>
                </div>
            </div>
        </details>
    </div>

    <form onsubmit={handleSubmit} class="shrink-0 border-t border-black/10 bg-white/25 p-3">
        <div class="flex gap-2">
            <input
                bind:value={instruction}
                name="quillium-instruction"
                placeholder="Anything specific?"
                disabled={reviewState === "reviewing"}
                class="min-w-0 flex-1 rounded-md border border-black/12 bg-white/80 px-3 py-2 text-sm text-black/70 outline-none placeholder:text-black/28 focus:border-teal-500"
                autocomplete="off"
            />
            <button type="submit" disabled={!canReview} class="icon-submit" aria-label="Review">
                <SparklesIcon class="h-4 w-4" />
            </button>
        </div>
    </form>
</div>

<style>
    .stage-control select,
    .setting-field select {
        border: 1px solid rgb(0 0 0 / 10%);
        border-radius: 4px;
        background: rgb(255 255 255 / 75%);
        color: rgb(0 0 0 / 58%);
        font-size: 10px;
        outline: none;
    }

    .stage-control select {
        max-width: 94px;
        padding: 5px 6px;
    }

    .review-button {
        display: flex;
        min-height: 30px;
        align-items: center;
        gap: 5px;
        border-radius: 5px;
        background: #2f6f65;
        padding: 0 10px;
        color: white;
        font-size: 11px;
        font-weight: 600;
    }

    .review-button:disabled,
    .icon-submit:disabled {
        cursor: not-allowed;
        opacity: 0.45;
    }

    .status-panel {
        display: flex;
        align-items: center;
        gap: 12px;
        border: 1px solid rgb(0 0 0 / 8%);
        border-radius: 6px;
        background: rgb(255 255 255 / 52%);
        padding: 14px;
    }

    .setting-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        color: rgb(0 0 0 / 38%);
        font-size: 10px;
        font-weight: 600;
    }

    .setting-field select {
        width: 100%;
        padding: 6px;
    }

    .toggle {
        position: relative;
        width: 28px;
        height: 16px;
        border: 0;
        border-radius: 8px;
        background: rgb(0 0 0 / 14%);
    }

    .toggle span {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: white;
        transition: transform 150ms ease;
    }

    .toggle.on {
        background: #2f8f78;
    }

    .toggle.on span {
        transform: translateX(12px);
    }

    .secondary-button {
        border: 1px solid rgb(0 0 0 / 10%);
        border-radius: 4px;
        background: rgb(255 255 255 / 60%);
        padding: 7px;
        color: rgb(0 0 0 / 48%);
        font-size: 10px;
    }

    .icon-submit {
        display: flex;
        width: 36px;
        flex: 0 0 36px;
        align-items: center;
        justify-content: center;
        border-radius: 5px;
        background: #2f6f65;
        color: white;
    }
</style>
