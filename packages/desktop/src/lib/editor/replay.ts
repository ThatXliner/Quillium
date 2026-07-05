import type { AnnotationEvent, EventPayload } from "$lib/db/events";
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
import { EditorSelection, type EditorState, type StateEffect } from "@codemirror/state";
import { addAnnotation, annotationField, removeAnnotation } from "./plugins/annotations";
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

/**
 * Applies a single EventPayload to an EditorState, returning the
 * updated state.  Throws on malformed changes so the caller can
 * catch and skip the offending event.
 */
function applyEventPayload(state: EditorState, payload: EventPayload): EditorState {
    switch (payload.type) {
        case "doc_change":
            return state.update({
                changes: payload.changes,
                selection: EditorSelection.fromJSON(payload.selection),
            }).state;

        case "compound": {
            const effects = buildAnnotationEffects(state, payload.annotationEvents);
            return state.update({
                changes: payload.docChanges,
                effects,
                selection: EditorSelection.fromJSON(payload.selection),
            }).state;
        }

        case "annotation_add":
        case "annotation_update": {
            const ann = deserializeAnnotation(payload.annotation);
            if (!ann) return state;
            return state.update({ effects: [addAnnotation.of(ann)] }).state;
        }

        case "annotation_remove": {
            const ann = state.field(annotationField)[payload.annotationId];
            if (!ann) return state;
            return state.update({ effects: [removeAnnotation.of(ann)] }).state;
        }

        default: {
            // Unknown or unsupported event type — treat as malformed so
            // the caller's try/catch can skip this record safely.
            const unknownType = (payload as { type?: string }).type ?? "unknown";
            throw new Error(`Unknown event payload type: ${unknownType}`);
        }
    }
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
export function replayEvents(state: EditorState, events: EventRecord[]): EditorState {
    let current = state;
    let failures = 0;
    for (const record of events) {
        try {
            const payload = JSON.parse(record.payload) as EventPayload;
            current = applyEventPayload(current, payload);
        } catch (err) {
            failures++;
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
    return current;
}

/** Best-effort extract of the event type from a raw payload string. */
function tryParseType(payload: string): string | undefined {
    try {
        return (JSON.parse(payload) as { type?: string }).type;
    } catch {
        return undefined;
    }
}
