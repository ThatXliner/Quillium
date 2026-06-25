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

// ── Provenance (authorship proof) ────────────────────────────────
//
// Provenance enriches doc-changing events with *where the change came
// from* — typed vs pasted vs an accepted AI revision — so an authorship
// report can show evidence of the human writing process. It is captured
// per-event (one CodeMirror transaction = one event = one userEvent +
// one revision/nested marker) and is OPTIONAL: legacy events written
// before this feature simply lack the field and are treated as
// `origin: "unknown"`. See src/lib/provenance/classify.ts.

/** Classification of where a doc-changing event originated. */
export type ChangeOrigin =
    | "type" // input.type / input.type.compose — human keystrokes
    | "paste" // input.paste
    | "cut" // delete.cut
    | "delete" // delete.* (non-cut)
    | "restore" // input.restore — crash-recovery replay, NOT authorship
    | "format" // bare userEvent "input" (markdownFormatting)
    | "ai-revision" // revisionInternalEdit present — accepted version switch
    | "nested-edit" // nestedEditorEdit present
    | "unknown"; // legacy event or unrecognized userEvent

/** Optional provenance metadata attached to doc_change / compound events. */
export type Provenance = {
    origin: ChangeOrigin;
    /** Raw tr.annotation(Transaction.userEvent), preserved verbatim for forensics. */
    userEvent?: string;
    /** Total inserted-char count across the event's ChangeSpecs (paste-size heuristic). */
    insertedChars?: number;
    /** Total removed-char count (sum of toA - fromA). */
    removedChars?: number;
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
    /** Optional provenance — omitted on legacy events (treated as "unknown"). */
    provenance?: Provenance;
};

/**
 * Compound: doc change + annotation effects in the same transaction.
 */
export type CompoundEvent = {
    type: "compound";
    docChanges: ChangeSpec[];
    annotationEvents: AnnotationEvent[];
    selection: SelectionJSON;
    /** Optional provenance — omitted on legacy events (treated as "unknown"). */
    provenance?: Provenance;
};

/** Annotation-only event (no doc changes). */
export type AnnotationOnlyEvent = AnnotationEvent;

export type EventPayload =
    | DocChangeEvent
    | CompoundEvent
    | AnnotationAddEvent
    | AnnotationRemoveEvent
    | AnnotationUpdateEvent;
