/**
 * eventBus.ts — Typed event bus for annotation UI events.
 *
 * Replaces the previous token-based deduplication pattern where a single
 * Svelte writable store held the latest event and each consumer tracked
 * a `lastXxxToken` variable to avoid re-processing. That approach required
 * 14+ manual token variables across components and was prone to silent
 * double-fires or missed events.
 *
 * This bus delivers events to registered listeners immediately on emit().
 * Components subscribe in $effect blocks and return the unsubscribe
 * function as cleanup. No tokens needed — each listener fires exactly
 * once per emit.
 */

import type { EditorView } from "@codemirror/view";
import type { NestedEditorCommand } from "$lib/stores";

// ── Event types ──────────────────────────────────────────────

export type AnnotationEvent =
    | { type: "revision-boundary-nudge"; revisionId: number }
    | { type: "nested-annotation-create"; command: NestedEditorCommand; sourceView: EditorView }
    | { type: "revision-request-modal"; command: NestedEditorCommand }
    | {
          type: "revision-focus-request";
          revisionId: number;
          relativePos: number;
          sourceView: EditorView;
      }
    | { type: "pending-comment-alert" }
    | { type: "overlapping-revision-alert" }
    | {
          type: "pending-nested-editor-selection";
          annotationId: number;
          from: number;
          to: number;
      }
    | { type: "annotation-focus-reply"; annotationId: number }
    | { type: "annotation-add-version"; annotationId: number }
    | { type: "annotation-enter-editor"; annotationId: number }
    | { type: "revision-modal-flushed"; revisionId: number; sourceView: EditorView };

type EventType = AnnotationEvent["type"];

/** Extract the specific event shape for a given type string. */
export type EventOfType<T extends EventType> = Extract<AnnotationEvent, { type: T }>;

type Listener<T extends EventType> = (event: EventOfType<T>) => void;

// ── Bus implementation ───────────────────────────────────────

class AnnotationEventBus {
    private listeners = new Map<EventType, Set<Listener<never>>>();

    /**
     * Pending nested editor selections need out-of-band storage because
     * the consuming Revision.svelte component may not exist yet when the
     * event fires (the annotation card renders asynchronously). Stored
     * here by annotationId so the component can pull on mount.
     */
    private pendingSelections = new Map<number, EventOfType<"pending-nested-editor-selection">>();

    /** Subscribe to events of a specific type. Returns an unsubscribe function. */
    on<T extends EventType>(type: T, listener: Listener<T>): () => void {
        let set = this.listeners.get(type);
        if (!set) {
            set = new Set();
            this.listeners.set(type, set);
        }
        const fn = listener as Listener<never>;
        set.add(fn);
        return () => set!.delete(fn);
    }

    /** Emit an event, delivering to all listeners of that type. */
    emit(event: AnnotationEvent): void {
        if (event.type === "pending-nested-editor-selection") {
            this.pendingSelections.set(
                (event as EventOfType<"pending-nested-editor-selection">).annotationId,
                event as EventOfType<"pending-nested-editor-selection">,
            );
        }
        const set = this.listeners.get(event.type);
        if (!set) return;
        for (const listener of set) {
            (listener as Listener<typeof event.type>)(event as never);
        }
    }

    /** Pull a pending selection for the given annotation (one-shot). */
    consumePendingSelection(
        annotationId: number,
    ): EventOfType<"pending-nested-editor-selection"> | undefined {
        const event = this.pendingSelections.get(annotationId);
        if (event) this.pendingSelections.delete(annotationId);
        return event;
    }

    /** Clear all pending selections (called on document switch). */
    clearPendingSelections(): void {
        this.pendingSelections.clear();
    }
}

export const annotationEventBus = new AnnotationEventBus();
