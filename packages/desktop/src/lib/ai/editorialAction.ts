/**
 * editorialAction.ts - One guarded gateway for AI-created editor annotations.
 *
 * The gateway resolves an exact, unique range inside the request's current scope,
 * screens stale and duplicate work, and then calls the ordinary CodeMirror annotation
 * commands. Streamed tools and AutoAI use this same path so their safety rules cannot drift.
 */

import {
    annotationField,
    createComment,
    createRevision,
    createSuggestion,
} from "$lib/editor/plugins/annotations";
import {
    type AiGenerationProvenance,
    type Annotations,
    isAnnotationOfType,
} from "$lib/editor/plugins/annotations/models";
import { EditorSelection, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { AiTextRange } from "./context";
import type { EditorialAction } from "./editorialPolicy";
import {
    type EditorialTargetSnapshot,
    type EditorialTargetState,
    getEditorialBranchPath,
    resolveEditorialTargetRange,
    resolveEditorialTargetView,
    validateEditorialActionTarget,
} from "./editorialTarget";

export type EditorialActionPayload =
    | {
          action: "comment";
          targetText: string;
          context?: string;
          comment: string;
      }
    | {
          action: "suggestion";
          targetText: string;
          context?: string;
          replacements: Array<{ text: string; rationale?: string } | string>;
          comment?: string;
      }
    | {
          action: "revision";
          targetText: string;
          context?: string;
          versions: Array<{ label: string; text: string }>;
          threadMessage: string;
      };

type TargetValidationFailure = Exclude<
    ReturnType<typeof validateEditorialActionTarget>,
    { ok: true }
>["reason"];

export type EditorialActionFailureReason =
    | TargetValidationFailure
    | "read-only"
    | "target-not-found"
    | "target-ambiguous"
    | "duplicate-concern"
    | "annotation-conflict";

export type EditorialActionResult =
    | { ok: true; view: EditorView; selection: EditorSelection }
    | { ok: false; reason: EditorialActionFailureReason };

export type EditorialActionIdentity = Pick<
    EditorialTargetState,
    "documentId" | "tabId" | "draftId"
>;

type ExactRangeResolution =
    | { ok: true; range: AiTextRange }
    | { ok: false; reason: "target-not-found" | "target-ambiguous" };

const CONCERN_STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "with",
]);

function exactRanges(text: string, target: string, scope: AiTextRange): AiTextRange[] {
    if (!target || scope.from < 0 || scope.to > text.length || scope.from > scope.to) return [];
    const ranges: AiTextRange[] = [];
    let from = text.indexOf(target, scope.from);
    while (from !== -1 && from + target.length <= scope.to) {
        ranges.push({ from, to: from + target.length });
        from = text.indexOf(target, from + 1);
    }
    return ranges;
}

/** Resolve model text to one exact range. Ambiguous text is never expanded to multiple ranges. */
export function resolveExactEditorialRange({
    documentText,
    targetText,
    context,
    scope,
}: {
    documentText: string;
    targetText: string;
    context?: string;
    scope?: AiTextRange;
}): ExactRangeResolution {
    const effectiveScope = scope ?? { from: 0, to: documentText.length };
    const candidates = exactRanges(documentText, targetText, effectiveScope);
    if (candidates.length === 0) return { ok: false, reason: "target-not-found" };

    if (context) {
        const contextRanges = exactRanges(documentText, context, effectiveScope);
        const contextualCandidates = candidates.filter((candidate) =>
            contextRanges.some(
                (contextRange) =>
                    candidate.from >= contextRange.from && candidate.to <= contextRange.to,
            ),
        );
        if (contextualCandidates.length === 1) {
            return { ok: true, range: contextualCandidates[0] };
        }
        if (contextualCandidates.length > 1) {
            return { ok: false, reason: "target-ambiguous" };
        }
    }

    return candidates.length === 1
        ? { ok: true, range: candidates[0] }
        : { ok: false, reason: "target-ambiguous" };
}

