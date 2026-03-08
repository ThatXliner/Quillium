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
import { currentDocumentId, currentDraftId, currentDocumentTitle, saveStatus } from "$lib/stores";
import {
    appendEvent,
    createSnapshot,
    updateDocumentMeta,
} from "$lib/db";
import {
    addAnnotation,
    removeAnnotation,
    updateThread,
    annotationsChanged,
} from "./plugins/annotations";
import type {
    AnnotationEvent,
    ChangeSpec,
    EventPayload,
    SelectionJSON,
} from "$lib/db/events";
import type { Transaction } from "@codemirror/state";

export interface ListenerOptions {
    updateListener?: (update: ViewUpdate) => void;
    persist?: boolean;
}

// ── Debounce timers ───────────────────────────────────────────────
let metaDebounceTimer: ReturnType<typeof setTimeout> | null = null;
// Only show "Saving…" if the write takes longer than this threshold.
// This keeps the indicator on "Saved" during normal fast writes.
let savingIndicatorTimer: ReturnType<typeof setTimeout> | null = null;

function extractTitle(text: string): string {
    return text.split("\n")[0].trim().slice(0, 80) || "Untitled";
}

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
function extractAnnotationEvents(tr: Transaction): AnnotationEvent[] {
    const { annotationField } = savedFields;
    const events: AnnotationEvent[] = [];
    for (const effect of tr.effects) {
        if (effect.is(addAnnotation)) {
            // Serialise the annotation: selection must be converted to plain JSON.
            const annotation = effect.value;
            events.push({
                type: "annotation_add",
                annotation: JSON.parse(
                    JSON.stringify({
                        ...annotation,
                        selection: annotation.selection.toJSON(),
                    }),
                ),
            });
        } else if (effect.is(removeAnnotation)) {
            events.push({
                type: "annotation_remove",
                annotationId: effect.value.id,
            });
        } else if (effect.is(updateThread)) {
            // Read from tr.state (post-transaction) so the selection has already
            // been remapped through any doc changes in the same transaction.
            const ann = tr.state.field(annotationField)[effect.value.annotationId];
            if (ann) {
                events.push({
                    type: "annotation_update",
                    annotation: JSON.parse(
                        JSON.stringify({
                            ...ann,
                            selection: ann.selection.toJSON(),
                        }),
                    ),
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
function buildEventPayload(update: ViewUpdate): EventPayload | null {
    let allDocChanges: ChangeSpec[] = [];
    let allAnnotationEvents: AnnotationEvent[] = [];

    for (const tr of update.transactions) {
        if (tr.docChanged) {
            allDocChanges = allDocChanges.concat(extractChanges(tr));
        }
        allAnnotationEvents = allAnnotationEvents.concat(
            extractAnnotationEvents(tr),
        );
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
 */
async function persistTransaction(update: ViewUpdate) {
    const docId = get(currentDocumentId);
    const draftId = get(currentDraftId);
    if (!docId || !draftId) return;

    const payload = buildEventPayload(update);
    if (!payload) return;

    // Only flip to "Saving…" if the write hasn't resolved within 150 ms.
    // Fast writes (the common case) stay on "Saved" the whole time.
    if (savingIndicatorTimer !== null) clearTimeout(savingIndicatorTimer);
    savingIndicatorTimer = setTimeout(() => {
        saveStatus.set("saving");
        savingIndicatorTimer = null;
    }, 150);
    try {
        const result = await appendEvent(draftId, JSON.stringify(payload));
        if (savingIndicatorTimer !== null) {
            clearTimeout(savingIndicatorTimer);
            savingIndicatorTimer = null;
        }
        saveStatus.set("saved");

        if (result.needsSnapshot) {
            const stateJson = JSON.stringify(update.state.toJSON(savedFields));
            createSnapshot(draftId, stateJson, result.eventSeq).catch(console.error);
        }
    } catch (e) {
        console.error("[listeners] appendEvent failed:", e);
        if (savingIndicatorTimer !== null) {
            clearTimeout(savingIndicatorTimer);
            savingIndicatorTimer = null;
        }
        saveStatus.set("error");
        return;
    }

    // Debounce metadata update (title, word count, preview)
    if (metaDebounceTimer !== null) clearTimeout(metaDebounceTimer);
    metaDebounceTimer = setTimeout(() => {
        const docText = update.view.state.doc.toString();
        const title = extractTitle(docText);
        const wordCount = docText.trim().split(/\s+/).filter(Boolean).length;
        const previewText = docText.slice(0, 200);
        currentDocumentTitle.set(title);
        updateDocumentMeta(docId, title, wordCount, previewText, "[]").catch(
            console.error,
        );
        metaDebounceTimer = null;
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
    ...(options?.updateListener
        ? [EditorView.updateListener.of(options.updateListener)]
        : []),
];
