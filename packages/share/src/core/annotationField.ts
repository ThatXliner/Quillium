/**
 * annotationField.ts — Core annotation state and effects
 *
 * This file defines the CodeMirror StateField that holds all
 * annotation data (comments, revisions, suggestions) and the
 * StateEffects that mutate it. It is the single source of
 * truth for annotation state.
 *
 * Role in the annotation subsystem:
 *   - Owns `annotationField`, the StateField whose value is
 *     an `Annotations` map (id -> GenericAnnotation).
 *   - Declares all StateEffects that can modify annotations
 *     (add, remove, thread updates, version management,
 *     suggestion application, undo-restore, cleanup).
 *   - Exports transaction-builder functions (e.g.
 *     setActiveRevisionVersion, createNewRevision) that
 *     bundle effects + doc changes into atomic updates.
 *   - Exports `invertedAnnotationFieldEffects` (built with
 *     the `invertedEffects` utility from @codemirror/commands)
 *     so undo/redo correctly inverts annotation mutations.
 *
 * State lifecycle:
 *   - Created as an empty map `[]`.
 *   - On every transaction, the reducer:
 *     1. Remaps all annotation selections through doc changes.
 *     2. Processes effects (add/remove/update).
 *     3. Pulls active revision version text from the document.
 *   - Serialized/deserialized via toJSON/fromJSON for
 *     persistence.
 *
 * Key dependencies:
 *   - @codemirror/state (StateField, StateEffect, Transaction)
 *   - @codemirror/commands (invertedEffects) for undo support
 *   - @codemirror/search (SearchCursor) for text-based
 *     suggestion placement
 *   - ./models for type definitions
 *   - ./utils for range mapping helpers
 *
 * Interactions:
 *   - index.ts imports effects and transaction builders to
 *     wire up keybindings and public API functions.
 *   - utils.ts reads annotationField for cursor queries.
 *   - Svelte stores sync with this field via updateListener.
 */

import { invertedEffects } from "@codemirror/commands";
import { SearchCursor } from "@codemirror/search";
import {
    Annotation,
    ChangeSet,
    EditorSelection,
    type EditorState,
    SelectionRange,
    StateEffect,
    StateField,
    Transaction,
    type TransactionSpec,
} from "@codemirror/state";
import { mapValues } from "lodash-es";
import {
    type Annotations,
    type GenericAnnotation,
    type RawAnnotations,
    RawAnnotationsSchema,
    type SuggestionReplacement,
    type Thread,
    type VersionState,
    activeVersionIndex,
    createNewAnnotation,
    getNewId,
    groupPartnersOf,
    isAnnotationOfType,
    makeVersion,
    normalizeRevision,
    versionById,
    versionIndexById,
    versionText,
} from "./models";
import { cleanRangesOf, mapRange } from "./utils";
// Lazily-used (function-body only) import — see groupSwitchTargets. The
// annotationField ↔ versionGroupField pair forms a safe ESM cycle because all
// cross-references happen inside functions, never at module top level.
import { versionGroupField } from "./versionGroupField";
// -------------------------------------------------------
// StateEffect declarations
//
// Each effect represents a discrete mutation on the
// annotation map. Separating them (rather than a single
// "updateAnnotation" effect) makes undo/redo inversion
// straightforward — each effect has a clear inverse.
//
// Effects that carry a GenericAnnotation use `map: mapRange`
// so their positional data stays accurate when mapped
// through the undo history.
// -------------------------------------------------------

// === For all annotations ===
export const addAnnotation = StateEffect.define<GenericAnnotation>({
    map: mapRange,
});
type RestoreAnnotation = {
    annotation: GenericAnnotation;
    /** The history event's document change, from the event's current doc to its result. */
    undoChanges: ChangeSet;
};

// Used exclusively by the undo system to restore an exact annotation snapshot.
// The desired snapshot is expressed in the history event's RESULT document,
// whereas CodeMirror maps stored effects in the event's START document when an
// addToHistory:false edit intervenes. Keeping the event's undo ChangeSet lets
// the effect derive CodeMirror's equivalent `before` mapping and rebase the
// snapshot in the correct coordinate space. This also preserves reversed
// selections and collapsed revisions rather than reconstructing only from/to.
const _restoreAnnotation = StateEffect.define<RestoreAnnotation>({
    map(value, mapping) {
        const assoc = isAnnotationOfType(value.annotation, "revision") ? 1 : 0;

        // When CodeMirror joins adjacent history events, it maps the newer
        // event's effects through the older event's inverse ChangeSet. That
        // mapping starts in this restore's result document, so compose the two
        // undo changes and map the exact snapshot directly.
        if (mapping instanceof ChangeSet) {
            return {
                annotation: {
                    ...value.annotation,
                    selection: value.annotation.selection.map(mapping, assoc),
                },
                undoChanges: value.undoChanges.compose(mapping),
            };
        }

        // addToHistory:false mappings instead start in the history event's
        // current document. Translate them across the event change first.
        const before = mapping.mapDesc(value.undoChanges, true);
        const annotation = {
            ...value.annotation,
            selection: value.annotation.selection.map(before, assoc),
        };
        return {
            annotation,
            undoChanges: value.undoChanges.map(mapping),
        };
    },
});

// History-only removal that cannot be mapped away when an intervening document
// change consumes the annotation's old range.
const _removeAnnotationById = StateEffect.define<number>();
// Carries the full annotation object (not just an ID) so that undo inversion
// can restore exact prior state without a startState lookup.
export const removeAnnotation = StateEffect.define<GenericAnnotation>({
    map: mapRange,
});
// Each mutation gets its own effect type so undo/redo inversion is explicit
// and local — each effect's inverse is declared adjacent to it in
// invertedAnnotationFieldEffects.

// updateThread carries the full annotation ID + new thread; using only an ID
// would require reading startState inside effects, which is more complex.
// === Generic annotation thread management ===
export const updateThread = StateEffect.define<{
    annotationId: number;
    newThread: Thread;
}>();
// Marks a transaction as a revision-internal doc edit — i.e. the document
// change is part of the revision system's own operation (version switch,
// version delete, branch, etc.), not the user typing. Set to true on every
// transaction dispatched by the public revision API builders.
//
// Two consumers check for this flag to avoid treating system-driven changes
// as user edits:
//   - collapsedRevisionResolver: skips auto-removal of collapsed revisions,
//     because the collapse is intentional (the builder is about to replace
//     the text with the correct version content).
//   - boundaryInsertNudge: skips emitting nudge UI events for programmatic
//     insertions.
//   - invertedAnnotationFieldEffects: skips implicit annotation remapping
//     detection, because these transactions manage their own annotation state
//     via explicit StateEffects.
//
// This is a Transaction.annotation (not a StateEffect), so it is never
// stored in history and never inverted. The inverted StateEffects on each
// transaction already carry the full semantic meaning of "undo this op."
export const revisionInternalEdit = Annotation.define<boolean>();

