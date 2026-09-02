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
import { type EditorialAction, compileEditorialPolicy } from "$lib/ai/editorialPolicy";
import {
    type EditorialTargetSnapshot,
    validateEditorialActionTarget,
} from "$lib/ai/editorialTarget";
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
import {
    type AiGenerationProvenance,
    createComment,
    createRevision,
    createSuggestion,
} from "$lib/editor/plugins/annotations/index";
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
import { type AutoAIReviewOutput, AutoAIReviewSchema, normalizeAutoAIReview } from "./reviewSchema";
import { type AutoAIConservativeness, autoAISettings } from "./settings.svelte";

export type AutoAIPhase = "idle" | "thinking" | "reviewing";

/** Current AutoAI engine phase. idle → thinking (debounce warning) → reviewing → idle. */
export const autoAIPhase = writable<AutoAIPhase>("idle");

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

function actionForAnnotation(
    type: AutoAIReviewOutput["annotations"][number]["type"],
): EditorialAction {
    return type;
}

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
}): number {
    const view = get(editorView);
    if (!view) return 0;

    // Validate against the live document, not the reviewed snapshot — the
    // user may have edited while the AI call was in flight, and annotations
    // are applied to the live view.
    const doc = view.state.doc.toString();
    const allowed = new Set(allowedActions);
    let applied = 0;

    for (const ann of normalizeAutoAIReview(result)) {
        // Skip annotation types the user disabled.
        if (!allowed.has(ann.type)) continue;
        const validation = validateEditorialActionTarget({
            snapshot: target,
            current: {
                documentId: get(currentDocumentId),
                tabId: get(currentTabId),
                draftId: get(currentDraftId),
                documentText: doc,
            },
            targetText: ann.targetText,
            action: actionForAnnotation(ann.type),
            allowedActions,
        });
        if (!validation.ok) continue;
        // Verify the targetText actually exists in the current doc.
        if (!doc.includes(ann.targetText)) continue;

        try {
            if (ann.type === "comment") {
                createComment({
                    targetText: ann.targetText,
                    comment: ann.comment,
                    author: autoAISettings.persona,
                    aiProvenance: provenance,
                    view,
                });
                applied++;
            } else if (ann.type === "suggestion") {
                const created = createSuggestion({
                    targetText: ann.targetText,
                    replacements: [{ text: ann.replacement, rationale: ann.rationale }],
                    author: autoAISettings.persona,
                    aiProvenance: provenance,
                    state: view.state,
                    dispatch: view.dispatch.bind(view),
                });
                if (created) {
                    applied++;
                } else if (allowed.has("comment")) {
                    // Suggestion overlaps an existing one — fall back to a comment so
                    // the AI's feedback is not silently lost.
                    toast.warning(
                        "A suggestion overlapped an existing one — added as a comment instead.",
                    );
                    createComment({
                        targetText: ann.targetText,
                        comment: `${ann.rationale ?? "Suggested replacement"}: "${ann.replacement}"`,
                        author: autoAISettings.persona,
                        aiProvenance: provenance,
                        view,
                    });
                    applied++;
                }
            } else if (ann.type === "revision") {
                const created = createRevision({
                    targetText: ann.targetText,
                    versions: ann.versions,
                    threadMessage: ann.threadMessage,
                    author: autoAISettings.persona,
                    aiProvenance: provenance,
                    view,
                });
                if (created) {
                    applied++;
                } else if (allowed.has("comment")) {
                    // Revision overlaps an existing one — fall back to a comment so
                    // the AI's feedback is not silently lost.
                    toast.warning(
                        "A revision overlapped an existing one — added as a comment instead.",
                    );
                    createComment({
                        targetText: ann.targetText,
                        comment: `${ann.threadMessage} (suggested version: "${ann.versions[0].label}" — ${ann.versions[0].text})`,
                        author: autoAISettings.persona,
                        aiProvenance: provenance,
                        view,
                    });
                    applied++;
                }
            }
        } catch {
            // targetText lookup failed (e.g. doc changed mid-review) — skip.
        }
    }
    return applied;
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
            if (manual) toast("The draft changed during review, so the result was discarded.");
            return;
        }
        lastReviewedContent = content;
        lastReviewedTargetKey = targetKey();
        const applied = applyAnnotations({
            result: object,
            target,
            allowedActions: policy.allowedActions,
            provenance,
        });
        if (manual && applied === 0) {
            toast("No issues found — your writing looks good.");
        }
    } catch (e) {
        if (abortSignal.aborted) return;
        console.error("[AutoAI] review failed:", e);
        captureException(e);
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

    unsubscribe = documentContent.subscribe((content) => {
        contentGeneration++;
        cancelPendingReview();
        if (!autoAISettings.enabled) return;
        if (autoAISettings.mode !== "continuous") return;
        // Locked drafts are read-only — don't burn an AI call reviewing
        // text that can't be annotated (#160).
        if (get(editorView)?.state.readOnly) return;
        const currentTargetKey = targetKey();
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
