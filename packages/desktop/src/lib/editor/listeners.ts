import { isCollabJoiner } from "$lib/collab/store";
import { appendEvent, createNamedSnapshot, createSnapshot, updateDocumentMeta } from "$lib/db";
import { replayHistoryIsolationOf } from "$lib/db/events";
import type {
    AnnotationEvent,
    ChangeOrigin,
    ChangeSpec,
    EventPayload,
    PersistedStateFallback,
    Provenance,
    SelectionJSON,
    TransactionReplayEntry,
    TransactionReplayTrace,
} from "$lib/db/events";
import {
    isDeepAnnotationLoss,
    isSuspiciousAnnotationChange,
    isSuspiciousDeletion,
} from "$lib/errorGuard";
import { appEventBus } from "$lib/events/appEventBus";
import posthog, { captureException } from "$lib/posthog";
import { classifyOrigin } from "$lib/provenance/classify";
import {
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    errorBanner,
    lastPersistedEventId,
    lastSavedAt,
    saveStatus,
} from "$lib/stores";
import { historyField, isolateHistory } from "@codemirror/commands";
import { type Annotation, ChangeSet, EditorSelection, Transaction } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { isEqual } from "lodash-es";
import { get } from "svelte/store";
/**
 * listeners.ts — CodeMirror update listeners for event-log persistence.
 *
 * Role: Provides the `listeners()` factory that returns an array of
 * CodeMirror extensions. On every transaction that changes the document
 * or annotations, we:
 *   1. Build an EventPayload from the transaction(s).
 *   2. Call `appendEvent` (Rust) to store it in the event log.
 *   3. If `needsSnapshot`, call `createSnapshot` with the full state.
 *   4. Debounce `updateDocumentMeta` for the library metadata.
 *
 * Key dependencies:
 *   - ./extensions (savedFields) — which StateFields are snapshotted
 *   - $lib/db (appendEvent, createSnapshot, updateDocumentMeta)
 *   - ./plugins/annotations (addAnnotation, removeAnnotation, updateThread,
 *     annotationsChanged)
 */
import { savedFields } from "./extensions";
import {
    deserializeHistoryEffect,
    historyDoneBranchIsSelectionSentinel,
    historyDoneTopInfo,
    serializeHistoryEffect,
    transactionStartsNewHistoryGroup,
} from "./persistentHistory";
import {
    type GenericAnnotation,
    _revisionCleanup,
    addAnnotation,
    isRawAnnotationOfType,
    nestedEditorEdit,
    removeAnnotation,
    revisionInternalEdit,
    updateThread,
} from "./plugins/annotations";

export interface ListenerOptions {
    updateListener?: (update: ViewUpdate) => void;
    persist?: boolean;
    history?: boolean;
    /** Whether this document stores undo history in snapshots and event replay. */
    persistHistory?: boolean;
}

// ── Debounce timers ───────────────────────────────────────────────
type PendingMeta = {
    timer: ReturnType<typeof setTimeout>;
    docText: string;
    wordCount: number;
    previewText: string;
};
const metaDebounceTimers = new Map<string, PendingMeta>();
// Only show "Saving…" if the write takes longer than this threshold.
// This keeps the indicator on "Saved" during normal fast writes.
let savingIndicatorTimer: ReturnType<typeof setTimeout> | null = null;

// ── Write serialisation queue ─────────────────────────────────────
// Ensures appendEvent calls are ordered by transaction order, not
// DB completion order, and that saveStatus reflects the last write.
// The outer .catch keeps the chain alive if doAppend throws.
let persistQueue: Promise<void> = Promise.resolve();

function serializeSelection(sel: EditorSelection): SelectionJSON {
    return {
        ranges: sel.ranges.map((r) => ({ anchor: r.anchor, head: r.head })),
        main: sel.mainIndex,
    };
}

function extractSelection(update: ViewUpdate): SelectionJSON {
    return serializeSelection(update.state.selection);
}

/**
 * Extracts all doc change ops from a single CM transaction.
 */
function extractChanges(tr: Transaction): ChangeSpec[] {
    const changes: ChangeSpec[] = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, to: toA, insert: inserted.toString() });
    });
    return changes;
}

