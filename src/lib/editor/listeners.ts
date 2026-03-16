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
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { get } from "svelte/store";
import {
    currentDocumentId,
    currentDraftId,
    currentDocumentTitle,
    saveStatus,
    errorBanner,
} from "$lib/stores";
import { appendEvent, createSnapshot, updateDocumentMeta } from "$lib/db";
import { checkForSuspiciousChange, readBackup } from "$lib/errorGuard";
import {
    addAnnotation,
    removeAnnotation,
    updateThread,
    revisionInternalEdit,
    annotationsChanged,
    type GenericAnnotation,
} from "./plugins/annotations";
import type { AnnotationEvent, ChangeSpec, EventPayload, SelectionJSON } from "$lib/db/events";
import type { Transaction } from "@codemirror/state";

export interface ListenerOptions {
    updateListener?: (update: ViewUpdate) => void;
    persist?: boolean;
    history?: boolean;
}

// ── Debounce timers ───────────────────────────────────────────────
let metaDebounceTimer: ReturnType<typeof setTimeout> | null = null;
// Only show "Saving…" if the write takes longer than this threshold.
// This keeps the indicator on "Saved" during normal fast writes.
let savingIndicatorTimer: ReturnType<typeof setTimeout> | null = null;

// ── Write serialisation queue ─────────────────────────────────────
// Ensures appendEvent calls are ordered by transaction order, not
// DB completion order, and that saveStatus reflects the last write.
// The outer .catch keeps the chain alive if doAppend throws.
let persistQueue: Promise<void> = Promise.resolve();

function extractSelection(update: ViewUpdate): SelectionJSON {
    const sel = update.state.selection;
    return {
        ranges: sel.ranges.map((r) => ({ anchor: r.anchor, head: r.head })),
        main: sel.mainIndex,
    };
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
    if (!tr.docChanged || tr.annotation(revisionInternalEdit)) {
        const before = tr.startState.field(annotationField);
        const after = tr.state.field(annotationField);
        for (const [idStr, ann] of Object.entries(after)) {
            const id = Number(idStr);
            if (explicitlyHandled.has(id)) continue;
            if (before[id] !== ann) {
                events.push({
                    type: "annotation_update",
                    annotation: serializeAnnotation(ann),
                });
            }
        }
    }

    return events;
}

/**
 * Builds a single EventPayload from all transactions in a ViewUpdate.
 * Returns null if there is nothing worth persisting.
 */
export function buildEventPayload(update: ViewUpdate): EventPayload | null {
    let allDocChanges: ChangeSpec[] = [];
    let allAnnotationEvents: AnnotationEvent[] = [];

    for (const tr of update.transactions) {
        if (tr.docChanged) {
            allDocChanges = allDocChanges.concat(extractChanges(tr));
        }
        allAnnotationEvents = allAnnotationEvents.concat(extractAnnotationEvents(tr));
    }

    const hasDocChange = allDocChanges.length > 0;
    const hasAnnotationChange = allAnnotationEvents.length > 0;

    if (!hasDocChange && !hasAnnotationChange) return null;

    const selection = extractSelection(update);

    if (hasDocChange && hasAnnotationChange) {
        return {
            type: "compound",
            docChanges: allDocChanges,
            annotationEvents: allAnnotationEvents,
            selection,
        };
    }

    if (hasDocChange) {
        return {
            type: "doc_change",
            changes: allDocChanges,
            selection,
        };
    }

    // Annotation-only: return the first annotation event directly
    // (multiple annotation events are wrapped as compound if alongside doc changes)
    if (allAnnotationEvents.length === 1) {
        return allAnnotationEvents[0] as EventPayload;
    }

    // Multiple annotation-only events: wrap as compound with no doc changes
    return {
        type: "compound",
        docChanges: [],
        annotationEvents: allAnnotationEvents,
        selection,
    };
}

/**
 * Persists one ViewUpdate to the event log.
 * Enqueues the write so concurrent updates are ordered by transaction
 * order rather than DB completion order.
 */
function persistTransaction(update: ViewUpdate): void {
    persistQueue = persistQueue.then(() => doAppend(update)).catch(() => {});
}

async function doAppend(update: ViewUpdate) {
    const docId = get(currentDocumentId);
    const draftId = get(currentDraftId);
    if (!docId || !draftId) return;

    const payload = buildEventPayload(update);
    if (!payload) return;

    // Guard: check for suspiciously large deletions before writing to DB.
    // The backup is saved *before* the write so the user can always recover.
    // Skip if every doc-changing transaction is an explicit user delete —
    // that means the user deliberately selected text and pressed Delete/Backspace.
    if (update.docChanged) {
        const allUserInitiated = update.transactions
            .filter((tr) => tr.docChanged)
            .every((tr) => tr.isUserEvent("delete"));
        if (!allUserInitiated) {
            const oldText = update.startState.doc.toString();
            const newText = update.state.doc.toString();
            const suspicious = checkForSuspiciousChange(oldText, newText);
            if (suspicious) {
                const backup = readBackup("auto");
                if (backup) {
                    setTimeout(() => {
                        errorBanner.set({
                            message:
                                "A large deletion was detected. A backup was saved in case this was unintentional.",
                            hasBackup: true,
                            backupType: "auto",
                        });
                    }, 0);
                }
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

        if (result.needsSnapshot) {
            const stateJson = JSON.stringify(update.state.toJSON(savedFields));
            await createSnapshot(draftId, stateJson, result.eventId).catch(console.error);
        }

        saveStatus.set("saved");
    } catch (e) {
        console.error("[listeners] appendEvent failed:", e);
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
    if (metaDebounceTimer !== null) clearTimeout(metaDebounceTimer);
    metaDebounceTimer = setTimeout(() => {
        try {
            // Guard: abort if the user has navigated to a different document.
            if (get(currentDocumentId) !== docId) return;
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
                    title = firstLine.slice(0, 80);
                    currentDocumentTitle.set(title);
                }
            }
            updateDocumentMeta(docId, title, wordCount, previewText, "[]").catch(console.error);
        } finally {
            metaDebounceTimer = null;
        }
    }, 500);
}

// ── Auto-save listener ────────────────────────────────────────────
const save = EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged || annotationsChanged(update)) {
        persistTransaction(update);
    }
});

export const listeners = (options?: ListenerOptions) => [
    ...(options?.persist === false ? [] : [save]),
    ...(options?.updateListener ? [EditorView.updateListener.of(options.updateListener)] : []),
];
