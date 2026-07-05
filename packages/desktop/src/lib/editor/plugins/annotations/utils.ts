/**
 * utils.ts — Annotation query and range-mapping utilities
 *
 * This file provides pure helper functions for querying and
 * transforming annotation data. It contains no state
 * definitions or side effects.
 *
 * Role in the annotation subsystem:
 *   - Supplies range-mapping logic (mapRange, cleanRangesOf)
 *     used by annotationField.ts to keep annotation positions
 *     in sync as the document changes.
 *   - Provides cursor-based queries (getActiveAnnotation,
 *     positionIntersects) used by index.ts to determine which
 *     annotation the user is interacting with.
 *   - Guards annotation creation (canCreateNewComment) to
 *     enforce single-pending-comment constraints.
 *
 * Key dependencies:
 *   - @codemirror/state for EditorSelection, SelectionRange,
 *     ChangeDesc, EditorState.
 *   - ./models for type definitions and type guards.
 *   - ./annotationField for reading the annotation StateField.
 *
 * Interactions:
 *   - annotationField.ts calls mapRange and cleanRangesOf
 *     inside the StateField reducer to remap annotation
 *     selections on every transaction.
 *   - index.ts calls getActiveAnnotation to resolve the
 *     annotation under the cursor for decoration and command
 *     logic.
 */

import {
    type ChangeDesc,
    EditorSelection,
    type EditorState,
    type SelectionRange,
} from "@codemirror/state";
import { annotationField } from "./annotationField";
import {
    type Annotation,
    type AnnotationType,
    type Annotations,
    type GenericAnnotation,
    isAnnotationOfType,
} from "./models";

// Filters out collapsed (zero-width) and inverted (from > to)
// ranges from a selection. Returns null if no valid ranges
// remain, which signals to the caller that the annotation
// should be removed.
// Revisions set allowEmpty=true so they survive even when
// their text is fully deleted (they can switch versions),
// but inverted ranges are always removed.
export function cleanRangesOf(selection: EditorSelection, allowEmpty = false) {
    // Fast path: check if any range needs filtering.
    const hasInverted = selection.ranges.some((r) => r.from > r.to);
    if (allowEmpty && !hasInverted) return selection;

    const newRanges = selection.ranges.filter(
        (range) => range.from <= range.to && (allowEmpty || range.from !== range.to),
    );
    const clampedMain = Math.min(selection.mainIndex, newRanges.length - 1);
    return newRanges.length > 0 ? EditorSelection.create(newRanges, clampedMain) : null;
}

// Equal type and selection
export function equalAnnotationsSignature(a: GenericAnnotation, b: GenericAnnotation) {
    return a.selection.eq(b.selection) && a._type === b._type;
}

export function positionIntersects(position: number, selection: SelectionRange) {
    return selection.from <= position && position <= selection.to;
}
// Resolves the "active" annotation — the one the cursor is
// currently inside. When multiple annotations overlap, the
// narrowest range wins (sorted by ascending span width).
// Pending annotations (empty thread for comments, empty
// versions for revisions) are returned immediately since they
// need user attention regardless of cursor position.
// Optionally filters by annotation type.
export function getActiveAnnotation<T extends AnnotationType>(
    state: EditorState,
    type: T,
): Annotation<T> | undefined;
export function getActiveAnnotation(state: EditorState): GenericAnnotation | undefined;
export function getActiveAnnotation<T extends AnnotationType>(
    state: EditorState,
    type?: T,
): Annotation<T> | GenericAnnotation | undefined {
    const cursor = state.selection.main;
    const cursorPos = cursor.head;

    const annotations = state.field(annotationField);
    const rangesWhereCursorIsInside: {
        range: SelectionRange;
        associatedAnnotation: Annotation<T> | GenericAnnotation;
    }[] = [];
    for (const annotation of Object.values(annotations)) {
        if (type !== undefined && !isAnnotationOfType(annotation, type)) continue;
        if (type === undefined) {
            // Active-state checks below use thread/version length as a proxy for
            // "pending" state; a proper FSM would make this more explicit (see #38).
            if (isAnnotationOfType(annotation, "comment") && annotation.thread.length === 0)
                return annotation;
            if (isAnnotationOfType(annotation, "revision") && annotation.versions.length === 0) {
                // I doubt this will ever happen though
                return annotation;
            }
        }
        for (const range of annotation.selection.ranges)
            if (
                positionIntersects(cursorPos, range) &&
                // Having this extra condition makes it feel like Google docs
                // Basically what this is doing that if the cursor is a selection,
                // we only want to show the annotation if the entire selection is within
                // a single annotation
                (!cursor.empty ? positionIntersects(cursor.anchor, range) : true)
            ) {
                rangesWhereCursorIsInside.push({
                    range,
                    associatedAnnotation: annotation,
                });
            }
    }
    return rangesWhereCursorIsInside.sort(
        (a, b) => a.range.to - a.range.from - (b.range.to - b.range.from),
    )?.[0]?.associatedAnnotation;
}