/**
 * Derives provenance for a single CM transaction: where the change came from
 * (origin), the raw userEvent, and inserted/removed char counts. Pure — never
 * throws. Aggregated across doc-changing transactions in buildEventPayload.
 */
function txProvenance(tr: Transaction): {
    origin: ChangeOrigin;
    userEvent: string | undefined;
    insertedChars: number;
    removedChars: number;
} {
    const userEvent = tr.annotation(Transaction.userEvent);
    const hasRevisionInternalEdit = !!tr.annotation(revisionInternalEdit);
    const hasNestedEditorEdit = tr.annotation(nestedEditorEdit) != null;

    let insertedChars = 0;
    let removedChars = 0;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        insertedChars += inserted.length;
        removedChars += toA - fromA;
    });

    const origin = classifyOrigin({ userEvent, hasRevisionInternalEdit, hasNestedEditorEdit });
    return { origin, userEvent, insertedChars, removedChars };
}

/**
 * Extracts annotation mutation effects from a single CM transaction.
 * For updateThread, reads the post-transaction annotation from tr.state so
 * the serialised selection reflects any range remapping that happened in the
 * same transaction (e.g. doc changes before the thread update).
 */
function serializeAnnotation(annotation: GenericAnnotation): Record<string, unknown> {
    return JSON.parse(JSON.stringify({ ...annotation, selection: annotation.selection.toJSON() }));
}

function extractAnnotationEvents(tr: Transaction): AnnotationEvent[] {
    const { annotationField } = savedFields;
    const events: AnnotationEvent[] = [];
    const explicitlyHandled = new Set<number>();

    for (const effect of tr.effects) {
        if (effect.is(addAnnotation)) {
            explicitlyHandled.add(effect.value.id);
            events.push({
                type: "annotation_add",
                annotation: serializeAnnotation(effect.value),
            });
        } else if (effect.is(removeAnnotation)) {
            explicitlyHandled.add(effect.value.id);
            events.push({
                type: "annotation_remove",
                annotationId: effect.value.id,
            });
        } else if (effect.is(updateThread)) {
            // Read from tr.state (post-transaction) so the selection has already
            // been remapped through any doc changes in the same transaction.
            const ann = tr.state.field(annotationField)[effect.value.annotationId];
            if (ann) {
                explicitlyHandled.add(effect.value.annotationId);
                events.push({
                    type: "annotation_update",
                    annotation: serializeAnnotation(ann),
                });
            }
        }
    }

    // Catch version state changes (updateRevisionVersionState, setActiveRevisionVersion,
    // addVersionToRevision, deleteVersionFromRevision, updateRevisionVersionLabel) which use
    // internal effects not visible here. Compare pre/post annotation field and emit
    // annotation_update for any annotation that changed but wasn't already handled above.
    //
    // Run when: the transaction is NOT a plain user keystroke. We include both
    // non-doc-changing transactions (e.g. updateRevisionVersionLabel) AND
    // revision-system transactions that change the doc (e.g. setActiveRevisionVersion
    // replaces doc text AND updates activeVersionIndex). Without the
    // revisionInternalEdit check, version switches and similar operations would
    // not be persisted to the event log.
    if (
        !tr.docChanged ||
        tr.annotation(revisionInternalEdit) ||
        tr.annotation(nestedEditorEdit) !== undefined
    ) {
        const before = tr.startState.field(annotationField);
        const after = tr.state.field(annotationField);
        for (const [idStr, ann] of Object.entries(after)) {
            const id = Number(idStr);
            if (explicitlyHandled.has(id)) continue;
            if (!isEqual(before[id], ann)) {
                events.push({
                    type: "annotation_update",
                    annotation: serializeAnnotation(ann),
                });
            }
        }
    }

    return events;
}

function persistedFieldParts(state: Transaction["state"]): {
    annotations: unknown;
    versionGroups: unknown;
} {
    const json = state.toJSON({
        annotationField: savedFields.annotationField,
        versionGroupField: savedFields.versionGroupField,
    });
    return {
        annotations: json.annotationField,
        versionGroups: json.versionGroupField,
    };
}

function changesPersistedState(tr: Transaction): boolean {
    if (tr.docChanged) return true;
    const before = persistedFieldParts(tr.startState);
    const after = persistedFieldParts(tr.state);
    return !isEqual(before, after);
}

