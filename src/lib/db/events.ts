/**
 * events.ts — Event payload type definitions for the event log.
 *
 * Each CodeMirror transaction is serialised into one of these
 * payload shapes before being written to the `events` table via
 * `append_event`. The Rust backend stores the payload as an
 * opaque JSON blob; only the `type` field is indexed.
 */

/** A single change operation within a doc_change event. */
export type ChangeSpec = {
    from: number;
    to: number;
    insert: string;
};

/** Serialised CM6 SelectionRange. */
export type SelectionRangeJSON = {
    anchor: number;
    head: number;
};

/** Serialised CM6 EditorSelection. */
export type SelectionJSON = {
    ranges: SelectionRangeJSON[];
    main: number;
};

/** Raw annotation data as stored in CM6 annotationField JSON. */
export type RawAnnotation = Record<string, unknown>;

// ── Annotation event sub-types ───────────────────────────────────

export type AnnotationAddEvent = {
    type: "annotation_add";
    annotation: RawAnnotation;
};

export type AnnotationRemoveEvent = {
    type: "annotation_remove";
    annotationId: number;
};

export type AnnotationUpdateEvent = {
    type: "annotation_update";
    annotation: RawAnnotation;
};

export type AnnotationEvent = AnnotationAddEvent | AnnotationRemoveEvent | AnnotationUpdateEvent;

// ── Top-level event payload union ────────────────────────────────

/** Pure text edit — no annotation changes. */
export type DocChangeEvent = {
    type: "doc_change";
    changes: ChangeSpec[];
    selection: SelectionJSON;
};

/**
 * Compound: doc change + annotation effects in the same transaction.
 */
export type CompoundEvent = {
    type: "compound";
    docChanges: ChangeSpec[];
    annotationEvents: AnnotationEvent[];
    selection: SelectionJSON;
};

/** Annotation-only event (no doc changes). */
export type AnnotationOnlyEvent = AnnotationEvent;

export type EventPayload =
    | DocChangeEvent
    | CompoundEvent
    | AnnotationAddEvent
    | AnnotationRemoveEvent
    | AnnotationUpdateEvent;
