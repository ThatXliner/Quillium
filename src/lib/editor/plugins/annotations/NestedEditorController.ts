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
    addSuggestion,
    _addVersionToRevision,
    _deleteVersionFromRevision,
    _updateActiveRevisionVersion,
    _updateRevisionVersionDoc,
    _updateRevisionVersionLabel,
    _updateRevisionVersionState,
    _applySuggestion,
} from "./annotationField";
import {
    createNestedEditorState,
    mergeNestedVersionState,
    translateAndDispatch,
} from "./nestedEditor";
import { nestedSavedFields } from "$lib/editor/extensions";
import { getActiveAnnotation } from "./utils";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import type { VersionState, Annotation as AnnotationType, Annotations } from "./models";
import type { GenericAnnotation } from "./models";
import { versionById } from "./models";
import posthog from "$lib/posthog";

/** Transaction annotation marking a sync from the parent document. */
const parentSyncEdit = Annotation.define<true>();

export type NestedEditorCallbacks = {
    /** Called after every nested editor transaction with updated annotation state. */
    onUpdate?: (annotations: Annotations, activeAnnotation: GenericAnnotation | undefined) => void;
};

export type FlushBehavior = "flush" | "flush-on-destroy" | "no-flush";

function hasAnnotations(annotations: Annotations): boolean {
    return Object.keys(annotations).length > 0;
}

export function transactionsHaveAnnotationMutationEffect(
    transactions: readonly Transaction[],
): boolean {
    return transactions.some((tr) =>
        tr.effects.some(
            (e) =>
                e.is(addAnnotation) ||
                e.is(removeAnnotation) ||
                e.is(updateThread) ||
                e.is(addSuggestion) ||
                e.is(_applySuggestion) ||
                e.is(_addVersionToRevision) ||
                e.is(_deleteVersionFromRevision) ||
                e.is(_updateActiveRevisionVersion) ||
                e.is(_updateRevisionVersionDoc) ||
                e.is(_updateRevisionVersionLabel) ||
                e.is(_updateRevisionVersionState),
        ),
    );
}

