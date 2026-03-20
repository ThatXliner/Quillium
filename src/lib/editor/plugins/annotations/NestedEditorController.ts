/**
 * NestedEditorController — Encapsulates the lifecycle and bidirectional
 * sync logic for nested CodeMirror editors inside revision annotations.
 *
 * Used by both Revision.svelte (inline editor) and RevisionModal.svelte
 * (modal editor). Eliminates the duplicated pullingFromParent/
 * lastDispatchedDoc guards and fixes the timing bug where the boolean
 * guard was set synchronously but the updateListener fired asynchronously.
 *
 * Fix: instead of a component-level boolean, we use a CodeMirror
 * Transaction.annotation (`parentSyncEdit`) to tag transactions that
 * originate from parent sync. The updateListener checks this annotation
 * on the transaction itself, which is always in scope and timing-safe.
 */

import { Annotation, Transaction } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import {
    addAnnotation,
    annotationField,
    removeAnnotation,
    updateRevisionVersionState,
    updateThread,
} from "./annotationField";
import { createNestedEditorState, translateAndDispatch } from "./nestedEditor";
import { nestedSavedFields } from "$lib/editor/extensions";
import { getActiveAnnotation } from "./utils";
import { annotationEventBus } from "./eventBus";
import type { VersionState, Annotation as AnnotationType, Annotations } from "./models";
import { isAnnotationOfType, type GenericAnnotation } from "./models";

/** Transaction annotation marking a sync from the parent document. */
const parentSyncEdit = Annotation.define<true>();

export type NestedEditorCallbacks = {
    /** Called after every nested editor transaction with updated annotation state. */
    onUpdate?: (annotations: Annotations, activeAnnotation: GenericAnnotation | undefined) => void;
};

export type FlushBehavior = "flush" | "no-flush";

/**
 * Controls the lifecycle and sync of a nested CodeMirror editor within
 * a revision annotation. Handles:
 * - Creating/destroying the nested EditorView
 * - Translating nested edits to parent coordinates (nested → parent)
 * - Patching the nested editor from external parent changes (parent → nested)
 * - Optional state flush on destroy (modal uses flush, inline does not)
 * - Version switch and annotation blob change detection
 */
export class NestedEditorController {
    private _editor: EditorView | undefined;
    private _mountedVersionIndex = -1;
    private _mountedAnnotationFieldBlob: unknown = undefined;
    private _lastDispatchedDoc = "";
    private _editorVersionIndex = 0;

    constructor(
        private readonly parentView: EditorView,
        private readonly revisionId: number,
        private readonly callbacks: NestedEditorCallbacks,
        private readonly flushBehavior: FlushBehavior,
    ) {}

    /** The nested editor instance, or undefined if not mounted. */
    get editor(): EditorView | undefined {
        return this._editor;
    }

    /** Which version index the editor was built for. */
    get mountedVersionIndex(): number {
        return this._mountedVersionIndex;
    }

    /** The annotationField blob the editor was built from. */
    get mountedAnnotationFieldBlob(): unknown {
        return this._mountedAnnotationFieldBlob;
    }

    /**
     * Create the nested editor in the given host element.
     */
    create(
        host: HTMLDivElement,
        version: VersionState,
        versionIndex: number,
        pendingSelection?: { from: number; to: number },
    ): void {
        if (this._editor) return;

        const state = createNestedEditorState(
            version,
            (update: ViewUpdate) => this.onNestedUpdate(update),
            this.parentView,
            this.revisionId,
        );

        this._editor = new EditorView({ state, parent: host });
        this._mountedVersionIndex = versionIndex;
        this._editorVersionIndex = versionIndex;
        this._mountedAnnotationFieldBlob = (version as { annotationField?: unknown }).annotationField;
        this._lastDispatchedDoc = this._editor.state.doc.toString();

        // Fire initial callback
        this.callbacks.onUpdate?.(
            this._editor.state.field(annotationField),
            getActiveAnnotation(this._editor.state),
        );

        // Apply pending selection
        if (pendingSelection) {
            const docLen = this._editor.state.doc.length;
            const from = Math.min(pendingSelection.from, docLen);
            const to = Math.min(pendingSelection.to, docLen);
            this._editor.dispatch({
                selection: { anchor: from, head: to },
                scrollIntoView: true,
            });
            this._editor.focus();
        }
    }

    /**
     * Destroy the nested editor. If flushBehavior is "flush", serializes
     * nested state back to the parent version blob first.
     */
    destroy(): void {
        if (!this._editor) return;

        if (this.flushBehavior === "flush") {
            this.flushToParent();
        }

        this._editor.destroy();
        this._editor = undefined;
        this._mountedVersionIndex = -1;
        this._mountedAnnotationFieldBlob = undefined;
    }

    /**
     * Sync the nested editor content from an external parent doc change.
     * Skips if the doc matches what was last dispatched upward (our own edit).
     * Uses a transaction annotation instead of a boolean guard to avoid
     * timing issues with async updateListener callbacks.
     */
    syncFromParent(externalDoc: string): void {
        if (!this._editor) return;
        if (externalDoc === this._lastDispatchedDoc) return;

        const current = this._editor.state.doc.toString();
        if (current !== externalDoc) {
            // Compute a minimal diff via common prefix/suffix matching.
            // This preserves nested annotation positions through small,
            // localized changes instead of destroying them with a
            // full-document replacement.
            const minLen = Math.min(current.length, externalDoc.length);
            let prefix = 0;
            while (
                prefix < minLen &&
                current.charCodeAt(prefix) === externalDoc.charCodeAt(prefix)
            ) {
                prefix++;
            }
            let suffix = 0;
            while (
                suffix < minLen - prefix &&
                current.charCodeAt(current.length - 1 - suffix) ===
                    externalDoc.charCodeAt(externalDoc.length - 1 - suffix)
            ) {
                suffix++;
            }
            const from = prefix;
            const to = current.length - suffix;
            const insert = externalDoc.slice(prefix, externalDoc.length - suffix);

            this._editor.dispatch({
                changes: { from, to, insert },
                annotations: [
                    Transaction.addToHistory.of(false),
                    parentSyncEdit.of(true),
                ],
            });
        }
        this._lastDispatchedDoc = externalDoc;
    }