// Marks a parent-editor transaction that was originated by a nested editor
// acting as a direct viewport. Set to the revision ID whose nested editor
// dispatched the change.
// Consumers (non-exhaustive):
//   - annotationField Phase 3: uses this to pull versions[selected].doc from
//     the parent doc slice so version switching shows current content.
//   - Plugins / integrations that gate behavior on whether a change
//     originated from a nested editor (e.g. to avoid feedback loops or to
//     skip nested-only logic when replaying parent-originated transactions).
// Like revisionInternalEdit, this is a Transaction.annotation — ephemeral,
// not stored in history.
export const nestedEditorEdit = Annotation.define<number>();
// Persists the revision ID for a nested-editor doc change through undo/redo.
// Unlike the nestedEditorEdit Transaction.Annotation (which is ephemeral),
// this StateEffect is stored in CodeMirror's history and replayed on redo.
// Phase 3 reads it to apply the same boundary-expansion logic that runs
// on the forward pass (via nestedEditorEdit), ensuring redo correctly
// expands the revision range when text is re-inserted at its trailing edge.
// invertedAnnotationFieldEffects produces a matching inverse so undo does
// not need to do anything special (Phase 1 shrinks the range correctly).
export const _nestedEditRevision = StateEffect.define<number>({
    // Map the stored revision ID through doc changes — for this effect the
    // payload is just an integer ID, not a position, so no mapping needed.
    map: (value) => value,
});
// Marks a transaction dispatched by collapsedRevisionResolver to remove
// collapsed revisions after a deletion. addToHistory.of(false) ensures no
// new undo entry is created, and this annotation prevents invertedEffects from
// generating spurious addAnnotation effects that would pollute the deletion's
// undo entry (since the deletion's undo already carries the correct
// _restoreAnnotation effects for every collapsed revision).
export const _revisionCleanup = Annotation.define<boolean>();
// === For revisions ===
// These also updates the active revision version to the latest one
// There is no "updateRevisionVersion" since we sniff that from document changes
// NOTE: `versionId`/`to` below are STABLE version ids (VersionState.id), not
// array indices. `at?` on add is still a positional insertion slot so pill order
// is controllable; everything that *identifies* a version uses its id.
export const _addVersionToRevision = StateEffect.define<{
    annotationId: number;
    newVersion: VersionState;
    at?: number;
    // Whether the newly-added version should become active. Defaults to true:
    // the normal "user adds a new version" flow wants focus to move to it. Set
    // false when re-inserting on undo of a NON-active delete, so the restored
    // version reappears without stealing the active pointer (issue #270).
    makeActive?: boolean;
}>();
export const _deleteVersionFromRevision = StateEffect.define<{
    annotationId: number;
    versionId: string;
}>();
export const _updateActiveRevisionVersion = StateEffect.define<{
    annotationId: number;
    to: string;
}>();
export const _updateRevisionVersionState = StateEffect.define<{
    annotationId: number;
    versionId: string;
    versionState: VersionState;
}>();
/**
 * Collab-mode effect: updates ONLY the matching version's doc without triggering
 * parent doc changes. Used by NestedEditorController when collab owns the subtree
 * Y.Text — the nested editor's content is authoritative, and we just need to
 * keep the parent's annotation state in sync for UI rendering.
 */
export const _updateRevisionVersionDoc = StateEffect.define<{
    annotationId: number;
    versionId: string;
    doc: string;
}>();
export const _updateRevisionVersionLabel = StateEffect.define<{
    annotationId: number;
    versionId: string;
    label: string | undefined;
}>();
export function setActiveRevisionVersion(
    state: EditorState,
    annotationId: number,
    toId: string,
    options: { moveCursor?: boolean } = {},
) {
    const original = state.field(annotationField)[annotationId];
    if (!isAnnotationOfType(original, "revision")) {
        throw new Error("Annotation is not a revision");
    }
    const target = versionById(original, toId);
    if (!target) {
        return state.update({});
    }

    // Collect the primary switch plus any linked partners (version groups, #268).
    // Each switch is one _updateActiveRevisionVersion effect + one doc replacement
    // at that revision's range; bundling them into ONE transaction makes the whole
    // group move atomic and revert in a single undo.
    const switches: Array<{ annotationId: number; toId: string }> = [{ annotationId, toId }];
    for (const partner of groupSwitchTargets(state, annotationId, toId)) {
        switches.push(partner);
    }

    const effects: StateEffect<unknown>[] = [];
    const changeSpecs: { from: number; to: number; insert: string }[] = [];
    for (const sw of switches) {
        const rev = state.field(annotationField)[sw.annotationId];
        if (!isAnnotationOfType(rev, "revision")) continue;
        const v = versionById(rev, sw.toId);
        if (!v) continue;
        effects.push(
            _updateActiveRevisionVersion.of({ annotationId: sw.annotationId, to: sw.toId }),
        );
        changeSpecs.push({
            from: rev.selection.main.from,
            to: rev.selection.main.to,
            insert: versionText(v),
        });
    }

    const changes = state.changes(changeSpecs);
    // Move the EDITOR cursor into the primary switched revision so it becomes the
    // active annotation — collapses the "double selection" where the card you
    // click isn't the one the panel anchors to. Off by default so programmatic
    // switches (AI, the group cascade's partners) don't yank the cursor around.
    const spec: TransactionSpec = {
        effects,
        annotations: [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)],
        changes,
    };
    if (options.moveCursor) {
        const caret = changes.mapPos(original.selection.main.from, 1);
        spec.selection = EditorSelection.cursor(caret);
    }
    return state.update(spec);
}

/**
 * Resolve the linked partner switches for activating (annotationId → toId).
 *
 * Looks up the target member's version group and, for every OTHER revision in
 * that group, returns the switch to its grouped version — but only when that
 * revision isn't already on its target (no redundant doc churn) and the target
 * version still exists. Empty when the version is ungrouped. Exclusive membership
 * means each partner revision has exactly one target, so there is no oscillation.
 *
 * Imports the group field lazily (function-body access) so the
 * annotationField ↔ versionGroupField module pair stays a safe ESM cycle.
 */