function replayAnnotationsOf(tr: Transaction): TransactionReplayEntry & { kind: "transaction" } {
    const historyRuntimeDisabled =
        tr.startState.field(historyField, false) === undefined ||
        tr.state.field(historyField, false) === undefined;
    const doneTopSelectionsAfter = historyDoneTopInfo(tr.startState)?.selectionsAfter;
    const annotations = {
        // A missing historyField means the live transaction could not have
        // entered CodeMirror history, regardless of its annotation default.
        addToHistory: !historyRuntimeDisabled && tr.annotation(Transaction.addToHistory) !== false,
        historyRuntimeDisabled: historyRuntimeDisabled ? (true as const) : undefined,
        time: tr.annotation(Transaction.time),
        userEvent: tr.annotation(Transaction.userEvent),
        isolateHistory: tr.annotation(isolateHistory),
        startsNewHistoryGroup: transactionStartsNewHistoryGroup(tr),
        startsWithSelectionSentinel:
            historyDoneBranchIsSelectionSentinel(tr.startState) || undefined,
        doneTopSelectionsAfter:
            doneTopSelectionsAfter && doneTopSelectionsAfter.length > 0
                ? doneTopSelectionsAfter.map(serializeSelection)
                : undefined,
        revisionInternalEdit: tr.annotation(revisionInternalEdit),
        nestedEditorEdit: tr.annotation(nestedEditorEdit),
        revisionCleanup: tr.annotation(_revisionCleanup),
    };
    return {
        kind: "transaction",
        changeSet: tr.changes.toJSON(),
        effects: tr.effects.flatMap((effect) => {
            const serialized = serializeHistoryEffect(effect);
            return serialized ? [serialized] : [];
        }),
        startSelection: serializeSelection(tr.startState.selection),
        selection: serializeSelection(tr.state.selection),
        annotations,
    };
}