    /** Whether a version switch is needed. */
    needsVersionSwitch(newVersionIndex: number): boolean {
        return this._editor !== undefined && newVersionIndex !== this._mountedVersionIndex;
    }

    /** Whether the annotationField blob changed (modal flush detection). */
    needsAnnotationRebuild(newBlob: unknown): boolean {
        return this._editor !== undefined && newBlob !== this._mountedAnnotationFieldBlob;
    }

    /**
     * Consume a pending selection event from the event bus for
     * the controller's revision, if one exists.
     */
    applyPendingSelection(): void {
        if (!this._editor) return;
        const event = annotationEventBus.consumePendingSelection(this.revisionId);
        if (!event) return;
        const docLen = this._editor.state.doc.length;
        this._editor.dispatch({
            selection: {
                anchor: Math.min(event.from, docLen),
                head: Math.min(event.to, docLen),
            },
            scrollIntoView: true,
        });
        this._editor.focus();
    }

    /**
     * Internal: called on every nested editor transaction.
     * Handles both upward data paths:
     *   1. Doc changes → translateAndDispatch (maps changes to parent coordinates)
     *   2. Annotation changes → flushAnnotationStateToParent (serializes
     *      annotationField blob to the parent's version state)
     *
     * Both paths dispatch to the parent with addToHistory: true so the
     * parent's undo history captures all nested mutations — not just doc
     * edits. This closes the architectural gap where annotation-only
     * mutations (e.g. creating a comment in a nested editor) had no
     * upward path and were invisible to parent undo.
     */
    private onNestedUpdate(update: ViewUpdate): void {
        if (!this._editor) return;

        // Check for parent sync annotation on the transactions —
        // if present, this is our own sync, don't bounce back.
        const isParentSync = update.transactions.some(
            (tr) => tr.annotation(parentSyncEdit) === true,
        );

        if (!isParentSync && translateAndDispatch(update, this.parentView, this.revisionId)) {
            this._lastDispatchedDoc = this._editor.state.doc.toString();
        }

        // For modal editors (flushBehavior: "flush"), detect annotation-only
        // mutations (add/remove/update effects) and propagate them to the
        // parent's version blob so they enter the parent's undo history.
        // Inline editors (flushBehavior: "no-flush") skip this — their
        // annotation state is ephemeral, and flushing here would trigger
        // the annotation-rebuild $effect in Revision.svelte, which tears
        // down and recreates the inline editor on every annotation change.
        if (
            this.flushBehavior === "flush" &&
            !isParentSync &&
            this.hasAnnotationMutationEffect(update)
        ) {
            this.flushAnnotationStateToParent();
        }

        this.callbacks.onUpdate?.(
            this._editor.state.field(annotationField),
            getActiveAnnotation(this._editor.state),
        );
    }

    /**
     * Check whether any transaction in this update carried an
     * annotation-mutating effect (add, remove, or thread update).
     *
     * This deliberately ignores position remapping through doc changes
     * (Phase 1), which happens on every doc-changing transaction but
     * doesn't represent a user-initiated annotation mutation. Without
     * this distinction, every keystroke in the nested editor would
     * trigger an extra _updateRevisionVersionState dispatch.
     */
    private hasAnnotationMutationEffect(update: ViewUpdate): boolean {
        return update.transactions.some((tr) =>
            tr.effects.some(
                (e) =>
                    e.is(addAnnotation) ||
                    e.is(removeAnnotation) ||
                    e.is(updateThread),
            ),
        );
    }

    /**
     * Serialize the nested editor's annotationField state to the parent's
     * version blob with addToHistory: true. This is the upward path for
     * annotation mutations — the complement to translateAndDispatch for
     * doc changes.
     */
    private flushAnnotationStateToParent(): void {
        if (!this._editor) return;

        const rev = this.parentView.state.field(annotationField)[
            this.revisionId
        ] as AnnotationType<"revision"> | undefined;

        if (rev && this._editorVersionIndex < rev.versions.length) {
            const blob = this._editor.state.toJSON(
                nestedSavedFields,
            ) as VersionState;
            this.parentView.dispatch(
                updateRevisionVersionState(
                    this.parentView.state,
                    this.revisionId,
                    this._editorVersionIndex,
                    blob,
                    { addToHistory: true },
                ),
            );
        }
    }

    /**
     * Flush nested editor state back to the parent revision's version blob.
     */
    private flushToParent(): void {
        if (!this._editor) return;

        const rev = this.parentView.state.field(annotationField)[this.revisionId] as
            | AnnotationType<"revision">
            | undefined;

        if (rev && this._editorVersionIndex < rev.versions.length) {
            const blob = this._editor.state.toJSON(nestedSavedFields) as VersionState;
            this.parentView.dispatch(
                updateRevisionVersionState(
                    this.parentView.state,
                    this.revisionId,
                    this._editorVersionIndex,
                    blob,
                    { addToHistory: false },
                ),
            );
        }
    }
}
