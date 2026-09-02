/**
 * autoai/engine.ts — AutoAI review engine.
 *
 * Watches documentContent, debounces, calls the AI for a structured
 * JSON review, and dispatches annotations into the editor.
 *
 * Cost strategy: one non-streaming generateObject call per review cycle,
 * only fired when content changes meaningfully (>= MIN_DIFF_CHARS).
 */

import { buildAnnotationContextInputs } from "$lib/ai/annotationContext";
import { buildAiContextPacket, contextPacketToPrompt } from "$lib/ai/context";
import {
    type EditorialActionFailureReason,
    type EditorialActionPayload,
    applyEditorialAction,
    editorialActionFailureMessage,
} from "$lib/ai/editorialAction";
import { type EditorialAction, compileEditorialPolicy } from "$lib/ai/editorialPolicy";
import type { EditorialTargetSnapshot } from "$lib/ai/editorialTarget";
import { createAiGenerationProvenance } from "$lib/ai/provenance";
import { createModel } from "$lib/ai/provider";
import {
    aiSettings,
    beginAiTask,
    documentContext,
    editorialPreferences,
    endAiTask,
    ensureApiKeyLoaded,
    getAiAbortSignal,
} from "$lib/ai/settings.svelte";
import type { AiGenerationProvenance } from "$lib/editor/plugins/annotations/index";
import { appEventBus } from "$lib/events/appEventBus";
import { captureException } from "$lib/posthog";
import {
    annotations,
    currentDocumentId,
    currentDraftId,
    currentTabId,
    documentContent,
    editorView,
} from "$lib/stores";
import { generateObject } from "ai";
import { toast } from "svelte-sonner";
import { get, writable } from "svelte/store";
import type { AutoAIReviewOutcome } from "./outcome";
import { type AutoAIReviewOutput, AutoAIReviewSchema, normalizeAutoAIReview } from "./reviewSchema";
import { type AutoAIConservativeness, autoAISettings } from "./settings.svelte";

export type AutoAIPhase = "idle" | "thinking" | "reviewing";

/** Current AutoAI engine phase. idle → thinking (debounce warning) → reviewing → idle. */
export const autoAIPhase = writable<AutoAIPhase>("idle");
export const autoAILastOutcome = writable<AutoAIReviewOutcome | null>(null);

// Only re-review if the doc changed by at least this many characters.
const MIN_DIFF_CHARS = 20;

const conservativenessPrompts: Record<AutoAIConservativeness, string> = {
    conservative:
        "Only flag glaring structural or clarity problems that significantly harm the reader's understanding. Do NOT flag minor style preferences, grammar nitpicks, or anything a reasonable editor would let slide. Annotate sparingly — fewer, higher-impact notes are better.",
    balanced:
        "Flag meaningful issues: unclear passages, weak word choices, logical gaps, or missed opportunities to strengthen the writing. Use your judgment about what's worth the writer's attention.",
    thorough:
        "Provide detailed feedback on structure, clarity, voice, pacing, word choice, and potential improvements. Be comprehensive but constructive.",
};

function buildSystemPrompt(): string {
    const { conservativeness, annotationTypes } = autoAISettings;
    const policy = compileEditorialPolicy({
        task: "background-review",
        requestedActions: annotationTypes,
        preferences: editorialPreferences,
    });
    const allowed = policy.allowedActions.join(", ") || "none";
    return `${policy.systemPrompt}

Return structured feedback as JSON. Annotation types allowed for this request: ${allowed}.
- comment: A note pointing out an issue or observation.
- suggestion: A replacement for a specific phrase (provide the exact original text and a better alternative).
- revision: Multiple named versions of a passage for the writer to compare.

Use these fields:
- comment: type, targetText, comment
- suggestion: type, targetText, replacement, rationale
- revision: type, targetText, versionLabel, versionText, threadMessage

${conservativenessPrompts[conservativeness]}

IMPORTANT RULES:
- targetText must be an EXACT substring of the document. Copy it verbatim.
- Keep targetText as short as possible while still being specific (a sentence or phrase, not paragraphs).
- Treat existing annotations in the context packet as open editorial state. Do not create duplicate annotations for the same concern or target.
- Only annotate issues that fall within the allowed annotation types.
- Return valid JSON matching the schema. No prose outside JSON.`;
}

// Single timer variable — phases are nested inside each other:
//   WAITING (70% of debounceMs) → WARNING/thinking (30%) → runReview
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastReviewedContent = "";
let lastReviewedTargetKey = "";
let contentGeneration = 0;
let reviewAbortController: AbortController | null = null;
let unsubscribe: (() => void) | null = null;
let unsubStopAi: (() => void) | null = null;

function autoAIActionPayload(
    annotation: ReturnType<typeof normalizeAutoAIReview>[number],
): EditorialActionPayload {
    if (annotation.type === "comment") {
        return {
            action: "comment",
            targetText: annotation.targetText,
            comment: annotation.comment,
        };
    }
    if (annotation.type === "suggestion") {
        return {
            action: "suggestion",
            targetText: annotation.targetText,
            replacements: [{ text: annotation.replacement, rationale: annotation.rationale }],
        };
    }
    return {
        action: "revision",
        targetText: annotation.targetText,
        versions: annotation.versions,
        threadMessage: annotation.threadMessage,
    };
}