function groupSwitchTargets(
    state: EditorState,
    annotationId: number,
    toId: string,
): Array<{ annotationId: number; toId: string }> {
    const groups = state.field(versionGroupField, false);
    if (!groups) return [];
    const partners = groupPartnersOf(groups, { revisionId: annotationId, versionId: toId });
    const result: Array<{ annotationId: number; toId: string }> = [];
    for (const p of partners) {
        const rev = state.field(annotationField)[p.revisionId];
        if (!isAnnotationOfType(rev, "revision")) continue;
        if (rev.activeVersionId === p.versionId) continue; // already there
        if (!versionById(rev, p.versionId)) continue; // stale member
        result.push({ annotationId: p.revisionId, toId: p.versionId });
    }
    return result;
}

function annotationFullyContainedInSelection(
    annotation: GenericAnnotation,
    selection: EditorSelection,
): boolean {
    const { from, to } = selection.main;
    return annotation.selection.ranges.every((range) => range.from >= from && range.to <= to);
}

function rebaseSelectionToVersion(selection: EditorSelection, offset: number): EditorSelection {
    const ranges = selection.ranges.map((range) =>
        EditorSelection.range(range.anchor - offset, range.head - offset),
    );
    return EditorSelection.create(ranges, selection.mainIndex);
}

function serializeNestedAnnotation(
    annotation: GenericAnnotation,
    offset: number,
): Record<string, unknown> {
    return JSON.parse(
        JSON.stringify({
            ...annotation,
            selection: rebaseSelectionToVersion(annotation.selection, offset).toJSON(),
        }),
    );
}

export function makeVersionFromSelection(
    state: EditorState,
    selection: EditorSelection,
    options: { label?: string } = {},
): { version: VersionState; containedAnnotations: GenericAnnotation[] } {
    const { from, to } = selection.main;
    const doc = state.sliceDoc(from, to);
    const containedAnnotations = Object.values(state.field(annotationField)).filter((annotation) =>
        annotationFullyContainedInSelection(annotation, selection),
    );
    const nestedAnnotationField =
        containedAnnotations.length > 0
            ? Object.fromEntries(
                  containedAnnotations.map((annotation) => [
                      annotation.id,
                      serializeNestedAnnotation(annotation, from),
                  ]),
              )
            : undefined;
    const rawVersion: Omit<VersionState, "id"> & { id?: string } & Record<string, unknown> = {
        doc,
        ...(options.label !== undefined ? { label: options.label } : {}),
        ...(nestedAnnotationField !== undefined ? { annotationField: nestedAnnotationField } : {}),
    };
    return {
        version: makeVersion(rawVersion),
        containedAnnotations,
    };
}

export function createNewRevision(state: EditorState, annotationId: number) {
    const original = state.field(annotationField)[annotationId];
    if (!isAnnotationOfType(original, "revision")) {
        throw new Error("Annotation is not a revision");
    }
    const placeholder = "";
    const newVersionState: VersionState = makeVersion({ doc: placeholder });
    const from = original.selection.main.from;
    return state.update({
        effects: [
            _addVersionToRevision.of({
                annotationId,
                newVersion: newVersionState,
            }),
        ],
        changes: state.changes({
            from,
            to: original.selection.main.to,
            insert: placeholder,
        }),
        // Place cursor at start of the new version so isActive becomes true.
        selection: EditorSelection.cursor(from),
        annotations: [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)],
    });
}
export function deleteRevisionVersion(state: EditorState, annotationId: number, versionId: string) {
    const original = state.field(annotationField)[annotationId];
    if (!isAnnotationOfType(original, "revision")) {
        throw new Error("Annotation is not a revision");
    }
    const delIndex = versionIndexById(original, versionId);
    if (delIndex < 0) {
        return state.update({});
    }

    // Deleting the last remaining version deletes the whole revision atom.
    if (original.versions.length === 1) {
        return state.update({
            effects: [removeAnnotation.of(original)],
            annotations: [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)],
            changes: state.changes({
                from: original.selection.main.from,
                to: original.selection.main.to,
                insert: "",
            }),
        });
    }

    const nextVersions = original.versions.filter((v) => v.id !== versionId);
    const deletingActive = versionId === original.activeVersionId;
    // When the active version is deleted, fall to its positional neighbor.
    let nextActiveId = original.activeVersionId;
    if (deletingActive) {
        const fallbackIndex = Math.min(delIndex, nextVersions.length - 1);
        nextActiveId = nextVersions[fallbackIndex].id;
    }

    const effects: StateEffect<unknown>[] = [
        _deleteVersionFromRevision.of({
            annotationId,
            versionId,
        }),
    ];
    if (nextActiveId !== original.activeVersionId) {
        effects.push(
            _updateActiveRevisionVersion.of({
                annotationId,
                to: nextActiveId,
            }),
        );
    }

    const annotations = [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)];
    if (deletingActive) {
        const nextActive = nextVersions.find((v) => v.id === nextActiveId);
        return state.update({
            effects,
            annotations,
            changes: state.changes({
                from: original.selection.main.from,
                to: original.selection.main.to,
                insert: nextActive ? versionText(nextActive) : "",
            }),
        });
    }
    return state.update({
        effects,
        annotations,
    });
}
type UpdateRevisionVersionStateOptions = {
    addToHistory?: boolean;
};

