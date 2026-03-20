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
    annotationField,
    updateRevisionVersionState,
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
            this._editor.dispatch({
                changes: { from: 0, to: current.length, insert: externalDoc },
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
     * Translates doc changes to parent and notifies callbacks.
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

        this.callbacks.onUpdate?.(
            this._editor.state.field(annotationField),
            getActiveAnnotation(this._editor.state),
        );
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