// export function getActiveAnnotations(state: EditorState): GenericAnnotation[] {
//   const cursor = state.selection.main;
//   const cursorPos = cursor.head;

//   const annotations = state.field(annotationField);
//   const rangesWhereCursorIsInside: {
//     range: SelectionRange;
//     associatedAnnotation: GenericAnnotation;
//   }[] = [];

//   for (const annotation of Object.values(annotations)) {
//     // TODO: change these "active checks" to use the state machine
//     if (
//       isAnnotationOfType(annotation, "comment") &&
//       annotation.thread.length === 0
//     )
//       return [annotation];
//     if (
//       isAnnotationOfType(annotation, "revision") &&
//       annotation.versions.length === 0
//     )
//       return [annotation];

//     for (const range of annotation.selection.ranges)
//       if (
//         positionIntersects(cursorPos, range) &&
//         // Having this extra condition makes it feel like Google docs
//         // Basically what this is doing that if the cursor is a selection,
//         // we only want to show the annotation if the entire selection is within
//         // a single annotation
//         (!cursor.empty ? positionIntersects(cursor.anchor, range) : true)
//       ) {
//         rangesWhereCursorIsInside.push({
//           range,
//           associatedAnnotation: annotation,
//         });
//       }
//   }
//   return rangesWhereCursorIsInside
//     .sort((a, b) => a.range.to - a.range.from - (b.range.to - b.range.from))
//     ?.map((x) => x.associatedAnnotation);
// }

// Returns true if the given selection does not overlap any existing revision.
// Revisions must not overlap because their nested-editor state and version
// switching logic assumes non-intersecting ranges — overlapping revisions
// produce undefined behaviour.
export function canCreateRevision(annotations: Annotations, selection: EditorSelection) {
    return !Object.values(annotations).some((annotation) => {
        if (!isAnnotationOfType(annotation, "revision")) return false;
        return selection.ranges.some((newRange) =>
            annotation.selection.ranges.some((r) => newRange.from < r.to && newRange.to > r.from),
        );
    });
}
// Returns true if the given selection does not overlap any existing suggestion.
export function canCreateSuggestion(annotations: Annotations, selection: EditorSelection) {
    return !Object.values(annotations).some((annotation) => {
        if (!isAnnotationOfType(annotation, "suggestion")) return false;
        return selection.ranges.some((newRange) =>
            annotation.selection.ranges.some((r) => newRange.from < r.to && newRange.to > r.from),
        );
    });
}
// Returns true if a new comment can be created. Enforces
// that at most one "pending" comment (thread.length === 0)
// exists at a time, preventing orphaned comment highlights.
export function canCreateNewComment(annotations: Annotations) {
    return (
        Object.values(annotations).length === 0 ||
        !Object.values(annotations).some(
            (annotation) =>
                isAnnotationOfType(annotation, "comment") && annotation.thread.length === 0,
        )
    );
}
// Maps an annotation's selection through a document change.
// Used as the `map` callback for StateEffect.define so that
// effects in the undo history stay positionally accurate.
// Returns undefined if the annotation's range was fully
// consumed by the change (which removes it from state).
export function mapRange(range: GenericAnnotation, change: ChangeDesc) {
    const allowEmpty = isAnnotationOfType(range, "revision");
    try {
        const newRanges = cleanRangesOf(range.selection.map(change), allowEmpty);
        if (newRanges) {
            return { ...range, selection: newRanges };
        }
    } catch {
        // Position out of range for this changeset (e.g. a resolver dispatch
        // on an empty doc while the effect carries pre-deletion positions).
        // Preserve the effect with its original positions so it survives to
        // the undo replay rather than being permanently dropped.
        return range;
    }
    return undefined;
}
