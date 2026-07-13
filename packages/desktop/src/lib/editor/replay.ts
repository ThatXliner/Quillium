import type {
    AnnotationEvent,
    EventPayload,
    PersistedStateFallback,
    TransactionReplayAnnotations,
    TransactionReplayEntry,
    TransactionReplayTrace,
} from "$lib/db/events";
import { replayHistoryIsolationOf } from "$lib/db/events";
import type { EventRecord } from "$lib/db/types";
import { capture } from "$lib/posthog";
/**
 * replay.ts — Event log replay for crash recovery and session restore.
 *
 * Provides `replayEvents()` which applies a sequence of persisted
 * EventRecord objects on top of a snapshot-restored EditorState,
 * returning the up-to-date EditorState without needing an EditorView.
 *
 * Each event type is handled as follows:
 *   - doc_change   → apply ChangeSpec array + restore selection
 *   - compound     → apply doc changes + annotation effects + selection
 *   - annotation_add / annotation_update → dispatch addAnnotation effect
 *   - annotation_remove → dispatch removeAnnotation effect (annotation
 *     is looked up from the current state)
 *
 * Individual replay failures are caught and logged so that a single
 * corrupt or unexpected event does not block restoration of the rest
 * of the history.
 */
import { isolateHistory, redo, undo } from "@codemirror/commands";
import {
    type Annotation,
    ChangeSet,
    EditorSelection,
    EditorState,
    type Extension,
    type StateEffect,
    Transaction,
} from "@codemirror/state";
import { isEqual } from "lodash-es";
import { savedFields } from "./extensions";
import {
    deserializeHistoryEffect,
    historyDoneBranchIsEmpty,
    historyDoneTopInfo,
    persistHistoryFacet,
    persistentHistoryField,
} from "./persistentHistory";
import {
    _revisionCleanup,
    addAnnotation,
    annotationField,
    nestedEditorEdit,
    removeAnnotation,
    revisionInternalEdit,
} from "./plugins/annotations";
import {
    RawAnnotationSchema,
    isAnnotationOfType,
    normalizeRevision,
} from "./plugins/annotations/models";
import type { GenericAnnotation } from "./plugins/annotations/models";
// TODO(#191): restore appSettings import when shareDocumentAnalytics is re-enabled
// import { appSettings } from "$lib/settings.svelte";

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Parses a stored annotation payload (selection as plain JSON) into
 * a GenericAnnotation with a proper EditorSelection instance.
 * Returns null and logs a warning if the data fails schema validation.
 */
function deserializeAnnotation(raw: unknown): GenericAnnotation | null {
    const result = RawAnnotationSchema.safeParse(raw);
    if (!result.success) {
        console.warn("[replay] Annotation failed validation, skipping:", result.error.flatten());
        return null;
    }
    const annotation = {
        ...result.data,
        selection: EditorSelection.fromJSON(result.data.selection),
    } as GenericAnnotation;
    return isAnnotationOfType(annotation, "revision") ? normalizeRevision(annotation) : annotation;
}

/**
 * Converts a list of AnnotationEvents into CodeMirror StateEffects
 * against the supplied state (removals look up the live annotation).
 */
function buildAnnotationEffects(
    state: EditorState,
    events: AnnotationEvent[],
): StateEffect<unknown>[] {
    const effects: StateEffect<unknown>[] = [];
    for (const event of events) {
        if (event.type === "annotation_add") {
            const ann = deserializeAnnotation(event.annotation);
            if (ann) effects.push(addAnnotation.of(ann));
        } else if (event.type === "annotation_remove") {
            const ann = state.field(annotationField)[event.annotationId];
            if (ann) effects.push(removeAnnotation.of(ann));
        } else if (event.type === "annotation_update") {
            // addAnnotation overwrites an existing id — effectively an update.
            const ann = deserializeAnnotation(event.annotation);
            if (ann) effects.push(addAnnotation.of(ann));
        }
    }
    return effects;
}