function codeMirrorAnnotationsOf(
    entry: TransactionReplayEntry & { kind: "transaction" },
): Annotation<unknown>[] {
    const annotations: Annotation<unknown>[] = [
        Transaction.addToHistory.of(entry.annotations.addToHistory),
    ];
    if (entry.annotations.time !== undefined) {
        annotations.push(Transaction.time.of(entry.annotations.time));
    }
    if (entry.annotations.userEvent !== undefined) {
        annotations.push(Transaction.userEvent.of(entry.annotations.userEvent));
    }
    const historyIsolation = replayHistoryIsolationOf(entry.annotations);
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

/**
 * Guard the trace codec against newly-added persistent effects. Re-applying the
 * encoded transaction must reproduce the exact document, annotation map, and
 * version-group map before it is allowed into the event log.
 */
function verifyTransactionReplay(
    tr: Transaction,
    entry: TransactionReplayEntry & { kind: "transaction" },
): void {
    const effects = entry.effects.map((serialized) => {
        const effect = deserializeHistoryEffect(serialized);
        if (!effect) throw new Error(`Unsupported persistent effect: ${serialized.type}`);
        return effect;
    });
    const replayed = tr.startState.update({
        changes: ChangeSet.fromJSON(entry.changeSet),
        effects,
        selection: entry.selection ? EditorSelection.fromJSON(entry.selection) : undefined,
        annotations: codeMirrorAnnotationsOf(entry),
        filter: false,
    }).state;
    if (!replayed.doc.eq(tr.state.doc)) {
        throw new Error("Transaction replay codec produced a different document");
    }
    if (!replayed.selection.eq(tr.state.selection)) {
        throw new Error("Transaction replay codec produced a different selection");
    }
    const expectedFields = persistedFieldParts(tr.state);
    const replayedFields = persistedFieldParts(replayed);
    if (!isEqual(expectedFields.annotations, replayedFields.annotations)) {
        throw new Error("Transaction replay codec produced different annotations");
    }
    if (!isEqual(expectedFields.versionGroups, replayedFields.versionGroups)) {
        throw new Error("Transaction replay codec produced different version groups");
    }
}

function buildTransactionReplay(update: ViewUpdate): TransactionReplayTrace | undefined {
    const transactions: TransactionReplayEntry[] = [];
    for (const tr of update.transactions) {
        if (!changesPersistedState(tr)) continue;
        if (tr.isUserEvent("undo")) {
            const fallback = replayAnnotationsOf(tr);
            verifyTransactionReplay(tr, fallback);
            transactions.push({ kind: "undo", fallback });
        } else if (tr.isUserEvent("redo")) {
            const fallback = replayAnnotationsOf(tr);
            verifyTransactionReplay(tr, fallback);
            transactions.push({ kind: "redo", fallback });
        } else {
            const entry = replayAnnotationsOf(tr);
            verifyTransactionReplay(tr, entry);
            transactions.push(entry);
        }
    }
    return transactions.length > 0 ? { version: 1, transactions } : undefined;
}

function buildStateFallback(update: ViewUpdate): PersistedStateFallback {
    const json = update.state.toJSON({
        annotationField: savedFields.annotationField,
        versionGroupField: savedFields.versionGroupField,
    });
    const annotations =
        json.annotationField && typeof json.annotationField === "object"
            ? (json.annotationField as PersistedStateFallback["annotations"])
            : {};
    return {
        doc: update.state.doc.toString(),
        annotations,
        versionGroups: json.versionGroupField ?? {},
        selection: extractSelection(update),
    };
}

/**
 * Builds a single EventPayload from all transactions in a ViewUpdate.
 * Returns null if there is nothing worth persisting.
 */
export function buildEventPayload(update: ViewUpdate): EventPayload | null {
    let allDocChanges: ChangeSpec[] = [];
    let allAnnotationEvents: AnnotationEvent[] = [];

    // Aggregate one event-level provenance across all doc-changing transactions:
    //   - origin: "ai-revision" if ANY tr is a revision-internal edit, else
    //     "nested-edit" if ANY tr is a nested-editor edit, else the origin of
    //     the LAST doc-changing transaction.
    //   - userEvent: the userEvent of that same last doc-changing transaction.
    //   - inserted/removedChars: summed across all doc-changing transactions.
    let anyRevisionInternal = false;
    let anyNestedEdit = false;
    let lastOrigin: ChangeOrigin = "unknown";
    let lastUserEvent: string | undefined;
    let totalInserted = 0;
    let totalRemoved = 0;

    for (const tr of update.transactions) {
        if (tr.docChanged) {
            allDocChanges = allDocChanges.concat(extractChanges(tr));
            const prov = txProvenance(tr);
            if (prov.origin === "ai-revision") anyRevisionInternal = true;
            if (prov.origin === "nested-edit") anyNestedEdit = true;
            lastOrigin = prov.origin;
            lastUserEvent = prov.userEvent;
            totalInserted += prov.insertedChars;
            totalRemoved += prov.removedChars;
        }
        allAnnotationEvents = allAnnotationEvents.concat(extractAnnotationEvents(tr));
    }

    const hasPersistedStateChange = update.transactions.some(changesPersistedState);
    let transactionReplay: TransactionReplayTrace | undefined;
    let stateFallback: PersistedStateFallback | undefined;
    try {
        transactionReplay = buildTransactionReplay(update);
    } catch (error) {
        console.error("[listeners] Could not encode exact transaction replay", error);
        if (hasPersistedStateChange) stateFallback = buildStateFallback(update);
    }

    const hasDocChange = allDocChanges.length > 0;
    const hasAnnotationChange = allAnnotationEvents.length > 0;

    if (!hasDocChange && !hasAnnotationChange) {
        return transactionReplay || stateFallback
            ? { type: "state_transaction", transactionReplay, stateFallback }
            : null;
    }

    const selection = extractSelection(update);

    const provenance: Provenance | undefined = hasDocChange
        ? {
              origin: anyRevisionInternal
                  ? "ai-revision"
                  : anyNestedEdit
                    ? "nested-edit"
                    : lastOrigin,
              userEvent: lastUserEvent,
              insertedChars: totalInserted,
              removedChars: totalRemoved,
          }
        : undefined;

    if (hasDocChange && hasAnnotationChange) {
        return {
            type: "compound",
            docChanges: allDocChanges,
            annotationEvents: allAnnotationEvents,
            selection,
            provenance,
            transactionReplay,
            stateFallback,
        };
    }

    if (hasDocChange) {
        return {
            type: "doc_change",
            changes: allDocChanges,
            selection,
            provenance,
            transactionReplay,
            stateFallback,
        };
    }

    // Annotation-only: return the first annotation event directly
    // (multiple annotation events are wrapped as compound if alongside doc changes)
    if (allAnnotationEvents.length === 1) {
        return { ...allAnnotationEvents[0], transactionReplay, stateFallback } as EventPayload;
    }

    // Multiple annotation-only events: wrap as compound with no doc changes
    return {
        type: "compound",
        docChanges: [],
        annotationEvents: allAnnotationEvents,
        selection,
        transactionReplay,
        stateFallback,
    };
}

/**
 * Persists one ViewUpdate to the event log.
 * Enqueues the write so concurrent updates are ordered by transaction
 * order rather than DB completion order.
 */
function persistTransaction(update: ViewUpdate): void {
    // D-100 / Live Room mode: joiners are ephemeral viewers of the owner's document.
    // The joiner's collab session is a separate ephemeral view that never touches
    // local docs. Skip all local persistence -- the owner's relay is source of truth.
    // The joiner's currentDraftId is null during the session (set by GoLiveButton).
    if (get(isCollabJoiner)) return;

    const enqueueDocId = get(currentDocumentId);
    const enqueueDraftId = get(currentDraftId);
    persistQueue = persistQueue
        .then(() => doAppend(update, enqueueDocId, enqueueDraftId))
        .catch(() => {});
}

/**
 * Resolves once the current persist queue has drained. New writes
 * enqueued after this call are not awaited. Call before navigation
 * or destructive actions so the latest edits reach the DB before the
 * library re-reads metadata.
 */
export function flushPersistQueue(): Promise<void> {
    return persistQueue.catch(() => {});
}

function annotationEventsForPayload(payload: EventPayload): AnnotationEvent[] {
    if (payload.type === "compound") return payload.annotationEvents;
    if (
        payload.type === "annotation_add" ||
        payload.type === "annotation_remove" ||
        payload.type === "annotation_update"
    ) {
        return [payload];
    }
    return [];
}

function payloadAddsAnnotationOfType(payload: EventPayload, type: "comment" | "revision"): boolean {
    return annotationEventsForPayload(payload).some(
        (event) => event.type === "annotation_add" && isRawAnnotationOfType(event.annotation, type),
    );
}

function isUndoRedoUpdate(update: ViewUpdate): boolean {
    return update.transactions.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"));
}

/**
 * Suspicious-change guard action: write a named recovery snapshot of the
 * pre-change state (fire-and-forget) and surface a banner pointing the user
 * at version history. Shared by the deletion/annotation-loss guards below.
 */
function snapshotAndWarn(
    draftId: string,
    update: ViewUpdate,
    label: string,
    message: string,
): void {
    const preStateJson = JSON.stringify(update.startState.toJSON(savedFields));
    createNamedSnapshot(draftId, preStateJson, get(lastPersistedEventId), label).catch((e) => {
        console.error(e);
        captureException(e);
    });
    setTimeout(() => {
        errorBanner.set({ message, hasBackup: false, backupType: "auto" });
    }, 0);
}

async function createAutosaveSnapshot(
    draftId: string,
    stateJson: string,
    eventId: number,
    label: string,
): Promise<boolean> {
    try {
        await createNamedSnapshot(draftId, stateJson, eventId, label);
        return true;
    } catch (e) {
        console.error(e);
        captureException(e);
        return false;
    }
}

async function doAppend(
    update: ViewUpdate,
    enqueueDocId: string | null,
    enqueueDraftId: string | null,
) {
    if (!enqueueDocId || !enqueueDraftId) return;
    if (get(currentDocumentId) !== enqueueDocId) return;
    const docId = enqueueDocId;
    const draftId = enqueueDraftId;

    const payload = buildEventPayload(update);
    if (!payload) return;
    const isUndoRedo = isUndoRedoUpdate(update);
    const shouldSnapshotBeforeRevision =
        !isUndoRedo && payloadAddsAnnotationOfType(payload, "revision");
    const shouldSnapshotAfterComment =
        !isUndoRedo && payloadAddsAnnotationOfType(payload, "comment");

    if (shouldSnapshotBeforeRevision) {
        await createAutosaveSnapshot(
            draftId,
            JSON.stringify(update.startState.toJSON(savedFields)),
            get(lastPersistedEventId),
            "Before revision creation (auto)",
        );
    }

    // Guard: check for suspiciously large deletions before writing to DB.
    // If suspicious, snapshot the pre-deletion state so version history
    // has a guaranteed recovery point. Skip if every doc-changing
    // transaction is an explicit user delete or a crash-restore operation.
    if (update.docChanged && !shouldSnapshotBeforeRevision) {
        const allUserInitiated = update.transactions
            .filter((tr) => tr.docChanged)
            .every((tr) => tr.isUserEvent("delete") || tr.isUserEvent("input.restore"));
        if (!allUserInitiated) {
            const oldText = update.startState.doc.toString();
            const newText = update.state.doc.toString();
            if (isSuspiciousDeletion(oldText, newText)) {
                // Snapshot the pre-deletion state so /history has a recovery point.
                snapshotAndWarn(
                    draftId,
                    update,
                    "Before large deletion (auto)",
                    "A large deletion was detected. A recovery snapshot has been saved to your version history.",
                );
            }
        }
    }

    // Guard: check for suspiciously large annotation removals.
    // Skip restore operations (they intentionally remove-then-re-add annotations).
    {
        const isRestore = update.transactions.some((tr) => tr.isUserEvent("input.restore"));
        if (!isRestore) {
            const oldAnnotations = update.startState.field(savedFields.annotationField);
            const newAnnotations = update.state.field(savedFields.annotationField);
            const oldCount = Object.keys(oldAnnotations).length;
            const newCount = Object.keys(newAnnotations).length;

            let triggered = false;

            if (isSuspiciousAnnotationChange(oldCount, newCount)) {
                snapshotAndWarn(
                    draftId,
                    update,
                    "Before mass annotation removal (auto)",
                    "A large number of annotations were removed. A recovery snapshot has been saved to your version history.",
                );
                triggered = true;
            }

            // Guard: check for removal of annotations with deep nested content.
            // A single revision with many sub-annotations represents significant work.
            if (!triggered && isDeepAnnotationLoss(oldAnnotations, newAnnotations)) {
                snapshotAndWarn(
                    draftId,
                    update,
                    "Before nested annotation loss (auto)",
                    "An annotation with deeply nested content was removed. A recovery snapshot has been saved to your version history.",
                );
            }
        }
    }

    // Only flip to "Saving…" if the write hasn't resolved within 150 ms.
    // Fast writes (the common case) stay on "Saved" the whole time.
    if (savingIndicatorTimer !== null) clearTimeout(savingIndicatorTimer);
    const scheduledDocId = docId;
    const scheduledDraftId = draftId;
    savingIndicatorTimer = setTimeout(() => {
        try {
            // Guard: abort if the user has navigated to a different document or draft.
            if (
                get(currentDocumentId) !== scheduledDocId ||
                get(currentDraftId) !== scheduledDraftId
            ) {
                return;
            }
            saveStatus.set("saving");
        } finally {
            savingIndicatorTimer = null;
        }
    }, 150);
    try {
        const result = await appendEvent(draftId, JSON.stringify(payload));
        if (savingIndicatorTimer !== null) {
            clearTimeout(savingIndicatorTimer);
            savingIndicatorTimer = null;
        }

        lastPersistedEventId.set(result.eventId);
        lastSavedAt.set(Date.now());

        const wroteCommentSnapshot = shouldSnapshotAfterComment
            ? await createAutosaveSnapshot(
                  draftId,
                  JSON.stringify(update.state.toJSON(savedFields)),
                  result.eventId,
                  "After comment annotation (auto)",
              )
            : false;

        if (result.needsSnapshot && !wroteCommentSnapshot) {
            const stateJson = JSON.stringify(update.state.toJSON(savedFields));
            await createSnapshot(draftId, stateJson, result.eventId).catch((e) => {
                console.error(e);
                captureException(e);
            });
        }

        saveStatus.set("saved");
    } catch (e) {
        console.error("[listeners] appendEvent failed:", e);
        captureException(e);
        if (savingIndicatorTimer !== null) {
            clearTimeout(savingIndicatorTimer);
            savingIndicatorTimer = null;
        }
        saveStatus.set("error");
        return;
    }

    // Debounce metadata update (title, word count, preview).
    // Capture derived values now so the timer closure doesn't read
    // update.view.state, which may belong to a different document by
    // the time the 500 ms fires.
    const docText = update.state.doc.toString();
    const wordCount = docText.trim().split(/\s+/).filter(Boolean).length;
    const previewText = docText.slice(0, 200);
    const prev = metaDebounceTimers.get(docId);
    if (prev !== undefined) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
        metaDebounceTimers.delete(docId);
        // Guard: abort if the user has navigated to a different document.
        if (get(currentDocumentId) !== docId) return;
        writeMeta(docId, docText, wordCount, previewText);
    }, 500);
    metaDebounceTimers.set(docId, { timer, docText, wordCount, previewText });
}

