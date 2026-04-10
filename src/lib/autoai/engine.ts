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
import { documentContent, editorView } from "$lib/stores";
import { createModel } from "$lib/ai/provider";
import { aiSettings, ensureApiKeyLoaded } from "$lib/ai/settings.svelte";
import { setAiProcessing, getAiAbortSignal } from "$lib/ai/settings.svelte";
import {
    createComment,
    createSuggestion,
    createRevision,
} from "$lib/editor/plugins/annotations/index";
import { autoAISettings, type AutoAIConservativeness } from "./settings.svelte";
import { toast } from "svelte-sonner";

/** True while the debounce timer has fired but the AI call has not yet started. */
export const autoAIThinking = writable(false);

/** True while AutoAI is actively running an AI review (distinct from the global aiProcessing). */
export const autoAIReviewing = writable(false);

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

IMPORTANT RULES:
- targetText must be an EXACT substring of the document. Copy it verbatim.
- Keep targetText as short as possible while still being specific (a sentence or phrase, not paragraphs).
- Only annotate issues that fall within the allowed annotation types.
- Return valid JSON matching the schema. No prose outside JSON.`;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastReviewedContent = "";
let unsubscribe: (() => void) | null = null;

function applyAnnotations(result: ReviewResult, doc: string): number {
    const view = get(editorView);
    if (!view) return 0;

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
        autoAIThinking.set(false);
        return;
    }

    const abortSignal = getAiAbortSignal();
    try {
        await ensureApiKeyLoaded();
        // Transition thinking → reviewing only after the async key load,
        // so the >_< face is visible during the ensureApiKeyLoaded wait.
        autoAIThinking.set(false);
        setAiProcessing(true);
        autoAIReviewing.set(true);
        const model = createModel(aiSettings.provider, aiSettings.apiKey, aiSettings.model);
        const { object } = await generateObject({
            model,
            schema: AnnotationSchema,
            system: buildSystemPrompt(),
            prompt: `Review this document:\n\n${content}`,
            abortSignal,
        });
        lastReviewedContent = content;
        const applied = applyAnnotations(object, content);
        if (manual && applied === 0) {
            toast("No issues found — your writing looks good.");
        }
    } catch (e) {
        if (abortSignal.aborted) return;
        console.error("[AutoAI] review failed:", e);
    } finally {
        autoAIThinking.set(false);
        autoAIReviewing.set(false);
        setAiProcessing(false);
    }
}

let thinkingTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReview(content: string) {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (thinkingTimer !== null) clearTimeout(thinkingTimer);
    autoAIThinking.set(false);
    thinkingTimer = setTimeout(() => {
        thinkingTimer = null;
        autoAIThinking.set(true);
    }, autoAISettings.debounceMs * 0.7);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runReview(content);
    }, autoAISettings.debounceMs);
}

/** Start the AutoAI engine. Call when the user enables AutoAI. */
export function startAutoAI() {
    if (unsubscribe) return; // already running

    unsubscribe = documentContent.subscribe((content) => {
        if (!autoAISettings.enabled) return;
        if (autoAISettings.mode !== "continuous") return;
        const diff = Math.abs(content.length - lastReviewedContent.length);
        if (diff < MIN_DIFF_CHARS && lastReviewedContent !== "") return;
        scheduleReview(content);
    });

    // Cancel pending reviews when the global stop event fires.
    window.addEventListener("quillium:stop-ai", cancelPendingReview);
}

/** Stop the engine and cancel any pending review. */
export function stopAutoAI() {
    cancelPendingReview();
    window.removeEventListener("quillium:stop-ai", cancelPendingReview);
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
    if (thinkingTimer !== null) {
        clearTimeout(thinkingTimer);
        thinkingTimer = null;
    }
    autoAIThinking.set(false);
}

/** Trigger an immediate review (used by manual mode / widget click). */
export function triggerManualReview() {
    const content = get(documentContent);
    if (!content.trim()) return;
    cancelPendingReview();
    runReview(content, true);
}