function replayAnnotationsOf(
    entry: TransactionReplayEntry & { kind: "transaction" },
    preserveHistory: boolean,
): Annotation<unknown>[] {
    const annotations: Annotation<unknown>[] = [
        Transaction.addToHistory.of(preserveHistory && entry.annotations.addToHistory),
    ];
    if (entry.annotations.time !== undefined) {
        annotations.push(Transaction.time.of(entry.annotations.time));
    }
    if (entry.annotations.userEvent !== undefined) {
        annotations.push(Transaction.userEvent.of(entry.annotations.userEvent));
    }
    const historyIsolation = preserveHistory
        ? replayHistoryIsolationOf(entry.annotations)
        : entry.annotations.isolateHistory;
    if (historyIsolation !== undefined) {
        annotations.push(isolateHistory.of(historyIsolation));
    }
    if (entry.annotations.revisionInternalEdit !== undefined) {
        annotations.push(revisionInternalEdit.of(entry.annotations.revisionInternalEdit));
    }
    if (entry.annotations.nestedEditorEdit !== undefined) {
        annotations.push(nestedEditorEdit.of(entry.annotations.nestedEditorEdit));
    }
    if (entry.annotations.revisionCleanup !== undefined) {
        annotations.push(_revisionCleanup.of(entry.annotations.revisionCleanup));
    }
    return annotations;
}

function runHistoryCommand(
    state: EditorState,
    command: typeof undo,
    kind: "undo" | "redo",
): EditorState {
    let transaction: Transaction | undefined;
    const handled = command({
        state,
        dispatch: (dispatched) => {
            transaction = dispatched;
        },
    });
    if (!handled || !transaction) throw new Error(`Cannot replay ${kind}: history branch is empty`);
    return transaction.state;
}

function replayNormalTransaction(
    state: EditorState,
    entry: TransactionReplayEntry & { kind: "transaction" },
    preserveHistory: boolean,
): EditorState {
    if (!entry.annotations || !Array.isArray(entry.effects)) {
        throw new Error("Malformed persisted transaction replay entry");
    }
    const effects = entry.effects.map((serialized) => {
        const effect = deserializeHistoryEffect(serialized);
        if (!effect) throw new Error(`Unsupported persisted effect: ${serialized.type}`);
        return effect;
    });
    let aligned = state;
    if (entry.startSelection) {
        const startSelection = EditorSelection.fromJSON(entry.startSelection);
        if (!aligned.selection.eq(startSelection)) {
            aligned = aligned.update({
                selection: startSelection,
                annotations: [Transaction.addToHistory.of(false)],
                filter: false,
            }).state;
        }
    }
    return aligned.update({
        changes: ChangeSet.fromJSON(entry.changeSet),
        effects,
        selection: entry.selection ? EditorSelection.fromJSON(entry.selection) : undefined,
        annotations: replayAnnotationsOf(entry, preserveHistory),
        filter: false,
    }).state;
}

// CodeMirror keeps at most the latest 200 prior selections plus the newly
// appended one on a history event. This is part of the same pinned private
// history shape used by persistentHistory.ts.
const MAX_SELECTIONS_AFTER_PER_HISTORY_EVENT = 201;

function rollingSelectionOverlap(
    current: readonly EditorSelection[],
    recorded: readonly EditorSelection[],
): number {
    for (let length = Math.min(current.length, recorded.length); length > 0; length--) {
        const currentOffset = current.length - length;
        let matches = true;
        for (let index = 0; index < length; index++) {
            if (!current[currentOffset + index].eq(recorded[index])) {
                matches = false;
                break;
            }
        }
        if (matches) return length;
    }
    return 0;
}