function writeMeta(docId: string, docText: string, wordCount: number, previewText: string): void {
    // Auto-derive title once from the first line, but only while the
    // title is still "Untitled" and the first line looks ready:
    //   - user pressed Enter (first line ends / second line exists), OR
    //   - first line has at least 4 words (enough to be a real title)
    // After this fires once, the title is owned by the user/AI.
    let title = get(currentDocumentTitle);
    if (title === "Untitled") {
        const firstLine = docText.split("\n")[0].trim();
        const firstLineWords = firstLine ? firstLine.split(/\s+/).length : 0;
        const firstLineComplete = docText.includes("\n") || firstLineWords >= 4;
        if (firstLineComplete && firstLine) {
            title = firstLine.slice(0, 40);
            currentDocumentTitle.set(title);
        }
    }
    // docText doubles as the search-index body (FTS + semantic chunks).
    updateDocumentMeta(docId, title, wordCount, previewText, "[]", docText).catch((e) => {
        console.error(e);
        captureException(e);
    });
}

/**
 * Immediately flush all pending metadata debounces.
 * Called on route changes and destructive doc actions (trash, new)
 * so the library view reflects the latest edits without waiting for
 * the 500 ms debounce.
 */
export function flushMetaDebounces(): void {
    for (const [docId, pending] of metaDebounceTimers) {
        clearTimeout(pending.timer);
        writeMeta(docId, pending.docText, pending.wordCount, pending.previewText);
    }
    metaDebounceTimers.clear();
}