export function updateRevisionVersionState(
    state: EditorState,
    annotationId: number,
    versionId: string,
    newVersionState: VersionState,
    options: UpdateRevisionVersionStateOptions = {},
) {
    const original = state.field(annotationField)[annotationId];
    if (!isAnnotationOfType(original, "revision")) {
        throw new Error("Annotation is not a revision");
    }
    const text = versionText(newVersionState);
    const effects = [
        _updateRevisionVersionState.of({
            annotationId,
            versionId,
            versionState: newVersionState,
        }),
    ];
    const annotations = [
        revisionInternalEdit.of(true),
        Transaction.addToHistory.of(options.addToHistory ?? true),
    ];
    if (original.activeVersionId !== versionId) {
        return state.update({
            effects,
            annotations,
        });
    }
    // Skip doc changes when the document already matches the version text.
    // Redundant changes would appear as "foreign" edits to CodeMirror's
    // history, breaking undo of prior entries (e.g. modal flush after
    // translateAndDispatch).
    const currentText = state.sliceDoc(original.selection.main.from, original.selection.main.to);
    if (currentText === text) {
        return state.update({
            effects,
            annotations,
        });
    }
    return state.update({
        effects,
        annotations,
        changes: state.changes({
            from: original.selection.main.from,
            to: original.selection.main.to,
            insert: text,
        }),
    });
}
export function updateRevisionVersionLabel(
    state: EditorState,
    annotationId: number,
    versionId: string,
    label: string | undefined,
) {
    const original = state.field(annotationField)[annotationId];
    if (!isAnnotationOfType(original, "revision")) {
        throw new Error("Annotation is not a revision");
    }
    return state.update({
        effects: [_updateRevisionVersionLabel.of({ annotationId, versionId, label })],
        annotations: [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)],
    });
}
export function branchSuggestion(state: EditorState, annotationId: number) {
    const annotation = state.field(annotationField)[annotationId];
    if (!isAnnotationOfType(annotation, "suggestion")) {
        throw new Error("Annotation is not a suggestion");
    }
    const { from, to } = annotation.selection.main;
    const originalText = state.doc.sliceString(from, to);

    const versions: VersionState[] = [
        makeVersion({ doc: originalText }),
        ...annotation.replacements.map((r) => makeVersion({ doc: r.text })),
    ];

    const firstReplacement = annotation.replacements[0]?.text ?? originalText;
    // Active = the first replacement (index 1) when there is one, else the original.
    const activeVersionId = (versions[1] ?? versions[0]).id;

    const newRevision = {
        ...createNewAnnotation(
            state.field(annotationField),
            EditorSelection.single(from, from + firstReplacement.length),
            "revision",
        ),
        activeVersionId,
        versions,
        thread: annotation.thread,
    };

    return state.update({
        effects: [removeAnnotation.of(annotation), addAnnotation.of(newRevision)],
        changes: state.changes({ from, to, insert: firstReplacement }),
        annotations: [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)],
    });
}
// === For suggestions ===
export const addSuggestion = StateEffect.define<{
    targetText: string;
    replacements: SuggestionReplacement[];
}>();
// Preview: { annotationId, replacementIndex } while hovering/selecting, null to clear
export const previewSuggestion = StateEffect.define<{
    annotationId: number;
    replacementIndex: number;
} | null>();
export const suggestionPreviewField = StateField.define<{
    annotationId: number;
    replacementIndex: number;
} | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) {
            if (e.is(previewSuggestion)) return e.value;
        }
        // Clear preview when doc changes (suggestion was applied or removed)
        if (tr.docChanged) return null;
        return value;
    },
});
export const _applySuggestion = StateEffect.define<{
    annotationId: number;
    replacementIndex: number;
}>();
export function applySuggestion(
    state: EditorState,
    annotationId: number,
    replacementIndex: number,
) {
    const annotation = state.field(annotationField)[annotationId];
    if (!isAnnotationOfType(annotation, "suggestion")) {
        throw new Error("Invalid annotation type");
    }
    return state.update({
        effects: [_applySuggestion.of({ annotationId, replacementIndex })],
        changes: state.changes({
            from: annotation.selection.main.from,
            to: annotation.selection.main.to,
            insert: annotation.replacements[replacementIndex].text,
        }),
    });
}
// -------------------------------------------------------
// annotationField — the central StateField
//
// State shape: Annotations (a record of id -> annotation).
//
// The reducer runs in three phases on every transaction:
//   1. remapAnnotationSelections — shift all annotation
//      ranges through the document change set so they track
//      edits. Annotations whose ranges collapse to zero
//      width are removed (except revisions, which survive
//      to allow version switching).
//   2. applyAnnotationEffects — process each StateEffect
//      in the transaction to add/remove/mutate annotations.
//   3. pushDocToVersionState — when no explicit
//      revision effect fired, copy the document slice
//      under each active revision back into its version
//      state so the stored text stays current.
//
// Triggers: any transaction (doc changes, effects, or both).
// Downstream: Svelte stores sync via Editor.svelte's
// updateListener; decoration plugins read this field to
// render highlights.
// -------------------------------------------------------

// See issue #78: implicit annotation deletion via text deletion is not tracked
// in the undo history — undoing text does not restore the annotation.

/**
 * Phase 1: Remap all annotation selections through the
 * transaction's change set. Removes annotations whose
 * ranges were fully consumed (collapsed to zero width),
 * except revisions which are kept alive via allowEmpty.
 */
function remapAnnotationSelections(annotations: Annotations, tr: Transaction): Annotations {
    const result: Annotations = {};
    for (const [id, x] of Object.entries(annotations)) {
        const isRevision = isAnnotationOfType(x, "revision");
        const assoc = annotationMappingAssociation(x, annotations, tr);
        const newSelection = cleanRangesOf(x.selection.map(tr.changes, assoc), isRevision);
        if (newSelection) {
            result[id as unknown as number] = { ...x, selection: newSelection };
        }
    }
    return result;
}

/**
 * Pick mapping affinity for an annotation in Phase 1.
 *
 * Empty revisions at a nested target's old start/end represent collapsed
 * siblings that used to sit immediately before/after that target. Preserve
 * that side when the nested editor prepends/appends. A single global affinity
 * cannot handle both directions: right affinity moves an empty predecessor
 * inside a prepend, while left affinity moves an empty follower inside an
 * append.
 */
function annotationMappingAssociation(
    annotation: GenericAnnotation,
    annotations: Annotations,
    tr: Transaction,
): number {
    if (!isAnnotationOfType(annotation, "revision")) return 0;
    if (!annotation.selection.main.empty) return 1;

    const nestedTargetIds = nestedRevisionTargetIds(tr);
    if (nestedTargetIds.has(annotation.id)) return 1;

    const position = annotation.selection.main.from;
    for (const targetId of nestedTargetIds) {
        const target = annotations[targetId];
        if (!target || !isAnnotationOfType(target, "revision")) continue;
        if (target.selection.main.empty) continue;
        if (position === target.selection.main.from) return -1;
        if (position === target.selection.main.to) return 1;
    }
    return 1;
}