function appendHistorySelection(state: EditorState, selection: EditorSelection, index: number) {
    let aligned = state;
    if (!aligned.selection.eq(selection)) {
        aligned = aligned.update({
            selection,
            annotations: [Transaction.addToHistory.of(false)],
            filter: false,
        }).state;
    }
    // A unique select.* user event prevents CodeMirror from coalescing two
    // recorded selections that the live runtime kept separate because of time
    // or event subtype. The following semantic transaction restores its own
    // recorded grouping metadata.
    return aligned.update({
        selection,
        annotations: [
            Transaction.addToHistory.of(true),
            Transaction.userEvent.of(`select.replay.${index}`),
        ],
        filter: false,
    }).state;
}

function reconcileDoneTopSelections(
    state: EditorState,
    annotations: TransactionReplayAnnotations,
): EditorState {
    const recordedJson = annotations.doneTopSelectionsAfter;
    if (recordedJson === undefined) {
        // Backward compatibility for traces written before exact selection
        // contributions were stored. Recreate the physical sentinel shape used
        // for grouping/trimming, though old traces cannot restore every cursor.
        if (
            (annotations.startsWithSelectionSentinel || annotations.startsNewHistoryGroup) &&
            historyDoneBranchIsEmpty(state)
        ) {
            return appendHistorySelection(state, state.selection, 0);
        }
        return state;
    }
    if (!Array.isArray(recordedJson)) {
        throw new Error("Malformed done-branch selection history");
    }
    const recorded = recordedJson.map((selection) => EditorSelection.fromJSON(selection));
    const current = historyDoneTopInfo(state);
    if (!current) throw new Error("CodeMirror history runtime shape changed");
    if (current.branchLength === 0 && !annotations.startsWithSelectionSentinel) {
        throw new Error("Persisted selection history has no matching done-branch event");
    }
    if (
        current.selectionsAfter.length > MAX_SELECTIONS_AFTER_PER_HISTORY_EVENT ||
        recorded.length > MAX_SELECTIONS_AFTER_PER_HISTORY_EVENT
    ) {
        throw new Error("Persisted selection history exceeds CodeMirror's rolling window");
    }

    let overlap = current.selectionsAfter.length;
    if (recorded.length === MAX_SELECTIONS_AFTER_PER_HISTORY_EVENT) {
        // Once the window is full, CodeMirror drops selections from the front
        // as new cursor movements arrive. Match the surviving suffix of the
        // snapshot prefix. A zero-length overlap is valid here: appending a
        // complete window provably washes out every prior selection.
        overlap = rollingSelectionOverlap(current.selectionsAfter, recorded);
    } else {
        // A non-full live window cannot have trimmed any snapshot selections,
        // so the entire current list must remain as an exact prefix.
        if (current.selectionsAfter.length > recorded.length) {
            throw new Error("Persisted selection history is shorter than the snapshot prefix");
        }
        for (let index = 0; index < current.selectionsAfter.length; index++) {
            if (!current.selectionsAfter[index].eq(recorded[index])) {
                throw new Error("Persisted selection history disagrees with the snapshot prefix");
            }
        }
    }

    let aligned = state;
    for (let index = overlap; index < recorded.length; index++) {
        aligned = appendHistorySelection(aligned, recorded[index], index);
    }
    const reconciled = historyDoneTopInfo(aligned);
    if (
        !reconciled ||
        reconciled.selectionsAfter.length !== recorded.length ||
        reconciled.selectionsAfter.some((selection, index) => !selection.eq(recorded[index]))
    ) {
        throw new Error("Could not reconcile persisted selection history");
    }
    return aligned;
}

function samePersistedState(left: EditorState, right: EditorState): boolean {
    return (
        left.doc.eq(right.doc) &&
        left.selection.eq(right.selection) &&
        isEqual(
            left.toJSON({
                annotationField: savedFields.annotationField,
                versionGroupField: savedFields.versionGroupField,
            }),
            right.toJSON({
                annotationField: savedFields.annotationField,
                versionGroupField: savedFields.versionGroupField,
            }),
        )
    );
}

type ReplayResult = {
    state: EditorState;
    historyTrusted: boolean;
};

