/**
 * autoai/engine.ts — AutoAI review engine.
 *
 * Watches documentContent, debounces, calls the AI for a structured
 * JSON review, and dispatches annotations into the editor.
 *
 * Cost strategy: one non-streaming generateObject call per review cycle,
 * only fired when content changes meaningfully (>= MIN_DIFF_CHARS).
 */

import { get, writable } from "svelte/store";
import { generateObject } from "ai";
import { z } from "zod";
import { annotations, documentContent, editorView } from "$lib/stores";
import posthog from "$lib/posthog";
import { createModel } from "$lib/ai/provider";
import {
    aiSettings,
    documentContext,
    ensureApiKeyLoaded,
    beginAiTask,
    endAiTask,
    getAiAbortSignal,
} from "$lib/ai/settings.svelte";
import { buildAiContextPacket, contextPacketToPrompt } from "$lib/ai/context";
import { buildAnnotationContextInputs } from "$lib/ai/annotationContext";
import { buildDocumentContextPrompt } from "$lib/ai/utils";
import {
    createComment,
    createRevision,
    createSuggestion,
} from "$lib/editor/plugins/annotations/index";
import { appEventBus } from "$lib/events/appEventBus";
import { toast } from "svelte-sonner";
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

const AnnotationSchema = z.object({
    annotations: z.array(
        z.discriminatedUnion("type", [
            z.object({
                type: z.literal("comment"),
                targetText: z.string(),
                comment: z.string(),
            }),
            z.object({
                type: z.literal("suggestion"),
                targetText: z.string(),
                replacement: z.string(),
                rationale: z.string(),
            }),
            z.object({
                type: z.literal("revision"),
                targetText: z.string(),
                versionLabel: z.string(),
                versionText: z.string(),
                threadMessage: z.string(),
            }),
        ]),
    ),
});

type ReviewResult = z.infer<typeof AnnotationSchema>;

function buildSystemPrompt(): string {
    const { conservativeness, annotationTypes, persona } = autoAISettings;
    const allowed = annotationTypes.join(", ");
    return `You are ${persona}, an AI writing collaborator embedded in a writing app called Quillium. Your job is to review the document and return structured feedback as JSON.

Annotation types you may use: ${allowed}.
- comment: A note pointing out an issue or observation.
- suggestion: A replacement for a specific phrase (provide the exact original text and a better alternative).
- revision: Multiple named versions of a passage for the writer to compare.

${conservativenessPrompts[conservativeness]}
${buildDocumentContextPrompt(documentContext)}

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
let unsubscribe: (() => void) | null = null;
let unsubStopAi: (() => void) | null = null;

function applyAnnotations(result: ReviewResult): number {
    const view = get(editorView);
    if (!view) return 0;

    // Validate against the live document, not the reviewed snapshot — the
    // user may have edited while the AI call was in flight, and annotations
    // are applied to the live view.
    const doc = view.state.doc.toString();
    const allowed = new Set(autoAISettings.annotationTypes);
    let applied = 0;

    for (const ann of result.annotations) {
        // Skip annotation types the user disabled.
        if (!allowed.has(ann.type)) continue;
        // Verify the targetText actually exists in the current doc.
        if (!doc.includes(ann.targetText)) continue;

        try {
            if (ann.type === "comment") {
                createComment({
                    targetText: ann.targetText,
                    comment: ann.comment,
                    author: autoAISettings.persona,
                    view,
                });
                applied++;
            } else if (ann.type === "suggestion") {
                const created = createSuggestion({
                    targetText: ann.targetText,
                    replacements: [{ text: ann.replacement, rationale: ann.rationale }],
                    author: autoAISettings.persona,
                    state: view.state,
                    dispatch: view.dispatch.bind(view),
                });
                if (created) {
                    applied++;
                } else {
                    // Suggestion overlaps an existing one — fall back to a comment so
                    // the AI's feedback is not silently lost.
                    toast.warning(
                        "A suggestion overlapped an existing one — added as a comment instead.",
                    );
                    createComment({
                        targetText: ann.targetText,
                        comment: `${ann.rationale ?? "Suggested replacement"}: "${ann.replacement}"`,
                        author: autoAISettings.persona,
                        view,
                    });
                    applied++;
                }
            } else if (ann.type === "revision") {
                const created = createRevision({
                    targetText: ann.targetText,
                    versions: [{ label: ann.versionLabel, text: ann.versionText }],
                    threadMessage: ann.threadMessage,
                    author: autoAISettings.persona,
                    view,
                });
                if (created) {
                    applied++;
                } else {
                    // Revision overlaps an existing one — fall back to a comment so
                    // the AI's feedback is not silently lost.
                    toast.warning(
                        "A revision overlapped an existing one — added as a comment instead.",
                    );
                    createComment({
                        targetText: ann.targetText,
                        comment: `${ann.threadMessage} (suggested version: "${ann.versionLabel}" — ${ann.versionText})`,
                        author: autoAISettings.persona,
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

async function runReview(content: string, manual = false) {
    if (!content.trim()) {
        autoAIPhase.set("idle");
        return;
    }

    const abortSignal = getAiAbortSignal();
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
            schema: AnnotationSchema,
            system: buildSystemPrompt(),
            prompt: `Review this context packet. Only create annotations for exact targetText substrings that appear in the included document text.\n\n${contextPacketToPrompt(contextPacket)}`,
            abortSignal,
        });
        lastReviewedContent = content;
        const applied = applyAnnotations(object);
        if (manual && applied === 0) {
            toast("No issues found — your writing looks good.");
        }
    } catch (e) {
        if (abortSignal.aborted) return;
        console.error("[AutoAI] review failed:", e);
        posthog.captureException(e instanceof Error ? e : new Error(String(e)));
    } finally {
        autoAIPhase.set("idle");
        endAiTask(task);
    }
}

function scheduleReview(content: string) {
    cancelPendingReview();
    debounceTimer = setTimeout(() => {
        // WAITING → WARNING: show thinking face for the last 30% of the window.
        autoAIPhase.set("thinking");
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            runReview(content);
        }, autoAISettings.debounceMs * 0.3);
    }, autoAISettings.debounceMs * 0.7);
}

/** Start the AutoAI engine. Call when the user enables AutoAI. */
export function startAutoAI() {
    if (unsubscribe) return; // already running

    unsubscribe = documentContent.subscribe((content) => {
        if (!autoAISettings.enabled) return;
        if (autoAISettings.mode !== "continuous") return;
        // Locked drafts are read-only — don't burn an AI call reviewing
        // text that can't be annotated (#160).
        if (get(editorView)?.state.readOnly) return;
        const diff = Math.abs(content.length - lastReviewedContent.length);
        if (diff < MIN_DIFF_CHARS && lastReviewedContent !== "") return;
        scheduleReview(content);
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
}

/** Cancel any pending debounced review without stopping the engine. */
export function cancelPendingReview() {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    autoAIPhase.set("idle");
}

/** Trigger an immediate review (used by manual mode / widget click). */
export function triggerManualReview() {
    const content = get(documentContent);
    if (!content.trim()) return;
    cancelPendingReview();
    runReview(content, true);
}