type AutoAIApplySummary = Pick<
    AutoAIReviewOutcome,
    "appliedCount" | "duplicateCount" | "rejectedCount"
>;

function applyAnnotations({
    result,
    target,
    allowedActions,
    provenance,
}: {
    result: AutoAIReviewOutput;
    target: EditorialTargetSnapshot;
    allowedActions: readonly EditorialAction[];
    provenance: AiGenerationProvenance;
}): AutoAIApplySummary {
    const view = get(editorView);
    if (!view) return { appliedCount: 0, duplicateCount: 0, rejectedCount: 0 };

    const allowed = new Set(allowedActions);
    const summary: AutoAIApplySummary = {
        appliedCount: 0,
        duplicateCount: 0,
        rejectedCount: 0,
    };
    const reportableFailures = new Set<EditorialActionFailureReason>();

    for (const ann of normalizeAutoAIReview(result)) {
        // Skip annotation types the user disabled.
        if (!allowed.has(ann.type)) continue;
        const actionResult = applyEditorialAction({
            rootView: view,
            target,
            current: {
                documentId: get(currentDocumentId),
                tabId: get(currentTabId),
                draftId: get(currentDraftId),
            },
            allowedActions,
            payload: autoAIActionPayload(ann),
            provenance,
            author: autoAISettings.persona,
        });
        if (actionResult.ok) {
            summary.appliedCount++;
            continue;
        }

        if (actionResult.reason === "annotation-conflict" && allowed.has("comment")) {
            const fallbackComment =
                ann.type === "suggestion"
                    ? `${ann.rationale}: "${ann.replacement}"`
                    : ann.type === "revision"
                      ? `${ann.threadMessage} (suggested version: "${ann.versions[0].label}" - ${ann.versions[0].text})`
                      : null;
            if (fallbackComment) {
                const fallbackResult = applyEditorialAction({
                    rootView: view,
                    target,
                    current: {
                        documentId: get(currentDocumentId),
                        tabId: get(currentTabId),
                        draftId: get(currentDraftId),
                    },
                    allowedActions,
                    payload: {
                        action: "comment",
                        targetText: ann.targetText,
                        comment: fallbackComment,
                    },
                    provenance,
                    author: autoAISettings.persona,
                });
                if (fallbackResult.ok) {
                    toast.warning(
                        `An AI ${ann.type} conflicted with an open annotation, so Quillium added it as a comment.`,
                    );
                    summary.appliedCount++;
                    continue;
                }
                if (fallbackResult.reason === "duplicate-concern") {
                    summary.duplicateCount++;
                } else {
                    summary.rejectedCount++;
                    reportableFailures.add(fallbackResult.reason);
                }
                continue;
            }
        }

        if (actionResult.reason === "duplicate-concern") {
            summary.duplicateCount++;
        } else {
            summary.rejectedCount++;
            reportableFailures.add(actionResult.reason);
        }
    }

    for (const reason of reportableFailures) {
        toast.warning(editorialActionFailureMessage(reason));
    }
    return summary;
}

function targetKey(): string {
    return `${get(currentDocumentId) ?? ""}\u0000${get(currentDraftId) ?? ""}`;
}

function changedCharacterCount(previous: string, current: string): number {
    if (!previous) return current.length;
    let prefix = 0;
    const prefixLimit = Math.min(previous.length, current.length);
    while (prefix < prefixLimit && previous[prefix] === current[prefix]) prefix++;

    let suffix = 0;
    const suffixLimit = prefixLimit - prefix;
    while (
        suffix < suffixLimit &&
        previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]
    ) {
        suffix++;
    }

    return Math.max(previous.length - prefix - suffix, current.length - prefix - suffix);
}

function linkedAbortController(parent: AbortSignal): {
    controller: AbortController;
    cleanup: () => void;
} {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", abort, { once: true });
    return {
        controller,
        cleanup: () => parent.removeEventListener("abort", abort),
    };
}