function trustAfterDirectReplay(state: EditorState, historyTrusted: boolean): boolean {
    // Direct/legacy replay restores semantic state but cannot prove that an
    // existing persistent undo branch still describes it. Session-only states
    // have no cross-restart branch to distrust.
    return historyTrusted && !state.facet(persistHistoryFacet);
}

function replayTransactionEntry(
    state: EditorState,
    entry: TransactionReplayEntry,
    historyTrusted: boolean,
): ReplayResult {
    const normalEntry = entry.kind === "transaction" ? entry : entry.fallback;
    // Collaboration removes CodeMirror history at runtime and uses Y.UndoManager
    // instead. Once such a transaction appears in an event tail, the snapshot's
    // older CM branch cannot safely cross that semantic/rebasing boundary.
    const entryHistoryTrusted =
        historyTrusted && normalEntry.annotations.historyRuntimeDisabled !== true;
    const preserveHistory = entryHistoryTrusted && state.facet(persistHistoryFacet);
    if (entry.kind === "transaction") {
        if (preserveHistory) {
            try {
                const reconciled = reconcileDoneTopSelections(state, entry.annotations);
                return {
                    state: replayNormalTransaction(reconciled, entry, true),
                    historyTrusted: entryHistoryTrusted,
                };
            } catch {
                // Selection-only transactions are intentionally absent from
                // the event log. If their private history metadata cannot be
                // reconciled, the exact semantic transaction is still
                // authoritative. Apply it without history and rebuild a fresh
                // branch after the tail instead of skipping user data.
                return {
                    state: replayNormalTransaction(state, entry, false),
                    historyTrusted: trustAfterDirectReplay(state, entryHistoryTrusted),
                };
            }
        }
        return {
            state: replayNormalTransaction(state, entry, false),
            historyTrusted: entryHistoryTrusted,
        };
    }

    const fallback = replayNormalTransaction(state, entry.fallback, false);
    if (preserveHistory) {
        try {
            const commandState = reconcileDoneTopSelections(state, entry.fallback.annotations);
            const fromHistory = runHistoryCommand(
                commandState,
                entry.kind === "undo" ? undo : redo,
                entry.kind,
            );
            if (samePersistedState(fromHistory, fallback)) {
                return { state: fromHistory, historyTrusted: true };
            }
        } catch {
            // A legacy or deliberately history-free snapshot may not contain
            // the branch referenced by this tail event. The exact accepted
            // transaction is stored as a non-history fallback for recovery.
        }
    }
    return {
        state: fallback,
        // Session-only documents intentionally use the direct path. For a
        // persistent document, reaching it means the loaded command branch is
        // missing or disagrees with the exact accepted transaction. From this
        // point onward no part of that history is safe to expose.
        historyTrusted: trustAfterDirectReplay(state, entryHistoryTrusted),
    };
}

function replayTransactionTrace(
    state: EditorState,
    trace: TransactionReplayTrace,
    historyTrusted: boolean,
): ReplayResult {
    if (trace.version !== 1 || !Array.isArray(trace.transactions)) {
        throw new Error("Unsupported persisted transaction replay version");
    }
    let current = state;
    let trusted = historyTrusted;
    for (const entry of trace.transactions) {
        const replayed = replayTransactionEntry(current, entry, trusted);
        current = replayed.state;
        trusted = replayed.historyTrusted;
    }
    return { state: current, historyTrusted: trusted };
}

