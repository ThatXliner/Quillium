/**
 * autoai/engine.ts — Quiet, stage-aware Quillium review.
 *
 * AutoAI and manual Quillium review share the same structured editor contract.
 * This engine waits for a meaningful writing pause, reviews recent changes in
 * whole-document context, and applies only a few high-value margin notes.
 */

import {
    applyEditorReview,
    buildEditorRequest,
    documentRiskForDocumentType,
    focusForWritingStage,
    generateEditorReview,
    inferWritingStage,
    summarizeExistingAnnotations,
    type WritingStage,
} from "$lib/ai/editor";
import { buildAiContextPacket } from "$lib/ai/context";
import { beginAiTask, documentContext, endAiTask, getAiAbortSignal } from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import { captureException } from "$lib/posthog";
import { annotations, documentContent, editorView } from "$lib/stores";
import { toast } from "svelte-sonner";
import { get, writable } from "svelte/store";
import { autoAISettings } from "./settings.svelte";

export type AutoAIPhase = "idle" | "thinking" | "reviewing";

export const autoAIPhase = writable<AutoAIPhase>("idle");
export const autoAIWritingStage = writable<WritingStage>("discovering");

const MIN_MEANINGFUL_CHANGE_CHARS = 20;

const REVIEW_DEPTH = {
    conservative: {
        maxAnnotations: 2,
        instruction: "Only flag clear, high-impact issues. It is fine to leave no note.",
    },
    balanced: {
        maxAnnotations: 4,
        instruction: "Flag meaningful issues in structure, clarity, voice, and local craft.",
    },
    thorough: {
        maxAnnotations: 6,
        instruction: "Review comprehensively while avoiding duplicate or low-value notes.",
    },
} as const;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
let lastReviewedContent = "";
let unsubscribe: (() => void) | null = null;
let unsubStopAi: (() => void) | null = null;

type RecentChange = {
    text?: string;
    surroundingContext?: string;
};

function recentChange(previous: string, current: string): RecentChange {
    if (!previous || previous === current) return {};

    let prefix = 0;
    const prefixLimit = Math.min(previous.length, current.length);
    while (prefix < prefixLimit && previous[prefix] === current[prefix]) prefix++;

    let suffix = 0;
    const suffixLimit = Math.min(previous.length - prefix, current.length - prefix);
    while (
        suffix < suffixLimit &&
        previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]
    ) {
        suffix++;
    }

    const changeEnd = current.length - suffix;
    const changedText = current.slice(prefix, changeEnd).trim();
    const contextStart = Math.max(0, prefix - 500);
    const contextEnd = Math.min(current.length, changeEnd + 500);
    return {
        text: changedText || undefined,
        surroundingContext: current.slice(contextStart, contextEnd),
    };
}

function meaningfulChangeSize(previous: string, current: string): number {
    if (!previous) return current.length;
    const change = recentChange(previous, current);
    return change.text?.length ?? Math.abs(current.length - previous.length);
}

async function runReview(content: string, manual = false): Promise<void> {
    const view = get(editorView);
    if (!content.trim() || !view || view.state.readOnly) {
        autoAIPhase.set("idle");
        return;
    }

    const abortSignal = getAiAbortSignal();
    let task: symbol | null = null;
    try {
        autoAIPhase.set("reviewing");
        task = beginAiTask("autoai-review");
        const stageInference = inferWritingStage(content);
        autoAIWritingStage.set(stageInference.stage);
        const change = recentChange(lastReviewedContent, content);
        const focus = focusForWritingStage(stageInference.stage);
        const depth = REVIEW_DEPTH[autoAISettings.conservativeness];
        const contextPacket = buildAiContextPacket({
            mode: "autoai",
            documentContent: content,
            selectedText: change.text,
            documentContext,
        });
        const request = buildEditorRequest({
            surface: "autoai",
            selectedText: change.text,
            surroundingContext: contextPacket.surroundingText || change.surroundingContext,
            fullDocumentExcerpt: contextPacket.documentText,
            documentContext: {
                documentType: documentContext.documentType,
                audience: documentContext.audience || undefined,
                purpose: documentContext.purpose || undefined,
                constraints: [documentContext.constraints, documentContext.freeform].filter(
                    Boolean,
                ),
                preserve: documentContext.preserve ? [documentContext.preserve] : undefined,
                editorInstructions: documentContext.editorInstructions || undefined,
            },
            existingAnnotations: summarizeExistingAnnotations(get(annotations) ?? {}, content),
            userIntent: `Review the recent writing change in whole-document context. ${depth.instruction} Allowed annotation forms: ${autoAISettings.annotationTypes.join(", ")}.`,
            writingStage: stageInference.stage,
            writingStageSource: "inferred",
            focus,
            documentRiskLevel: documentRiskForDocumentType(documentContext.documentType),
            policyPosture: "normal",
            maxAnnotations: depth.maxAnnotations,
        });
        const response = await generateEditorReview({ request, abortSignal });
        if (abortSignal.aborted) return;

        const liveView = get(editorView);
        if (!liveView) return;
        const result = applyEditorReview({
            request,
            response,
            view: liveView,
            author: autoAISettings.persona,
            allowedAnnotationTypes: autoAISettings.annotationTypes,
        });
        lastReviewedContent = content;
        autoAIWritingStage.set(response.stageAssessment.stage);
        if (manual) {
            toast(
                result.applied > 0
                    ? `Quillium left ${result.applied} margin ${result.applied === 1 ? "note" : "notes"}.`
                    : "No high-value notes right now.",
            );
        }
    } catch (error) {
        if (abortSignal.aborted) return;
        console.error("[AutoAI] review failed:", error);
        captureException(error);
        if (manual) toast.error("Quillium could not complete the review.");
    } finally {
        autoAIPhase.set("idle");
        endAiTask(task);
    }
}

function scheduleReview(content: string): void {
    cancelPendingReview();
    const thinkingLeadMs = Math.min(2_500, autoAISettings.debounceMs * 0.3);
    thinkingTimer = setTimeout(() => {
        autoAIPhase.set("thinking");
        thinkingTimer = null;
    }, autoAISettings.debounceMs - thinkingLeadMs);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (thinkingTimer) {
            clearTimeout(thinkingTimer);
            thinkingTimer = null;
        }
        runReview(content);
    }, autoAISettings.debounceMs);
}

export function startAutoAI(): void {
    if (unsubscribe) return;

    unsubscribe = documentContent.subscribe((content) => {
        if (!autoAISettings.enabled) return;
        if (autoAISettings.mode !== "continuous") return;
        if (get(editorView)?.state.readOnly) return;
        const stage = inferWritingStage(content).stage;
        autoAIWritingStage.set(stage);
        if (
            lastReviewedContent &&
            meaningfulChangeSize(lastReviewedContent, content) < MIN_MEANINGFUL_CHANGE_CHARS
        ) {
            return;
        }
        scheduleReview(content);
    });
    unsubStopAi = appEventBus.on("stop-ai", cancelPendingReview);
}

export function stopAutoAI(): void {
    cancelPendingReview();
    unsubStopAi?.();
    unsubStopAi = null;
    unsubscribe?.();
    unsubscribe = null;
    lastReviewedContent = "";
}

export function cancelPendingReview(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (thinkingTimer) clearTimeout(thinkingTimer);
    debounceTimer = null;
    thinkingTimer = null;
    autoAIPhase.set("idle");
}

export function triggerManualReview(): void {
    const content = get(documentContent);
    if (!content.trim()) return;
    cancelPendingReview();
    runReview(content, true);
}