function normalizeConcern(text: string): string {
    return text
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function meaningfulWords(text: string): Set<string> {
    return new Set(
        normalizeConcern(text)
            .split(" ")
            .filter((word) => word.length > 2 && !CONCERN_STOP_WORDS.has(word)),
    );
}

function concernsMatch(left: string, right: string): boolean {
    const normalizedLeft = normalizeConcern(left);
    const normalizedRight = normalizeConcern(right);
    if (!normalizedLeft || !normalizedRight) return false;
    if (normalizedLeft === normalizedRight) return true;

    const leftWords = meaningfulWords(normalizedLeft);
    const rightWords = meaningfulWords(normalizedRight);
    const smallerSize = Math.min(leftWords.size, rightWords.size);
    if (smallerSize < 4) return false;
    let intersection = 0;
    for (const word of leftWords) {
        if (rightWords.has(word)) intersection += 1;
    }
    return intersection / smallerSize >= 0.8;
}

function rangesOverlap(left: SelectionRange, right: SelectionRange): boolean {
    return left.from < right.to && left.to > right.from;
}

function payloadConcerns(payload: EditorialActionPayload): string[] {
    if (payload.action === "comment") return [payload.comment];
    if (payload.action === "revision") return [payload.threadMessage];
    return [
        ...(payload.comment ? [payload.comment] : []),
        ...payload.replacements.flatMap((replacement) =>
            typeof replacement === "string" || !replacement.rationale
                ? []
                : [replacement.rationale],
        ),
    ];
}

function annotationConcerns(annotations: Annotations, selection: EditorSelection): string[] {
    const concerns: string[] = [];
    for (const annotation of Object.values(annotations)) {
        if (annotation.status !== "active") continue;
        if (
            !annotation.selection.ranges.some((existing) =>
                selection.ranges.some((candidate) => rangesOverlap(existing, candidate)),
            )
        ) {
            continue;
        }
        concerns.push(...annotation.thread.map((message) => message.message));
        if (isAnnotationOfType(annotation, "suggestion")) {
            concerns.push(
                ...annotation.replacements.flatMap((replacement) =>
                    replacement.rationale ? [replacement.rationale] : [],
                ),
            );
        }
    }
    return concerns;
}

export function isDuplicateEditorialConcern({
    annotations,
    selection,
    payload,
}: {
    annotations: Annotations;
    selection: EditorSelection;
    payload: EditorialActionPayload;
}): boolean {
    const candidates = payloadConcerns(payload);
    if (candidates.length === 0) return false;
    const existing = annotationConcerns(annotations, selection);
    return candidates.some((candidate) =>
        existing.some((concern) => concernsMatch(candidate, concern)),
    );
}

export function applyEditorialAction({
    rootView,
    target,
    current,
    allowedActions,
    payload,
    provenance,
    author,
}: {
    rootView: EditorView;
    target: EditorialTargetSnapshot;
    current: EditorialActionIdentity;
    allowedActions: readonly EditorialAction[];
    payload: EditorialActionPayload;
    provenance: AiGenerationProvenance;
    author?: string;
}): EditorialActionResult {
    const view = resolveEditorialTargetView(rootView, target);
    if (!view) return { ok: false, reason: "branch-changed" };
    if (view.state.readOnly) return { ok: false, reason: "read-only" };

    const selectedTextRange = resolveEditorialTargetRange(view, target);
    const documentText = view.state.doc.toString();
    const validation = validateEditorialActionTarget({
        snapshot: target,
        current: {
            ...current,
            documentText,
            selectedTextRange,
            branchPath: getEditorialBranchPath(view),
        },
        targetText: payload.targetText,
        action: payload.action,
        allowedActions,
    });
    if (!validation.ok) return validation;

    const resolution = resolveExactEditorialRange({
        documentText,
        targetText: payload.targetText,
        context: payload.context,
        scope: selectedTextRange,
    });
    if (!resolution.ok) return resolution;

    const selection = EditorSelection.single(resolution.range.from, resolution.range.to);
    const annotations = view.state.field(annotationField);
    if (isDuplicateEditorialConcern({ annotations, selection, payload })) {
        return { ok: false, reason: "duplicate-concern" };
    }

    let created = false;
    if (payload.action === "comment") {
        created = createComment({
            editorSelection: selection,
            comment: payload.comment,
            author,
            aiProvenance: provenance,
            view,
        });
    } else if (payload.action === "suggestion") {
        created = createSuggestion({
            editorSelection: selection,
            replacements: payload.replacements,
            comment: payload.comment,
            author,
            aiProvenance: provenance,
            state: view.state,
            dispatch: view.dispatch,
        });
    } else {
        created = createRevision({
            editorSelection: selection,
            versions: payload.versions,
            threadMessage: payload.threadMessage,
            author,
            aiProvenance: provenance,
            view,
        });
    }

    return created ? { ok: true, view, selection } : { ok: false, reason: "annotation-conflict" };
}

export function editorialActionFailureMessage(reason: EditorialActionFailureReason): string {
    switch (reason) {
        case "target-ambiguous":
            return "The AI target matched more than one passage, so Quillium skipped the annotation.";
        case "target-not-found":
            return "The AI target could not be found, so Quillium skipped the annotation.";
        case "read-only":
            return "This draft is read-only, so Quillium skipped the AI annotation.";
        case "duplicate-concern":
            return "Quillium skipped an AI annotation that repeated an open concern.";
        case "annotation-conflict":
            return "The AI annotation overlapped an incompatible open annotation, so Quillium skipped it.";
        case "branch-changed":
            return "The revision branch changed, so Quillium skipped the AI annotation.";
        case "action-forbidden":
            return "That AI action was not allowed for this request, so Quillium skipped it.";
        case "outside-selection":
        case "selection-changed":
            return "The selected passage changed, so Quillium skipped the AI annotation.";
        case "document-changed":
        case "tab-changed":
        case "draft-changed":
            return "The active draft changed, so Quillium skipped the AI annotation.";
    }
}
