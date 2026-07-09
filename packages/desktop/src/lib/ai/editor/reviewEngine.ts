/**
 * reviewEngine.ts — Shared structured review runner for manual Quillium and AutoAI.
 *
 * Both entry points generate the same validated editor response and apply it as
 * anchored annotations. The UI decides when to run; this module decides how a
 * review becomes safe, non-destructive margin feedback.
 */

import { createModel } from "$lib/ai/provider";
import { aiSettings, ensureApiKeyLoaded } from "$lib/ai/settings.svelte";
import {
    createComment,
    createRevision,
    createSuggestion,
} from "$lib/editor/plugins/annotations/index";
import type { Annotations } from "$lib/editor/plugins/annotations/models";
import type { ReaderPersona } from "$lib/readers/presets";
import { buildPersonaPrompt } from "$lib/readers/prompt";
import type { EditorView } from "@codemirror/view";
import { generateObject } from "ai";
import {
    QuilliumEditorResponseSchema,
    type AnnotationCandidate,
    type QuilliumEditorRequest,
    type QuilliumEditorResponse,
    validateEditorResponse,
} from "./editorContract";
import { buildEditorSystemPrompt, buildEditorUserPrompt } from "./editorPrompt";

export type AppliedEditorReview = {
    applied: number;
    skipped: number;
};

export type EditorAnnotationType = "comment" | "suggestion" | "revision";

export function summarizeExistingAnnotations(
    annotations: Annotations,
    documentText: string,
): QuilliumEditorRequest["existingAnnotations"] {
    return Object.values(annotations).map((annotation) => {
        const { from, to } = annotation.selection.main;
        return {
            id: String(annotation.id),
            quote: documentText.slice(from, to),
            comment: annotation.thread.map((message) => message.message).join("\n"),
            resolved: false,
        };
    });
}

export async function generateEditorReview(args: {
    request: QuilliumEditorRequest;
    persona?: ReaderPersona;
    abortSignal?: AbortSignal;
}): Promise<QuilliumEditorResponse> {
    await ensureApiKeyLoaded();
    const model = createModel(
        aiSettings.provider,
        aiSettings.apiKey,
        aiSettings.model,
        aiSettings.baseURL,
    );
    const personaPrompt = args.persona ? buildPersonaPrompt(args.persona) : undefined;
    const { object } = await generateObject({
        model,
        schema: QuilliumEditorResponseSchema,
        system: buildEditorSystemPrompt({ personaPrompt }),
        prompt: buildEditorUserPrompt(args.request),
        abortSignal: args.abortSignal,
    });

    return validateEditorResponse(args.request, object);
}

function formatMarginNote(annotation: AnnotationCandidate): string {
    const sections = [`${annotation.title}: ${annotation.observation}`, annotation.whyItMatters];
    if (annotation.readerEffect) sections.push(`Reader effect: ${annotation.readerEffect}`);
    if (annotation.writerQuestions.length > 0) {
        sections.push(
            annotation.writerQuestions.map((question) => `Question: ${question}`).join("\n"),
        );
    }

    const writerStrategies = annotation.revisionStrategies.filter(
        (strategy) => !strategy.includesReplacementText,
    );
    if (writerStrategies.length > 0) {
        sections.push(
            writerStrategies
                .map(
                    (strategy) =>
                        `${strategy.label}: ${strategy.writerAction} Tradeoff: ${strategy.tradeoff}`,
                )
                .join("\n"),
        );
    }
    return sections.filter(Boolean).join("\n\n");
}

export function applyEditorReview(args: {
    request: QuilliumEditorRequest;
    response: QuilliumEditorResponse;
    view: EditorView;
    author?: string;
    allowedAnnotationTypes?: EditorAnnotationType[];
}): AppliedEditorReview {
    const documentText = args.view.state.doc.toString();
    const maxAnnotations = args.request.maxAnnotations ?? args.response.annotations.length;
    let applied = 0;
    let skipped = 0;
    const allowed = new Set<EditorAnnotationType>(
        args.allowedAnnotationTypes ?? ["comment", "suggestion"],
    );

    for (const annotation of args.response.annotations.slice(0, maxAnnotations)) {
        const targetText = annotation.target.quote;
        if (!targetText || !documentText.includes(targetText)) {
            skipped++;
            continue;
        }

        const replacements = annotation.revisionStrategies
            .filter(
                (strategy) =>
                    strategy.includesReplacementText && !!strategy.replacementText?.trim(),
            )
            .map((strategy) => ({
                text: strategy.replacementText?.trim() ?? "",
                rationale: `${strategy.description} Tradeoff: ${strategy.tradeoff}`,
            }));

        try {
            if (allowed.has("revision") && replacements.length > 1) {
                const created = createRevision({
                    targetText,
                    versions: annotation.revisionStrategies
                        .filter(
                            (strategy) =>
                                strategy.includesReplacementText &&
                                !!strategy.replacementText?.trim(),
                        )
                        .map((strategy) => ({
                            label: strategy.label,
                            text: strategy.replacementText?.trim() ?? "",
                        })),
                    threadMessage: formatMarginNote(annotation),
                    author: args.author ?? "Quillium",
                    view: args.view,
                });
                if (created) {
                    applied++;
                    continue;
                }
            }

            if (allowed.has("suggestion") && replacements.length > 0) {
                const created = createSuggestion({
                    targetText,
                    replacements,
                    comment: formatMarginNote(annotation),
                    state: args.view.state,
                    dispatch: args.view.dispatch.bind(args.view),
                    author: args.author ?? "Quillium",
                });
                if (created) {
                    applied++;
                    continue;
                }
            }

            if (!allowed.has("comment")) {
                skipped++;
                continue;
            }
            createComment({
                targetText,
                comment: formatMarginNote(annotation),
                author: args.author ?? "Quillium",
                view: args.view,
            });
            applied++;
        } catch {
            skipped++;
        }
    }

    return { applied, skipped };
}