async function runReview(content: string, manual = false, generation = contentGeneration) {
    if (!content.trim()) {
        autoAIPhase.set("idle");
        return;
    }

    reviewAbortController?.abort();
    const linkedAbort = linkedAbortController(getAiAbortSignal());
    const { controller } = linkedAbort;
    const abortSignal = controller.signal;
    reviewAbortController = controller;
    const target: EditorialTargetSnapshot = {
        documentId: get(currentDocumentId),
        tabId: get(currentTabId),
        draftId: get(currentDraftId),
        selectedText: "",
        branchPath: [],
    };
    const policy = compileEditorialPolicy({
        task: "background-review",
        requestedActions: autoAISettings.annotationTypes,
        preferences: editorialPreferences,
    });
    let task: symbol | null = null;
    try {
        await ensureApiKeyLoaded();
        // Guard: if the review was cancelled during ensureApiKeyLoaded, bail
        // before flipping UI state to "reviewing" (avoids a brief flicker).
        if (abortSignal.aborted) return;
        // Transition thinking → reviewing only after the async key load,
        // so the >_< face is visible during the ensureApiKeyLoaded wait.
        autoAIPhase.set("reviewing");
        task = beginAiTask("autoai-review");
        const model = createModel(
            aiSettings.provider,
            aiSettings.apiKey,
            aiSettings.model,
            aiSettings.baseURL,
        );
        const provenance = createAiGenerationProvenance({
            task: "background-review",
            provider: aiSettings.provider,
            model: aiSettings.model,
            persona: autoAISettings.persona,
        });
        const contextPacket = buildAiContextPacket({
            mode: "autoai",
            documentContent: content,
            documentContext,
            annotationContext: buildAnnotationContextInputs({
                annotations: get(annotations),
                documentContent: content,
            }),
        });
        const { object } = await generateObject({
            model,
            schema: AutoAIReviewSchema,
            system: buildSystemPrompt(),
            prompt: `Review this context packet. Only create annotations for exact targetText substrings that appear in the included document text.\n\n${contextPacketToPrompt(contextPacket)}`,
            abortSignal,
        });
        if (
            generation !== contentGeneration ||
            target.documentId !== get(currentDocumentId) ||
            target.tabId !== get(currentTabId) ||
            target.draftId !== get(currentDraftId)
        ) {
            autoAILastOutcome.set({
                documentId: target.documentId,
                draftId: target.draftId,
                status: "discarded",
                appliedCount: 0,
                duplicateCount: 0,
                rejectedCount: 0,
                completedAt: Date.now(),
            });
            if (manual) toast("The draft changed during review, so the result was discarded.");
            return;
        }
        lastReviewedContent = content;
        lastReviewedTargetKey = targetKey();
        const summary = applyAnnotations({
            result: object,
            target,
            allowedActions: policy.allowedActions,
            provenance,
        });
        autoAILastOutcome.set({
            documentId: target.documentId,
            draftId: target.draftId,
            status: summary.appliedCount > 0 ? "applied" : "clear",
            ...summary,
            completedAt: Date.now(),
        });
        if (manual && summary.appliedCount === 0) {
            if (summary.duplicateCount > 0) {
                toast("No new notes; the concerns found were already covered.");
            } else if (summary.rejectedCount > 0) {
                toast("No annotations were added; unsafe results were skipped.");
            } else {
                toast("No issues found — your writing looks good.");
            }
        }
    } catch (e) {
        if (abortSignal.aborted) return;
        console.error("[AutoAI] review failed:", e);
        captureException(e);
        autoAILastOutcome.set({
            documentId: target.documentId,
            draftId: target.draftId,
            status: "failed",
            appliedCount: 0,
            duplicateCount: 0,
            rejectedCount: 0,
            completedAt: Date.now(),
        });
    } finally {
        linkedAbort.cleanup();
        if (reviewAbortController === controller) {
            reviewAbortController = null;
            autoAIPhase.set("idle");
        }
        endAiTask(task);
    }
}

function scheduleReview(content: string, generation: number) {
    cancelPendingReview();
    debounceTimer = setTimeout(() => {
        // WAITING → WARNING: show thinking face for the last 30% of the window.
        autoAIPhase.set("thinking");
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            runReview(content, false, generation);
        }, autoAISettings.debounceMs * 0.3);
    }, autoAISettings.debounceMs * 0.7);
}

/** Start the AutoAI engine. Call when the user enables AutoAI. */
export function startAutoAI() {
    if (unsubscribe) return; // already running

    let observedTargetKey = targetKey();
    unsubscribe = documentContent.subscribe((content) => {
        const currentTargetKey = targetKey();
        if (currentTargetKey !== observedTargetKey) {
            observedTargetKey = currentTargetKey;
            autoAILastOutcome.set(null);
        }
        contentGeneration++;
        cancelPendingReview();
        if (!autoAISettings.enabled) return;
        if (autoAISettings.mode !== "continuous") return;
        // Locked drafts are read-only — don't burn an AI call reviewing
        // text that can't be annotated (#160).
        if (get(editorView)?.state.readOnly) return;
        const diff = changedCharacterCount(lastReviewedContent, content);
        if (
            currentTargetKey === lastReviewedTargetKey &&
            diff < MIN_DIFF_CHARS &&
            lastReviewedContent !== ""
        ) {
            return;
        }
        scheduleReview(content, contentGeneration);
    });

    // Cancel pending reviews when the global stop event fires.
    unsubStopAi = appEventBus.on("stop-ai", cancelPendingReview);
}

/** Stop the engine and cancel any pending review. */
export function stopAutoAI() {
    cancelPendingReview();
    unsubStopAi?.();
    unsubStopAi = null;
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
    lastReviewedContent = "";
    lastReviewedTargetKey = "";
}

/** Cancel any pending debounced review without stopping the engine. */
export function cancelPendingReview() {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    reviewAbortController?.abort();
    reviewAbortController = null;
    autoAIPhase.set("idle");
}

/** Trigger an immediate review (used by manual mode / widget click). */
export function triggerManualReview() {
    const content = get(documentContent);
    if (!content.trim()) return;
    cancelPendingReview();
    runReview(content, true, contentGeneration);
}