function applyStateFallback(state: EditorState, fallback: PersistedStateFallback): EditorState {
    if (
        typeof fallback.doc !== "string" ||
        !fallback.annotations ||
        typeof fallback.annotations !== "object" ||
        Array.isArray(fallback.annotations)
    ) {
        throw new Error("Malformed persisted-state fallback");
    }
    const currentAnnotations = Object.values(state.field(annotationField, false) ?? {});
    const nextAnnotations = Object.values(fallback.annotations).map((raw) => {
        const annotation = deserializeAnnotation(raw);
        if (!annotation) throw new Error("Invalid annotation in persisted-state fallback");
        return annotation;
    });
    const restoreGroups = deserializeHistoryEffect({
        type: "versionGroup.restore",
        value: { groups: fallback.versionGroups },
    });
    if (!restoreGroups) throw new Error("Invalid version groups in persisted-state fallback");
    return state.update({
        changes: { from: 0, to: state.doc.length, insert: fallback.doc },
        effects: [
            ...currentAnnotations.map((annotation) => removeAnnotation.of(annotation)),
            ...nextAnnotations.map((annotation) => addAnnotation.of(annotation)),
            restoreGroups,
        ],
        selection: EditorSelection.fromJSON(fallback.selection),
        annotations: [Transaction.addToHistory.of(false)],
        filter: false,
    }).state;
}

/**
 * Applies a single EventPayload to an EditorState, returning the
 * updated state.  Throws on malformed changes so the caller can
 * catch and skip the offending event.
 */
function applyLegacyEventPayload(state: EditorState, payload: EventPayload): EditorState {
    const legacyAnnotations = [Transaction.addToHistory.of(false)];
    switch (payload.type) {
        case "doc_change":
            return state.update({
                changes: payload.changes,
                selection: EditorSelection.fromJSON(payload.selection),
                annotations: legacyAnnotations,
            }).state;

        case "compound": {
            const effects = buildAnnotationEffects(state, payload.annotationEvents);
            return state.update({
                changes: payload.docChanges,
                effects,
                selection: EditorSelection.fromJSON(payload.selection),
                annotations: legacyAnnotations,
            }).state;
        }

        case "annotation_add":
        case "annotation_update": {
            const ann = deserializeAnnotation(payload.annotation);
            if (!ann) return state;
            return state.update({
                effects: [addAnnotation.of(ann)],
                annotations: legacyAnnotations,
            }).state;
        }

        case "annotation_remove": {
            const ann = state.field(annotationField)[payload.annotationId];
            if (!ann) return state;
            return state.update({
                effects: [removeAnnotation.of(ann)],
                annotations: legacyAnnotations,
            }).state;
        }

        case "state_transaction":
            if (!payload.stateFallback) {
                throw new Error("State transaction has no replay trace or fallback");
            }
            return state;

        default: {
            // Unknown or unsupported event type — treat as malformed so
            // the caller's try/catch can skip this record safely.
            const unknownType = (payload as { type?: string }).type ?? "unknown";
            throw new Error(`Unknown event payload type: ${unknownType}`);
        }
    }
}

