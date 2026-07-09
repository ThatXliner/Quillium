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
    resolveWritingStage,
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

const REVIEW_PAUSE_MS = 12_000;
const THINKING_LEAD_MS = 2_500;
const MIN_MEANINGFUL_CHANGE_CHARS = 60;

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
        const stageResolution = resolveWritingStage(autoAISettings.stagePreference, content);
        autoAIWritingStage.set(stageResolution.stage);
        const change = recentChange(lastReviewedContent, content);
        const focus = focusForWritingStage(stageResolution.stage);
        const policyPosture =
            stageResolution.stage === "proofing" ? "grammar_only" : "no_substantive_ai_content";
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
            },
            existingAnnotations: summarizeExistingAnnotations(get(annotations) ?? {}, content),
            userIntent:
                "Review the recent writing change in whole-document context. Leave only high-leverage notes appropriate to the current writing stage.",
            writingStage: stageResolution.stage,
            writingStageSource: stageResolution.source,
            focus,
            documentRiskLevel: documentRiskForDocumentType(documentContext.documentType),
            policyPosture,
            maxAnnotations: 3,
        });
        const response = await generateEditorReview({ request, abortSignal });
        if (abortSignal.aborted) return;

        const liveView = get(editorView);
        if (!liveView) return;
        const result = applyEditorReview({
            request,
            response,
            view: liveView,
            author: "Quillium",
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
    thinkingTimer = setTimeout(() => {
        autoAIPhase.set("thinking");
        thinkingTimer = null;
    }, REVIEW_PAUSE_MS - THINKING_LEAD_MS);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (thinkingTimer) {
            clearTimeout(thinkingTimer);
            thinkingTimer = null;
        }
        runReview(content);
    }, REVIEW_PAUSE_MS);
}

export function startAutoAI(): void {
    if (unsubscribe) return;

    unsubscribe = documentContent.subscribe((content) => {
        if (!autoAISettings.enabled) return;
        if (get(editorView)?.state.readOnly) return;
        const stage = resolveWritingStage(autoAISettings.stagePreference, content).stage;
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