function nestedRevisionTargetIds(tr: Transaction): Set<number> {
    const targetIds = new Set<number>();
    const annotatedTarget = tr.annotation(nestedEditorEdit);
    if (annotatedTarget !== undefined) targetIds.add(annotatedTarget);
    for (const effect of tr.effects) {
        if (effect.is(_nestedEditRevision)) targetIds.add(effect.value);
    }
    return targetIds;
}

/**
 * Handles _addVersionToRevision, _deleteVersionFromRevision,
 * and _updateActiveRevisionVersion effects on a single
 * revision annotation. Mutates the annotation in place and
 * returns whether a revision effect was processed.
 */
function applyRevisionVersionEffect(
    e: StateEffect<{ annotationId: number; [key: string]: unknown }>,
    annotation: GenericAnnotation,
    oldAnnotations: Annotations,
    tr: Transaction,
): GenericAnnotation {
    if (!isAnnotationOfType(annotation, "revision")) return annotation;

    if (e.is(_addVersionToRevision)) {
        const insertionIndex = Math.max(
            0,
            Math.min(e.value.at ?? annotation.versions.length, annotation.versions.length),
        );
        const newVersions = annotation.versions.slice();
        newVersions.splice(insertionIndex, 0, e.value.newVersion);
        // Adding a version makes it active by default (matches the user-add flow,
        // where the new slot's index became active). Undo of a non-active delete
        // re-inserts with makeActive: false so the restored version doesn't steal
        // the active pointer (issue #270).
        const makeActive = e.value.makeActive ?? true;
        return {
            ...annotation,
            versions: newVersions,
            activeVersionId: makeActive ? e.value.newVersion.id : annotation.activeVersionId,
        };
    }
    if (e.is(_deleteVersionFromRevision)) {
        const delIndex = versionIndexById(annotation, e.value.versionId);
        const newVersions = annotation.versions.filter((v) => v.id !== e.value.versionId);
        let activeVersionId = annotation.activeVersionId;
        if (e.value.versionId === annotation.activeVersionId && newVersions.length > 0) {
            // Active was deleted: fall to its positional neighbor.
            const fallback = Math.min(Math.max(delIndex, 0), newVersions.length - 1);
            activeVersionId = newVersions[fallback].id;
        } else if (!newVersions.some((v) => v.id === activeVersionId) && newVersions.length > 0) {
            activeVersionId = newVersions[0].id;
        }
        return { ...annotation, versions: newVersions, activeVersionId };
    }
    if (e.is(_updateActiveRevisionVersion)) {
        // When switching versions, reconstruct the selection
        // to cover the inserted text. This is critical for
        // collapsed ranges (all text was deleted) where
        // selection.map() keeps the range collapsed instead
        // of expanding around the newly inserted version
        // text.
        const targetVersion = versionById(annotation, e.value.to);
        const oldAnnotation = oldAnnotations[e.value.annotationId];
        let selection = annotation.selection;
        if (targetVersion && oldAnnotation) {
            const from = tr.changes.mapPos(oldAnnotation.selection.main.from, -1);
            const vText = versionText(targetVersion);
            const to = Math.min(from + vText.length, tr.state.doc.length);
            selection = EditorSelection.single(Math.min(from, tr.state.doc.length), to);
        }
        return { ...annotation, activeVersionId: e.value.to, selection };
    }
    return annotation;
}

/**
 * Phase 3: For revisions not touched by an explicit effect,
 * pull the active version's doc text from the actual document
 * content under the revision's range.
 *
 * @param skipIds - revision IDs that had an explicit effect this
 *   transaction and should not be pulled here.
 */
function pushDocToVersionState(
    annotations: Annotations,
    tr: Transaction,
    skipIds: Set<number> = new Set(),
): Annotations {
    // Nested editor edits that collapse a revision to empty should still
    // pull version.doc to "" — otherwise the stale doc gets pushed back
    // into the nested editor by the external-sync effect. Non-nested
    // deletions skip pulling so undo can restore from _restoreAnnotation.
    // The Transaction annotation exists only on the forward nested edit. Undo
    // and redo retain the serializable StateEffect instead, so both markers
    // must count as nested edits. In particular, an undo/redo that collapses a
    // revision to empty must persist version.doc = "" or switching away and
    // back can resurrect text that history already removed.
    const isNestedEdit =
        tr.annotation(nestedEditorEdit) !== undefined ||
        tr.effects.some((effect) => effect.is(_nestedEditRevision));
    return mapValues(annotations, (x) => {
        if (isAnnotationOfType(x, "revision") && !skipIds.has(x.id)) {
            if (x.selection.main.empty && !isNestedEdit) return x;
            const text = tr.state.doc.slice(x.selection.main.from, x.selection.main.to).toString();
            const activeIdx = activeVersionIndex(x);
            if (text === versionText(x.versions[activeIdx])) return x;
            // Return a new annotation object so Svelte's fine-grained reactivity
            // detects the change and re-derives activeText in Revision.svelte.
            const newVersions = x.versions.slice();
            newVersions[activeIdx] = {
                ...newVersions[activeIdx],
                doc: text,
            };
            return { ...x, versions: newVersions };
        }
        return x;
    });
}