export function serializedNestedAnnotationSnapshot(version: VersionState): string {
    const raw = version as { annotationField?: unknown; selection?: unknown };
    return JSON.stringify({
        annotationField: raw.annotationField ?? null,
        selection: raw.selection ?? null,
    });
}

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
    // Stable id of the version this editor is mounted on. Switch/flush decisions
    // compare by id (not index) so add/delete of a *sibling* version can't make
    // the editor think it's on a different version.
    private _mountedVersionId: string | undefined;
    private _lastDispatchedDoc = "";
    private _editorVersionId = "";
    private _lastMountedBlob: string | undefined;

    constructor(
        private readonly parentView: EditorView,
        private readonly revisionId: number,
        private readonly callbacks: NestedEditorCallbacks,
        private readonly flushBehavior: FlushBehavior,
        private readonly historyView?: EditorView,
    ) {}

    /** The nested editor instance, or undefined if not mounted. */
    get editor(): EditorView | undefined {
        return this._editor;
    }

    /** Which version index the editor was built for. */
    get mountedVersionIndex(): number {
        return this._mountedVersionIndex;
    }

    /**
     * Create the nested editor in the given host element.
     * Phase 10: Collab subtree bindings removed. Local-only mode.
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
            this.historyView,
        );

        this._editor = new EditorView({ state, parent: host });
        this._mountedVersionIndex = versionIndex;
        this._mountedVersionId = version.id;
        this._editorVersionId = version.id;
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

        // Snapshot only the serialized nested editor state that requires a
        // rebuild. Plain doc text changes are patched by syncFromParent.
        this._lastMountedBlob = serializedNestedAnnotationSnapshot(version);
    }

    /**
     * Destroy the nested editor. If flushBehavior is "flush" or
     * "flush-on-destroy", serializes nested state back to the parent
     * version blob first — unless `skipFlush` is true.
     *
     * Pass `skipFlush: true` when a modal holds the authoritative state
     * for this revision (the modal will flush on its own destroy).
     * Without this, the inline editor's stale flush would overwrite
     * the modal's annotations with an empty blob.
     */
    destroy(options?: { skipFlush?: boolean }): void {
        if (!this._editor) return;

        if (
            !options?.skipFlush &&
            (this.flushBehavior === "flush" || this.flushBehavior === "flush-on-destroy")
        ) {
            this.flushToParent();
        }

        this._editor.destroy();
        this._editor = undefined;
        this._mountedVersionIndex = -1;
        this._mountedVersionId = undefined;
        this._lastMountedBlob = undefined;
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
                annotations: [Transaction.addToHistory.of(false), parentSyncEdit.of(true)],
            });
        }
        this._lastDispatchedDoc = externalDoc;
    }

    /** Whether a version switch is needed (compared by stable version id). */
    needsVersionSwitch(newVersionId: string): boolean {
        return this._editor !== undefined && newVersionId !== this._mountedVersionId;
    }

    /**
     * Signal whether the current nested EditorView must be torn down and rebuilt.
     *
     * Compare the CURRENT serialized nested annotation state against the blob
     * we mounted. A mismatch means nested annotations changed outside the live
     * editor (remote sync, modal flush, parent-level undo) and CM decorations
     * must be rebuilt from the parent-authoritative blob.
     */
    needsAnnotationRebuild(version: VersionState): boolean {
        if (!this._editor) return false;
        const currentBlob = serializedNestedAnnotationSnapshot(version);
        return currentBlob !== this._lastMountedBlob;
    }

    /**
     * Persist the mounted nested editor's annotation state to its current
     * parent version without changing document text.
     *
     * Call this immediately before version transitions. Once the parent
     * activeVersionIndex changes, destroy-time flushing intentionally skips
     * to avoid writing stale state into the newly active version.
     */
    flushCurrentStateToParent(addToHistory = false): void {
        this.flushAnnotationStateToParent(addToHistory);
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
     */
    private onNestedUpdate(update: ViewUpdate): void {
        if (!this._editor) return;

        const hadNestedAnnotations = hasAnnotations(update.startState.field(annotationField));

        // Check for parent sync annotation on the transactions —
        // if present, this is our own sync, don't bounce back.
        const isParentSync = update.transactions.some(
            (tr) => tr.annotation(parentSyncEdit) === true,
        );

        // Translate doc changes and flush annotation state
        if (!isParentSync && translateAndDispatch(update, this.parentView, this.revisionId)) {
            // The parent dispatch runs synchronously and its side effects
            // (e.g. a version switch) may destroy this controller — re-check
            // before touching the editor.
            if (!this._editor) return;
            this._lastDispatchedDoc = this._editor.state.doc.toString();
        }

        // Detect annotation mutations and propagate them to the parent's
        // version blob so they enter the parent's undo history. Doc-only
        // remaps are bookkeeping flushes, including parent-sync updates.
        if (this.flushBehavior !== "no-flush") {
            if (!isParentSync && this.hasAnnotationMutationEffect(update)) {
                this.flushAnnotationStateToParent(true);
            } else if (update.docChanged && (hadNestedAnnotations || this.hasNestedAnnotations())) {
                // Bookkeeping flush: keep blob positions in sync with doc.
                this.flushAnnotationStateToParent(false);
            }
        }

        this.callbacks.onUpdate?.(
            this._editor.state.field(annotationField),
            getActiveAnnotation(this._editor.state),
        );
    }

    /**
     * Check whether any transaction in this update carried an
     * annotation-mutating effect.
     *
     * This deliberately ignores position remapping through doc changes
     * (Phase 1), which happens on every doc-changing transaction but
     * doesn't represent a user-initiated annotation mutation.
     * Doc-change flushes are handled separately (with addToHistory:
     * false) and only when the nested editor has sub-annotations.
     */
    private hasAnnotationMutationEffect(update: ViewUpdate): boolean {
        return transactionsHaveAnnotationMutationEffect(update.transactions);
    }

    /**
     * Whether the nested editor currently has any sub-annotations.
     * Used to decide if doc changes need an annotation-state flush
     * to keep the parent blob's positions in sync.
     */
    private hasNestedAnnotations(): boolean {
        if (!this._editor) return false;
        return hasAnnotations(this._editor.state.field(annotationField));
    }

    /**
     * Serialize the nested editor's annotationField state to the parent's
     * version blob. This is the upward path for annotation mutations — the
     * complement to translateAndDispatch for doc changes.
     *
     * @param addToHistory — whether the parent dispatch enters the undo
     *   history. `true` for user-initiated annotation mutations (add, remove,
     *   updateThread); `false` for bookkeeping flushes that keep blob
     *   positions in sync with doc changes.
     */
    private flushAnnotationStateToParent(addToHistory = true): void {
        if (!this._editor) return;

        const rev = this.parentView.state.field(annotationField)[this.revisionId] as
            | AnnotationType<"revision">
            | undefined;

        const existing = rev ? versionById(rev, this._editorVersionId) : undefined;
        if (rev && existing) {
            // If the parent already switched to a different version,
            // syncFromParent may have contaminated this editor with the
            // NEW version's text, collapsing sub-annotation ranges.
            // Flushing now would overwrite the old version's annotations
            // with the corrupted (empty) state.
            if (rev.activeVersionId !== this._editorVersionId) return;

            // Merge nested editor's sub-annotation state into the parent's
            // existing version blob, preserving the parent's authoritative
            // `doc` (kept current by translateAndDispatch + Phase 3).
            const nestedState = this._editor.state.toJSON(nestedSavedFields) as Record<
                string,
                unknown
            >;
            const blob = mergeNestedVersionState(existing, nestedState);
            this.parentView.dispatch(
                updateRevisionVersionState(
                    this.parentView.state,
                    this.revisionId,
                    this._editorVersionId,
                    blob,
                    { addToHistory },
                ),
            );
            // Update the mounted blob snapshot so needsAnnotationRebuild
            // does not see this flush as an external change.
            this._lastMountedBlob = serializedNestedAnnotationSnapshot(blob);
        }
    }

    /**
     * SAFETY NET — believed redundant. Doc text is already synced
     * per-keystroke by `translateAndDispatch`, and sub-annotations
     * are synced per-effect by `flushAnnotationStateToParent`.
     * This only fires on destroy as a belt-and-suspenders guard.
     *
     * Instrumented with PostHog to track whether it ever writes
     * state that differs from what the parent already has. If
     * telemetry shows zero meaningful flushes over ~1 month,
     * this method and the destroy-time call should be removed.
     */
    private flushToParent(): void {
        if (!this._editor) return;

        const rev = this.parentView.state.field(annotationField)[this.revisionId] as
            | AnnotationType<"revision">
            | undefined;

        const existing = rev ? versionById(rev, this._editorVersionId) : undefined;
        if (rev && existing) {
            // If the parent already switched to a different version,
            // syncFromParent may have contaminated this editor with the
            // NEW version's text, collapsing sub-annotation ranges.
            // Flushing now would overwrite the old version's annotations
            // with the corrupted (empty) state. The version switch
            // transaction already captured the old version's doc via
            // Phase 3, and flushAnnotationStateToParent synced
            // sub-annotations on each prior mutation, so this flush
            // is redundant after a version switch.
            if (rev.activeVersionId !== this._editorVersionId) return;

            // Merge nested editor's sub-annotation state into the parent's
            // existing version blob, preserving the parent's authoritative
            // `doc` (kept current by translateAndDispatch + Phase 3).
            const nestedState = this._editor.state.toJSON(nestedSavedFields) as Record<
                string,
                unknown
            >;
            const blob = mergeNestedVersionState(existing, nestedState);

            // Compare against what the parent already has to detect
            // whether this flush actually contributes new state.
            // Normalize missing/null to {}: fresh version blobs are created
            // without an annotationField key, while a live editor with zero
            // annotations serializes the field as {} — both mean "no
            // annotations", and comparing them as different would fire a
            // false "meaningful flush" on the first close of every
            // never-annotated revision version (see #150).
            const parentAnns = JSON.stringify(
                (existing as { annotationField?: unknown })?.annotationField ?? {},
            );
            const nestedAnns = JSON.stringify(nestedState.annotationField ?? {});
            const annsDiffer = parentAnns !== nestedAnns;

            if (annsDiffer) {
                posthog.capture("nested_editor_flush_to_parent_meaningful", {
                    revisionId: this.revisionId,
                    versionId: this._editorVersionId,
                    annsDiffer,
                });
            }

            this.parentView.dispatch(
                updateRevisionVersionState(
                    this.parentView.state,
                    this.revisionId,
                    this._editorVersionId,
                    blob,
                    { addToHistory: false },
                ),
            );
        }
    }
}
