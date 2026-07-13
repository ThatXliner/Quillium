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

// ── Exact transaction replay ─────────────────────────────────────

/** Tagged Quillium StateEffect payload used by history and event-tail replay. */
export type SerializedHistoryEffect = {
    type: string;
    value: unknown;
};

/** History-relevant annotations carried by a normal CodeMirror transaction. */
export type TransactionReplayAnnotations = {
    addToHistory: boolean;
    /**
     * The accepted transaction ran while CodeMirror history was unavailable.
     * Live collaboration temporarily removes historyField, so any older
     * snapshot branch is unsafe to carry across this transaction boundary.
     */
    historyRuntimeDisabled?: true;
    time?: number;
    userEvent?: string;
    isolateHistory?: "before" | "after" | "full";
    /** True when the live transaction began a distinct CodeMirror undo group. */
    startsNewHistoryGroup?: boolean;
    /** The live done branch held only an omitted selection sentinel before this transaction. */
    startsWithSelectionSentinel?: boolean;
    /**
     * Full selection-only contribution attached to the live done-branch top.
     * Replay reconciles this against the snapshot prefix before applying the
     * transaction, preserving cursor restoration through later undo/redo.
     */
    doneTopSelectionsAfter?: SelectionJSON[];
    revisionInternalEdit?: boolean;
    nestedEditorEdit?: number;
    revisionCleanup?: boolean;
};

/**
 * One accepted CodeMirror transaction, or an undo/redo command. Normal entries
 * store ChangeSet JSON rather than aggregate ChangeSpecs so multi-range edits
 * and transaction boundaries can be replayed exactly.
 */
export type NormalTransactionReplayEntry = {
    kind: "transaction";
    changeSet: unknown;
    effects: SerializedHistoryEffect[];
    /** Selection immediately before the accepted transaction. */
    startSelection?: SelectionJSON;
    /** Exact post-transaction selection (including implicit change mapping). */
    selection?: SelectionJSON;
    annotations: TransactionReplayAnnotations;
};

/** Merge a recorded isolation annotation with the live grouping boundary. */
export function replayHistoryIsolationOf(
    annotations: TransactionReplayAnnotations,
): "before" | "after" | "full" | undefined {
    const stored = annotations.isolateHistory;
    if (!annotations.startsNewHistoryGroup) return stored;
    if (stored === "after" || stored === "full") return "full";
    return "before";
}

export type TransactionReplayEntry =
    | NormalTransactionReplayEntry
    | { kind: "undo"; fallback: NormalTransactionReplayEntry }
    | { kind: "redo"; fallback: NormalTransactionReplayEntry };

/** Versioned trace attached to new event payloads. Legacy events omit it. */
export type TransactionReplayTrace = {
    version: 1;
    transactions: TransactionReplayEntry[];
};

/** Last-resort exact field snapshot when a future effect lacks a trace codec. */
export type PersistedStateFallback = {
    doc: string;
    annotations: Record<string, RawAnnotation>;
    versionGroups: unknown;
    selection: SelectionJSON;
};

type WithTransactionReplay = {
    transactionReplay?: TransactionReplayTrace;
    stateFallback?: PersistedStateFallback;
};

// ── Annotation event sub-types ───────────────────────────────────

export type AnnotationAddEvent = WithTransactionReplay & {
    type: "annotation_add";
    annotation: RawAnnotation;
};

export type AnnotationRemoveEvent = WithTransactionReplay & {
    type: "annotation_remove";
    annotationId: number;
};

export type AnnotationUpdateEvent = WithTransactionReplay & {
    type: "annotation_update";
    annotation: RawAnnotation;
};

export type AnnotationEvent = AnnotationAddEvent | AnnotationRemoveEvent | AnnotationUpdateEvent;

// ── Top-level event payload union ────────────────────────────────

/** Pure text edit — no annotation changes. */
export type DocChangeEvent = WithTransactionReplay & {
    type: "doc_change";
    changes: ChangeSpec[];
    selection: SelectionJSON;
    /** Optional provenance — omitted on legacy events (treated as "unknown"). */
    provenance?: Provenance;
};

/**
 * Compound: doc change + annotation effects in the same transaction.
 */
export type CompoundEvent = WithTransactionReplay & {
    type: "compound";
    docChanges: ChangeSpec[];
    annotationEvents: AnnotationEvent[];
    selection: SelectionJSON;
    /** Optional provenance — omitted on legacy events (treated as "unknown"). */
    provenance?: Provenance;
};

/** Annotation-only event (no doc changes). */
export type AnnotationOnlyEvent = AnnotationEvent;

/** Effect-only persisted-state change, such as version-group membership. */
export type StateTransactionEvent = {
    type: "state_transaction";
} & WithTransactionReplay;

export type EventPayload =
    | DocChangeEvent
    | CompoundEvent
    | AnnotationAddEvent
    | AnnotationRemoveEvent
    | AnnotationUpdateEvent
    | StateTransactionEvent;