// ── Caret broadcast for AutoAIFace eye tracking ───────────────────
// Throttled to one rAF per view so multiple editor instances don't
// suppress each other's broadcasts within the same animation frame.
const caretRafPending = new WeakMap<EditorView, boolean>();
const caretBroadcast = EditorView.updateListener.of((update: ViewUpdate) => {
    if (!(update.selectionSet || update.docChanged)) return;
    if (caretRafPending.get(update.view)) return;
    caretRafPending.set(update.view, true);
    requestAnimationFrame(() => {
        caretRafPending.set(update.view, false);
        const pos = update.view.state.selection.main.head;
        let coords: { left: number; top: number; bottom: number } | null = null;
        try {
            const t0 = performance.now();
            coords = update.view.coordsAtPos(pos);
            posthog.capture("perf_coords_at_pos", {
                elapsed_ms: performance.now() - t0,
                doc_length: update.view.state.doc.length,
            });
        } catch (e) {
            // coordsAtPos requires a real layout engine — skip in environments
            // (e.g. jsdom in tests) that don't implement it.
            console.warn("[caretBroadcast] coordsAtPos failed — no layout engine?", e);
            return;
        }
        if (coords) {
            appEventBus.emit({
                type: "caret-moved",
                x: coords.left,
                y: (coords.top + coords.bottom) / 2,
            });
        }
    });
});

// ── Auto-save listener ────────────────────────────────────────────
const save = EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.transactions.some(changesPersistedState)) {
        persistTransaction(update);
    }
});

export const listeners = (options?: ListenerOptions) => [
    ...(options?.persist === false ? [] : [save, caretBroadcast]),
    ...(options?.updateListener ? [EditorView.updateListener.of(options.updateListener)] : []),
];
