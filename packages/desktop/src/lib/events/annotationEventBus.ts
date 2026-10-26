/**
 * annotationEventBus.ts — Typed event bus for annotation UI events.
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

import type { NestedEditorCommand } from "$lib/stores";
import type { EditorView } from "@codemirror/view";
import { type EventOfType, TypedEventBus } from "./createEventBus";

export type PendingNestedEditorSelection = {
    type: "pending-nested-editor-selection";
    annotationId: number;
    from: number;
    to: number;
    /** Focus is explicit because a collapsed selection can still represent an intentional caret. */
    focus: boolean;
};

export type AnnotationEvent =
    | { type: "revision-boundary-nudge"; revisionId: number }
    | { type: "nested-annotation-create"; command: NestedEditorCommand; sourceView: EditorView }
    | { type: "revision-request-modal"; command: NestedEditorCommand; sourceView: EditorView }
    | {
          type: "revision-focus-request";
          revisionId: number;
          relativePos: number;
          sourceView: EditorView;
      }
    | { type: "pending-comment-alert" }
    | { type: "overlapping-revision-alert" }
    | PendingNestedEditorSelection
    | { type: "annotation-focus-reply"; annotationId: number }
    | { type: "annotation-add-version"; annotationId: number }
    | { type: "annotation-enter-editor"; annotationId: number }
    | { type: "revision-modal-flushed"; revisionId: number; sourceView: EditorView };

class AnnotationEventBus extends TypedEventBus<AnnotationEvent> {
    /**
     * Pending nested editor selections need out-of-band storage because
     * the consuming Revision.svelte component may not exist yet when the
     * event fires (the annotation card renders asynchronously). Stored
     * here by annotationId so the component can pull on mount.
     */
    private pendingSelections = new Map<
        number,
        EventOfType<AnnotationEvent, "pending-nested-editor-selection">
    >();

    override emit(event: AnnotationEvent): void {
        if (event.type === "pending-nested-editor-selection") {
            this.pendingSelections.set(event.annotationId, event);
        }
        super.emit(event);
    }

    consumePendingSelection(
        annotationId: number,
    ): EventOfType<AnnotationEvent, "pending-nested-editor-selection"> | undefined {
        const event = this.pendingSelections.get(annotationId);
        if (event) this.pendingSelections.delete(annotationId);
        return event;
    }

    clearPendingSelections(): void {
        this.pendingSelections.clear();
    }
}

export const annotationEventBus = new AnnotationEventBus();
