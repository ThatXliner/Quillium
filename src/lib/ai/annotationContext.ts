import {
    isAnnotationOfType,
    versionText,
    type Annotations,
    type GenericAnnotation,
} from "$lib/editor/plugins/annotations/models";
import type { AnnotationContextInput } from "./context";

type BuildAnnotationContextOptions = {
    annotations?: Annotations;
    documentContent?: string;
    selectedText?: string;
    activeAnnotation?: GenericAnnotation;
};

const TARGET_CONTEXT_CHARS = 180;

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function rangeDistance(
    annotationFrom: number,
    annotationTo: number,
    selection: [number, number] | null,
): number | undefined {
    if (!selection) return undefined;
    const [selectionFrom, selectionTo] = selection;
    if (annotationFrom <= selectionTo && annotationTo >= selectionFrom) return 0;
    if (annotationTo < selectionFrom) return selectionFrom - annotationTo;
    return annotationFrom - selectionTo;
}

function selectedRange(documentContent: string, selectedText?: string): [number, number] | null {
    const selection = selectedText?.trim() ?? "";
    if (!documentContent || !selection) return null;
    const exact = documentContent.indexOf(selectedText ?? "");
    if (exact >= 0) return [exact, exact + (selectedText ?? "").length];
    const trimmed = documentContent.indexOf(selection);
    if (trimmed >= 0) return [trimmed, trimmed + selection.length];
    return null;
}

function annotationTarget(documentContent: string, annotation: GenericAnnotation): string {
    if (!documentContent) return "";
    const { from, to } = annotation.selection.main;
    const start = clamp(from, 0, documentContent.length);
    const end = clamp(to, start, documentContent.length);
    return documentContent.slice(start, end);
}

function annotationNearby(documentContent: string, annotation: GenericAnnotation): string {
    if (!documentContent) return "";
    const { from, to } = annotation.selection.main;
    const start = clamp(from - TARGET_CONTEXT_CHARS, 0, documentContent.length);
    const end = clamp(to + TARGET_CONTEXT_CHARS, start, documentContent.length);
    return documentContent.slice(start, end);
}

function toAnnotationContextInput({
    annotation,
    documentContent,
    selection,
    activeAnnotation,
}: {
    annotation: GenericAnnotation;
    documentContent: string;
    selection: [number, number] | null;
    activeAnnotation?: GenericAnnotation;
}): AnnotationContextInput {
    const { from, to } = annotation.selection.main;
    const input: AnnotationContextInput = {
        id: annotation.id,
        type: annotation._type,
        targetText: annotationTarget(documentContent, annotation),
        context: annotationNearby(documentContent, annotation),
        messages: annotation.thread.map((message) => ({
            author: message.author,
            message: message.message,
        })),
        distance: rangeDistance(from, to, selection),
        active: activeAnnotation?.id === annotation.id,
    };

    if (isAnnotationOfType(annotation, "suggestion")) {
        input.replacements = annotation.replacements.map((replacement) => ({
            text: replacement.text,
            rationale: replacement.rationale,
        }));
    }

    if (isAnnotationOfType(annotation, "revision")) {
        input.versions = annotation.versions.map((version, index) => ({
            label: version.label ?? `Version ${index + 1}`,
            text: versionText(version),
        }));
    }

    return input;
}

export function buildAnnotationContextInputs({
    annotations,
    documentContent = "",
    selectedText,
    activeAnnotation,
}: BuildAnnotationContextOptions): AnnotationContextInput[] {
    if (!annotations) return [];

    const selection = selectedRange(documentContent, selectedText);
    return Object.values(annotations).map((annotation) =>
        toAnnotationContextInput({
            annotation,
            documentContent,
            selection,
            activeAnnotation,
        }),
    );
}