function applyEventPayload(
    state: EditorState,
    payload: EventPayload,
    historyTrusted: boolean,
): ReplayResult {
    if (payload.transactionReplay) {
        return replayTransactionTrace(state, payload.transactionReplay, historyTrusted);
    }
    // A full-state fallback is written specifically when exact transaction
    // encoding failed. It is authoritative for the event and must be applied
    // to the pre-event state. Aggregate legacy changes may use coordinates
    // from multiple transactions and can throw before recovery is attempted.
    if (payload.stateFallback) {
        return {
            state: applyStateFallback(state, payload.stateFallback),
            historyTrusted: trustAfterDirectReplay(state, historyTrusted),
        };
    }
    const replayed = applyLegacyEventPayload(state, payload);
    return {
        state: replayed,
        historyTrusted: trustAfterDirectReplay(state, historyTrusted),
    };
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Replays an ordered sequence of EventRecord objects on top of the
 * given EditorState (typically loaded from the latest snapshot).
 *
 * Events must be sorted by ascending `id` (as returned by
 * `loadDocumentState`).  Each event is applied in turn; if one
 * fails it is skipped with a console warning and replay continues
 * with the remaining events.
 *
 * @param state      Base EditorState — from a snapshot or freshly created.
 * @param events     Events to apply, ordered by ascending id.
 * @returns          Updated EditorState with all events applied.
 */
function replayEventsWithStatus(state: EditorState, events: EventRecord[]): ReplayResult {
    let current = state;
    let historyTrusted = true;
    let failures = 0;
    for (const record of events) {
        try {
            const payload = JSON.parse(record.payload) as EventPayload;
            const replayed = applyEventPayload(current, payload, historyTrusted);
            current = replayed.state;
            historyTrusted = replayed.historyTrusted;
        } catch (err) {
            failures++;
            historyTrusted = trustAfterDirectReplay(current, historyTrusted);
            console.warn(`[Editor] Failed to replay event id=${record.id}, skipping:`, err);
            capture("editor_replay_event_failed", {
                event_id: record.id,
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                event_type: tryParseType(record.payload),
                total_events: events.length,
                doc_length: current.doc.length,
                annotation_count: Object.keys(current.field(annotationField)).length,
                // TODO(#191): include raw payload when shareDocumentAnalytics is re-enabled
                // ...(appSettings.shareDocumentAnalytics ? { payload: record.payload } : {}),
            });
        }
    }
    if (failures > 0) {
        capture("editor_replay_completed_with_failures", {
            total_events: events.length,
            failed_events: failures,
        });
    }
    return { state: current, historyTrusted };
}

export function replayEvents(state: EditorState, events: EventRecord[]): EditorState {
    return replayEventsWithStatus(state, events).state;
}

/** Best-effort extract of the event type from a raw payload string. */
function tryParseType(payload: string): string | undefined {
    try {
        return (JSON.parse(payload) as { type?: string }).type;
    } catch {
        return undefined;
    }
}

/**
 * Rebuilds an EditorState from a persisted snapshot plus the events recorded
 * after it — the canonical load recipe shared by the editor, the library
 * preview, and by-id export. A missing, empty ("{}"), or malformed snapshot
 * falls back to an empty state; events still replay on top of the fallback.
 *
 * @param snapshotStateJson  Serialized EditorState from the latest snapshot.
 * @param eventsSince        Events recorded after that snapshot, ascending id.
 * @param extensions         Extension set for the reconstructed state.
 * @param fields             StateFields to rehydrate from the snapshot JSON
 *                           (defaults to savedFields, matching what saves write).
 */
export function reconstructState(
    snapshotStateJson: string | null,
    eventsSince: EventRecord[],
    extensions: Extension,
    fields: Parameters<typeof EditorState.fromJSON>[2] = savedFields,
): EditorState {
    let state: EditorState;
    if (snapshotStateJson && snapshotStateJson !== "{}") {
        try {
            state = EditorState.fromJSON(JSON.parse(snapshotStateJson), { extensions }, fields);
        } catch {
            state = EditorState.create({ extensions });
        }
    } else {
        state = EditorState.create({ extensions });
    }
    if (eventsSince.length > 0) {
        const replayed = replayEventsWithStatus(state, eventsSince);
        state = replayed.state;
        if (!replayed.historyTrusted) {
            // Rebuild through the caller's extension set while deliberately
            // omitting only the history field. This is the public-API-safe way
            // to get a fresh CodeMirror history stack, and preserves the exact
            // final doc, semantic fields, and selection from fallback replay.
            const semanticFields = Object.fromEntries(
                Object.entries(fields ?? {}).filter(
                    ([, field]) => field !== persistentHistoryField,
                ),
            ) as NonNullable<Parameters<typeof EditorState.fromJSON>[2]>;
            const semanticState = state.toJSON(semanticFields);
            state = EditorState.fromJSON(semanticState, { extensions }, fields);
        }
    }
    if (!state.facet(persistHistoryFacet)) return state;

    // Keep original timing while rebuilding the event tail, then force the
    // next live edit into a new undo group. A fast restart must not merge two
    // separate app sessions into one undo step.
    return state.update({
        annotations: [isolateHistory.of("before"), Transaction.addToHistory.of(false)],
    }).state;
}
