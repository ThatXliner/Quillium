import {
    isAnnotationOfType,
    versionText,
    type Annotations,
    type GenericAnnotation,
} from "$lib/editor/plugins/annotations/models";
import type { AiTextRange, AnnotationContextInput } from "./context";

type BuildAnnotationContextOptions = {
    annotations?: Annotations;
    documentContent?: string;
    selectedText?: string;
    selectedTextRange?: AiTextRange;
    activeAnnotation?: GenericAnnotation;
};

const TARGET_CONTEXT_CHARS = 180;
const SELECTION_FOCUS_FALLBACK_CHARS = 2400;
const MAX_PARAGRAPH_FOCUS_CHARS = 6400;
const HUGE_PARAGRAPH_CHARS = 4200;

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

function rangesOverlap(a: [number, number], b: [number, number]): boolean {
    const [aFrom, aTo] = a;
    const [bFrom, bTo] = b;
    return aFrom <= bTo && aTo >= bFrom;
}

function normalizeTextRange(documentContent: string, range?: AiTextRange): [number, number] | null {
    if (!documentContent || !range) return null;
    const from = clamp(Math.min(range.from, range.to), 0, documentContent.length);
    const to = clamp(Math.max(range.from, range.to), from, documentContent.length);
    return to > from ? [from, to] : null;
}

function selectedRange(
    documentContent: string,
    selectedText?: string,
    selectedTextRange?: AiTextRange,
): [number, number] | null {
    const exactRange = normalizeTextRange(documentContent, selectedTextRange);
    if (exactRange) return exactRange;

    const selection = selectedText?.trim() ?? "";
    if (!documentContent || !selection) return null;
    const exact = documentContent.indexOf(selectedText ?? "");
    if (exact >= 0) return [exact, exact + (selectedText ?? "").length];
    const trimmed = documentContent.indexOf(selection);
    if (trimmed >= 0) return [trimmed, trimmed + selection.length];
    return null;
}

function paragraphBlocks(documentContent: string): AiTextRange[] {
    const blocks: AiTextRange[] = [];
    const pattern = /\S[\s\S]*?(?=\n\s*\n|$)/g;

    while (true) {
        const match = pattern.exec(documentContent);
        if (!match) break;

        const raw = match[0];
        const trailingWhitespace = raw.match(/\s+$/)?.[0].length ?? 0;
        const from = match.index;
        const to = from + raw.length - trailingWhitespace;
        if (to > from) blocks.push({ from, to });
        if (pattern.lastIndex === match.index) pattern.lastIndex++;
    }

    return blocks;
}

function paragraphFocusRange(
    documentContent: string,
    selection: [number, number],
): [number, number] | null {
    const blocks = paragraphBlocks(documentContent);
    const selectedIndexes = blocks
        .map((block, index) => (rangesOverlap(selection, [block.from, block.to]) ? index : -1))
        .filter((index) => index >= 0);

    if (selectedIndexes.length === 0) return null;

    const firstSelected = selectedIndexes[0];
    const lastSelected = selectedIndexes[selectedIndexes.length - 1];
    const startIndex = Math.max(0, firstSelected - 1);
    const endIndex = Math.min(blocks.length - 1, lastSelected + 1);
    const selectedBlocks = blocks.slice(firstSelected, lastSelected + 1);
    const focusFrom = blocks[startIndex].from;
    const focusTo = blocks[endIndex].to;

    if (
        selectedBlocks.some((block) => block.to - block.from > HUGE_PARAGRAPH_CHARS) ||
        focusTo - focusFrom > MAX_PARAGRAPH_FOCUS_CHARS
    ) {
        return null;
    }

    return [focusFrom, focusTo];
}

function selectionAnnotationFocusRange(
    documentContent: string,
    selection: [number, number] | null,
): [number, number] | null {
    if (!selection) return null;
    return (
        paragraphFocusRange(documentContent, selection) ?? [
            clamp(selection[0] - SELECTION_FOCUS_FALLBACK_CHARS, 0, documentContent.length),
            clamp(selection[1] + SELECTION_FOCUS_FALLBACK_CHARS, 0, documentContent.length),
        ]
    );
}

function annotationInFocus(annotation: GenericAnnotation, focusRange: [number, number]): boolean {
    const { from, to } = annotation.selection.main;
    return rangesOverlap([from, to], focusRange);
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
    selectedTextRange,
    activeAnnotation,
}: BuildAnnotationContextOptions): AnnotationContextInput[] {
    if (!annotations) return [];

    const selection = selectedRange(documentContent, selectedText, selectedTextRange);
    const focusRange = selectionAnnotationFocusRange(documentContent, selection);
    const scopedAnnotations = focusRange
        ? Object.values(annotations).filter((annotation) =>
              annotationInFocus(annotation, focusRange),
          )
        : Object.values(annotations);

    return scopedAnnotations.map((annotation) =>
        toAnnotationContextInput({
            annotation,
            documentContent,
            selection,
            activeAnnotation,
        }),
    );
}