export const annotationField = StateField.define<Annotations>({
    create(): Annotations {
        return {};
    },
    update(oldAnnotations: Annotations, tr: Transaction): Annotations {
        // Phase 1: remap annotation ranges through doc changes
        let annotations = remapAnnotationSelections(oldAnnotations, tr);

        // Phase 2: apply effects
        // Track which revision IDs had an explicit effect so Phase 3
        // can skip pulling only those revisions (not all of them).
        const revisionsWithExplicitEffect = new Set<number>();
        for (const e of tr.effects) {
            if (e.is(addAnnotation)) {
                annotations[e.value.id] = e.value;
                // Skip Phase 3 for revisions added via addAnnotation (e.g., from
                // remote sync). The annotation already has correct versions[].doc
                // from the source; pulling from the main doc would overwrite it
                // with stale content. (#12-01 fix for version switch corruption)
                if (isAnnotationOfType(e.value, "revision")) {
                    revisionsWithExplicitEffect.add(e.value.id);
                }
            } else if (e.is(_restoreAnnotation)) {
                const restored = e.value.annotation;
                annotations[restored.id] = restored;
                // Same logic for restore — the restored annotation has the correct
                // version doc from the undo history.
                if (isAnnotationOfType(restored, "revision")) {
                    revisionsWithExplicitEffect.add(restored.id);
                }
            } else if (e.is(_removeAnnotationById)) {
                delete annotations[e.value];
            } else if (e.is(removeAnnotation)) {
                delete annotations[e.value.id];
            } else if (e.is(updateThread)) {
                const annotation = annotations[e.value.annotationId];
                if (!annotation) continue;
                annotations[e.value.annotationId] = { ...annotation, thread: e.value.newThread };
            } else if (
                e.is(_addVersionToRevision) ||
                e.is(_deleteVersionFromRevision) ||
                e.is(_updateActiveRevisionVersion)
            ) {
                const annotation = annotations[e.value.annotationId];
                if (!annotation || !isAnnotationOfType(annotation, "revision")) continue;
                revisionsWithExplicitEffect.add(e.value.annotationId);
                annotations[e.value.annotationId] = applyRevisionVersionEffect(
                    e,
                    annotation,
                    oldAnnotations,
                    tr,
                );
            } else if (e.is(_updateRevisionVersionLabel)) {
                const annotation = annotations[e.value.annotationId];
                if (!annotation || !isAnnotationOfType(annotation, "revision")) continue;
                const vIdx = versionIndexById(annotation, e.value.versionId);
                if (vIdx >= 0) {
                    const newVersions = annotation.versions.slice();
                    newVersions[vIdx] = {
                        ...newVersions[vIdx],
                        label: e.value.label,
                    };
                    annotations[e.value.annotationId] = { ...annotation, versions: newVersions };
                }
            } else if (e.is(_updateRevisionVersionState)) {
                const annotation = annotations[e.value.annotationId];
                if (!annotation || !isAnnotationOfType(annotation, "revision")) continue;
                revisionsWithExplicitEffect.add(e.value.annotationId);
                const vIdx = versionIndexById(annotation, e.value.versionId);
                if (vIdx < 0) continue;
                const newVersions = annotation.versions.slice();
                // Preserve the version's id even if the incoming blob omits it
                // (nested-editor serialization carries doc/annotationField, not id).
                newVersions[vIdx] = { ...e.value.versionState, id: e.value.versionId };
                let selection = annotation.selection;
                if (annotation.activeVersionId === e.value.versionId && tr.docChanged) {
                    // Map the pre-change start with a left bias. A collapsed
                    // selection maps to the RIGHT edge of inserted text by
                    // default; growing it from that point produces an invalid
                    // range such as [2, 4] in a two-character document.
                    const oldAnnotation = oldAnnotations[e.value.annotationId];
                    const mappedFrom = oldAnnotation
                        ? tr.changes.mapPos(oldAnnotation.selection.main.from, -1)
                        : annotation.selection.main.from;
                    const from = Math.min(mappedFrom, tr.state.doc.length);
                    const text = versionText(e.value.versionState);
                    const to = Math.min(from + text.length, tr.state.doc.length);
                    selection = EditorSelection.single(from, to);
                }
                annotations[e.value.annotationId] = {
                    ...annotation,
                    versions: newVersions,
                    selection,
                };
            } else if (e.is(_updateRevisionVersionDoc)) {
                // Collab-mode: update ONLY the version's doc text without
                // affecting parent document or selection. The nested editor's
                // Y.Text is authoritative; this just keeps the annotation state
                // in sync for UI rendering and persistence.
                const annotation = annotations[e.value.annotationId];
                if (!annotation || !isAnnotationOfType(annotation, "revision")) continue;
                revisionsWithExplicitEffect.add(e.value.annotationId);
                const vIdx = versionIndexById(annotation, e.value.versionId);
                if (vIdx >= 0) {
                    const newVersions = annotation.versions.slice();
                    newVersions[vIdx] = { ...newVersions[vIdx], doc: e.value.doc };
                    annotations[e.value.annotationId] = {
                        ...annotation,
                        versions: newVersions,
                    };
                }
            } else if (e.is(addSuggestion)) {
                const cursor = new SearchCursor(tr.state.doc, e.value.targetText);
                for (const { from, to } of cursor) {
                    // Search through the document for the text
                    annotations[getNewId(annotations)] = {
                        ...createNewAnnotation(
                            annotations,
                            EditorSelection.single(from, to),
                            "suggestion",
                        ),
                        replacements: e.value.replacements,
                    };
                }
            } else if (e.is(_applySuggestion)) {
                delete annotations[e.value.annotationId];
            }
        }
        // Phase 3: pull active revision version text from the
        // document, but only for revisions that had no explicit effect
        // this transaction and only when the document actually changed.
        if (tr.docChanged) {
            // Collect all revision IDs that need boundary expansion.
            // This covers both the forward pass (nestedEditorEdit annotation)
            // and redo replays (_nestedEditRevision StateEffect stored in history).
            const nestedEditRevIds = new Set<number>();
            const nestedEditAnnotationId = tr.annotation(nestedEditorEdit);
            if (nestedEditAnnotationId !== undefined) {
                nestedEditRevIds.add(nestedEditAnnotationId);
            }
            for (const e of tr.effects) {
                if (e.is(_nestedEditRevision)) {
                    nestedEditRevIds.add(e.value);
                }
            }

            // Fix revision selection boundaries for nested editor edits (forward
            // pass and redo only). Phase 1 uses EditorSelection.map() which does
            // not expand non-collapsed ranges when text is inserted exactly at
            // their trailing boundary. We use mapPos(from,-1) / mapPos(to,+1)
            // to ensure the revision range absorbs content added at its edges.
            // Skip on undo when the undo is purely a deletion (undoing an
            // insertion): Phase 1 shrinks the range correctly, and expansion
            // bias would pin the boundary at the wrong position. But allow
            // expansion when the undo re-inserts text (undoing a deletion),
            // because Phase 1's selection.map() won't expand at boundaries.
            const isUndo = tr.isUserEvent("undo");
            let undoInsertsText = false;
            if (isUndo) {
                tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
                    if (inserted.length > 0) undoInsertsText = true;
                });
            }
            for (const revId of isUndo && !undoInsertsText ? [] : nestedEditRevIds) {
                const ann = annotations[revId];
                if (ann && isAnnotationOfType(ann, "revision")) {
                    const oldAnn = oldAnnotations[revId];
                    if (oldAnn) {
                        const from = tr.changes.mapPos(oldAnn.selection.main.from, -1);
                        const to = tr.changes.mapPos(oldAnn.selection.main.to, 1);
                        if (from !== ann.selection.main.from || to !== ann.selection.main.to) {
                            annotations[revId] = {
                                ...ann,
                                selection: EditorSelection.single(from, to),
                            };
                        }
                    }
                }
            }

            // NOTE: we intentionally do NOT skip Phase 3 for nestedEditorEdit.
            // Phase 3 pulls versions[selected].doc from the parent doc slice,
            // which is needed so that version switching shows current content.
            annotations = pushDocToVersionState(annotations, tr, revisionsWithExplicitEffect);
        }
        return annotations;
    },
    toJSON(value: Annotations) {
        return mapValues(value, (c) => ({
            ...c,
            selection: c.selection.toJSON(),
        }));
    },
    fromJSON(value: unknown) {
        if (value == null) return {} as Annotations;
        const result = RawAnnotationsSchema.safeParse(value);
        if (!result.success) {
            console.warn(
                "[annotationField] fromJSON: persisted annotation data failed validation,",
                "starting with an empty annotation map.",
                result.error.flatten(),
            );
            return {} as Annotations;
        }
        return mapValues(result.data, (x) => {
            const withSelection = {
                ...x,
                selection: EditorSelection.fromJSON(x.selection),
            };
            // Heal legacy revisions (no version ids / activeVersionIndex) into the
            // stable-id shape. Idempotent for already-migrated data.
            if (isAnnotationOfType(withSelection as GenericAnnotation, "revision")) {
                return normalizeRevision(withSelection as never);
            }
            return withSelection;
        }) as Annotations;
    },
});
export const invertedAnnotationFieldEffects = invertedEffects.of((transaction: Transaction) => {
    const effects = [];
    const oldAnnotations = transaction.startState.field(annotationField);

    // Skip transactions that opted out of history (addToHistory.of(false)).
    // These don't create a new undo entry, so any inverted effects we
    // generate would get merged into the *previous* undo entry and corrupt
    // its replay. This covers:
    //   - Cleanup transactions from collapsedRevisionResolver
    //   - Modal flush dispatches (flushToParent)
    //   - Any other internal bookkeeping dispatches
    if (transaction.annotation(Transaction.addToHistory) === false) return [];
    if (transaction.annotation(_revisionCleanup)) return [];

    const undoChanges = transaction.changes.invert(transaction.startState.doc);
    const restoreAnnotation = (annotation: GenericAnnotation) =>
        _restoreAnnotation.of({ annotation, undoChanges });

    // Detect annotations implicitly affected by remapAnnotationSelections (phase 1)
    // or pushDocToVersionState (phase 3). These have no explicit effect, so
    // invertedEffects would never see them.
    //
    // Default selection mapping is not invertible when a deletion consumes an
    // annotation boundary. For example, [1,5] -> delete [0,3] produces [0,2],
    // but undo maps that to [3,5] instead of [1,5]. Store the exact annotation
    // snapshot whenever its range or active revision text changed. On undo the
    // restore effect overwrites the mapped annotation; inversion of that restore
    // captures the post-edit snapshot for redo.
    // Skip undo/redo replays (they already carry stored effects). Revision and
    // nested-edit builders manage their target IDs explicitly, but unrelated
    // annotations still need snapshots when the replacement remaps them.
    const isUndoRedo = transaction.isUserEvent("undo") || transaction.isUserEvent("redo");
    if (transaction.docChanged && !isUndoRedo) {
        const newAnnotations = transaction.state.field(annotationField);
        const nestedTargetIds = nestedRevisionTargetIds(transaction);
        const explicitlyManagedAnnotationIds = new Set(nestedTargetIds);
        for (const effect of transaction.effects) {
            if (effect.is(addAnnotation) || effect.is(removeAnnotation)) {
                explicitlyManagedAnnotationIds.add(effect.value.id);
            } else if (
                effect.is(_addVersionToRevision) ||
                effect.is(_deleteVersionFromRevision) ||
                effect.is(_updateActiveRevisionVersion) ||
                effect.is(_updateRevisionVersionState) ||
                effect.is(_updateRevisionVersionDoc)
            ) {
                explicitlyManagedAnnotationIds.add(effect.value.annotationId);
            }
        }
        for (const annotation of Object.values(oldAnnotations)) {
            // Revision builders carry exact inverses for their own target. We
            // still snapshot every OTHER annotation remapped by their doc
            // replacement (adjacent collapsed revisions are especially lossy).
            if (explicitlyManagedAnnotationIds.has(annotation.id)) continue;
            const updated = newAnnotations[annotation.id];
            const selectionChanged = !updated || !updated.selection.eq(annotation.selection);
            let mappingLosesInformation = false;
            if (updated) {
                try {
                    const assoc = annotationMappingAssociation(
                        annotation,
                        oldAnnotations,
                        transaction,
                    );
                    const mapped = annotation.selection.map(transaction.changes, assoc);
                    const roundTrip = mapped.map(transaction.changes.invertedDesc, assoc);
                    mappingLosesInformation = !roundTrip.eq(annotation.selection);
                } catch {
                    mappingLosesInformation = true;
                }
            }
            const activeRevisionTextChanged =
                updated &&
                isAnnotationOfType(annotation, "revision") &&
                isAnnotationOfType(updated, "revision") &&
                versionText(updated.versions[activeVersionIndex(updated)]) !==
                    versionText(annotation.versions[activeVersionIndex(annotation)]);
            // A collapsed sibling touching a nested target's boundary may map
            // correctly on the forward edit but lose its predecessor/follower
            // side when undo sees the now-collapsed target. Preserve it exactly.
            const touchesNestedTargetBoundary =
                isAnnotationOfType(annotation, "revision") &&
                annotation.selection.main.empty &&
                [...nestedTargetIds].some((targetId) => {
                    const target = oldAnnotations[targetId];
                    if (!target || !isAnnotationOfType(target, "revision")) return false;
                    const position = annotation.selection.main.from;
                    return (
                        !target.selection.main.empty &&
                        (position === target.selection.main.from ||
                            position === target.selection.main.to)
                    );
                });
            if (
                selectionChanged ||
                mappingLosesInformation ||
                activeRevisionTextChanged ||
                touchesNestedTargetBoundary
            ) {
                effects.push(restoreAnnotation(annotation));
            }
        }
    }

    for (const effect of transaction.effects) {
        if (effect.is(addAnnotation)) {
            effects.push(
                transaction.docChanged
                    ? _removeAnnotationById.of(effect.value.id)
                    : removeAnnotation.of(effect.value),
            );
        } else if (effect.is(_restoreAnnotation)) {
            const replacedAnnotation = oldAnnotations[effect.value.annotation.id];
            if (replacedAnnotation) {
                // The restore overwrote an annotation that survived the edit.
                // Put that exact post-edit snapshot back on redo.
                effects.push(restoreAnnotation(replacedAnnotation));
            } else {
                // The original edit dropped the annotation entirely.
                effects.push(_removeAnnotationById.of(effect.value.annotation.id));
            }
        } else if (effect.is(_removeAnnotationById)) {
            const removedAnnotation = oldAnnotations[effect.value];
            if (removedAnnotation) effects.push(restoreAnnotation(removedAnnotation));
        } else if (effect.is(removeAnnotation)) {
            const removedAnnotation = oldAnnotations[effect.value.id] ?? effect.value;
            effects.push(
                transaction.docChanged
                    ? restoreAnnotation(removedAnnotation)
                    : addAnnotation.of(removedAnnotation),
            );
        } else if (effect.is(updateThread)) {
            const oldAnnotation = oldAnnotations[effect.value.annotationId];
            if (!oldAnnotation) continue;
            // A first message closes a pending COMMENT. Undo intentionally
            // removes that draft comment instead of restoring an empty card.
            // Revisions and suggestions may also start with empty threads, but
            // their first message must never delete the entire annotation.
            if (isAnnotationOfType(oldAnnotation, "comment") && oldAnnotation.thread.length === 0) {
                const updatedAnnotation =
                    transaction.state.field(annotationField)[oldAnnotation.id];
                if (updatedAnnotation) {
                    // Carry the post-update annotation so redo restores the
                    // message, not the old empty pending comment.
                    effects.push(removeAnnotation.of(updatedAnnotation));
                }
            } else {
                effects.push(
                    updateThread.of({
                        ...effect.value,
                        newThread: oldAnnotation.thread,
                    }),
                );
            }
        } else if (effect.is(addSuggestion)) {
            const newAnnotations = transaction.state.field(annotationField);
            const oldKeys = new Set(Object.keys(oldAnnotations).map(Number));
            for (const [idStr, ann] of Object.entries(newAnnotations)) {
                if (!oldKeys.has(Number(idStr)) && isAnnotationOfType(ann, "suggestion")) {
                    effects.push(removeAnnotation.of(ann));
                }
            }
        } else if (
            effect.is(_addVersionToRevision) ||
            effect.is(_deleteVersionFromRevision) ||
            effect.is(_updateActiveRevisionVersion)
        ) {
            const oldAnnotation = oldAnnotations[effect.value.annotationId];
            if (!oldAnnotation || !isAnnotationOfType(oldAnnotation, "revision")) continue;
            if (effect.is(_addVersionToRevision)) {
                // Inverse of add = delete the just-added version, identified by its
                // stable id (so position shifts can't target the wrong slot).
                effects.push(
                    _deleteVersionFromRevision.of({
                        annotationId: oldAnnotation.id,
                        versionId: effect.value.newVersion.id,
                    }),
                );
                if (effect.value.makeActive ?? true) {
                    // Adding a version normally activates it and replaces the
                    // parent range. On undo, Phase 1 maps an empty version's
                    // collapsed range to the right edge of the restored text.
                    // Re-applying the old active id rebuilds the selection from
                    // the left edge and the restored version's exact length.
                    effects.push(
                        _updateActiveRevisionVersion.of({
                            annotationId: oldAnnotation.id,
                            to: oldAnnotation.activeVersionId,
                        }),
                    );
                }
            } else if (effect.is(_deleteVersionFromRevision)) {
                // Inverse of delete = re-add the deleted version at its old slot.
                const oldIndex = versionIndexById(oldAnnotation, effect.value.versionId);
                const oldVersion = versionById(oldAnnotation, effect.value.versionId);
                if (oldVersion) {
                    // Only re-activate the restored version if it WAS active when
                    // deleted. Re-inserting a non-active version must not steal the
                    // active pointer — undo restores prior state, it doesn't move
                    // focus (issue #270). The active-delete case is already covered
                    // by the paired _updateActiveRevisionVersion inverse below, but
                    // setting the flag here keeps the add-inverse self-consistent.
                    const wasActive = effect.value.versionId === oldAnnotation.activeVersionId;
                    effects.push(
                        _addVersionToRevision.of({
                            annotationId: oldAnnotation.id,
                            newVersion: oldVersion,
                            at: oldIndex < 0 ? undefined : oldIndex,
                            makeActive: wasActive,
                        }),
                    );
                }
            } else if (effect.is(_updateActiveRevisionVersion)) {
                effects.push(
                    _updateActiveRevisionVersion.of({
                        annotationId: oldAnnotation.id,
                        to: oldAnnotation.activeVersionId,
                    }),
                );
            }
        } else if (effect.is(_updateRevisionVersionState)) {
            const oldAnnotation = oldAnnotations[effect.value.annotationId];
            if (!oldAnnotation || !isAnnotationOfType(oldAnnotation, "revision")) continue;
            const oldVersion = versionById(oldAnnotation, effect.value.versionId);
            if (!oldVersion) continue;
            effects.push(
                _updateRevisionVersionState.of({
                    annotationId: oldAnnotation.id,
                    versionId: effect.value.versionId,
                    versionState: oldVersion,
                }),
            );
        } else if (effect.is(_updateRevisionVersionLabel)) {
            const oldAnnotation = oldAnnotations[effect.value.annotationId];
            if (!oldAnnotation || !isAnnotationOfType(oldAnnotation, "revision")) continue;
            effects.push(
                _updateRevisionVersionLabel.of({
                    annotationId: oldAnnotation.id,
                    versionId: effect.value.versionId,
                    label: versionById(oldAnnotation, effect.value.versionId)?.label,
                }),
            );
        } else if (effect.is(_applySuggestion)) {
            const annotations = transaction.startState.field(annotationField);
            const ann = annotations[effect.value.annotationId];
            if (!ann) continue;
            effects.push(addAnnotation.of(ann));
        } else if (effect.is(_nestedEditRevision)) {
            // _nestedEditRevision is its own inverse: on undo the stored effect
            // would be the forward one, but undo doesn't need range expansion
            // (Phase 1 shrinks correctly). We still emit the inverse so that
            // if the undo itself is redone, redo sees the effect and expands.
            effects.push(_nestedEditRevision.of(effect.value));
        }
    }
    return effects;
});
