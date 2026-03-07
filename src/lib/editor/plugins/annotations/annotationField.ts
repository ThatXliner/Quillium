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
 *     suggestion application).
 *   - Exports transaction-builder functions (e.g.
 *     setActiveRevisionVersion, createNewRevision) that
 *     bundle effects + doc changes into atomic updates.
 *   - Provides undo/redo support via invertedEffects.
 *
 * State lifecycle:
 *   - Created as an empty map `[]`.
 *   - On every transaction, the reducer:
 *     1. Remaps all annotation selections through doc changes.
 *     2. Processes effects (add/remove/update).
 *     3. Syncs active revision version text with the document.
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

import {
  Annotation,
  EditorSelection,
  type EditorState,
  SelectionRange,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  createNewAnnotation,
  getLastId,
  getNewId,
  isAnnotationOfType,
  versionText,
  type Annotations,
  type GenericAnnotation,
  type RawAnnotations,
  type SuggestionReplacement,
  type Thread,
  type VersionState,
} from "./models";
import { cleanRangesOf, mapRange } from "./utils";
import { invertedEffects } from "@codemirror/commands";
import { SearchCursor } from "@codemirror/search";
import { filter, mapValues } from "lodash-es";
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

// lowk I might change this to our own state machine so we can have that sweet sweet typesafety
// === For all annotations ===
export const addAnnotation = StateEffect.define<GenericAnnotation>({
  map: mapRange,
});
// The reason why we store the whole annotation here instead
// of just the ID? I haven't tested getting the previous
// state ala .startState yet...
export const removeAnnotation = StateEffect.define<GenericAnnotation>({
  map: mapRange,
});
// Mutations on annotations
// Why we separate actions instead of having a single updateAnnotation or
// mutateAnnotation? This makes the logic to implement undo/redo easier.
// significantly easier (instead of needing to sniff/track the old state)
// To be fair though, it is a little repetitive... I can't think of
// a better way to do it for now. I guess it's good to have your states explicit...
// Lowk what if we just had our own FSM and states instead of using StateEffect...

// TODO: figure if delete can just need ID or not
// === Generic annotation thread management ===
export const updateThread = StateEffect.define<{
  annotationId: number;
  newThread: Thread;
}>();
export const allowRevisionDocEdit = Annotation.define<boolean>();
// export const addThreadToAnnotation = StateEffect.define<{
// 	annotationId: number;
// 	threadMessage: ThreadMessage;
// }>();
// export const deleteThreadFromAnnotation = StateEffect.define<{
// 	annotationId: number;
// 	threadMessageId: number;
// }>();
// export const updateThreadMessage = StateEffect.define<{
// 	annotationId: number;
// 	threadMessageId: number;
// 	newThreadMessage: ThreadMessage;
// }>();
// === For revisions ===
// These also updates the active revision version to the latest one
// There is no "updateRevisionVersion" since we sniff that from document changes
const _addVersionToRevision = StateEffect.define<{
  annotationId: number;
  newVersion: VersionState;
  at?: number;
}>();
const _deleteVersionFromRevision = StateEffect.define<{
  annotationId: number;
  versionId: number;
}>();
const _updateActiveRevisionVersion = StateEffect.define<{
  annotationId: number;
  to: number;
}>();
const _updateRevisionVersionState = StateEffect.define<{
  annotationId: number;
  versionId: number;
  versionState: VersionState;
}>();
export function setActiveRevisionVersion(
  state: EditorState,
  annotationId: number,
  to: number,
) {
  const original = state.field(annotationField)[annotationId];
  if (!isAnnotationOfType(original, "revision")) {
    throw new Error("Annotation is not a revision");
  }
  return state.update({
    effects: [
      _updateActiveRevisionVersion.of({
        annotationId,
        to,
      }),
    ],
    annotations: [
      allowRevisionDocEdit.of(true),
      Transaction.addToHistory.of(true),
    ],
    changes: state.changes({
      from: original.selection.main.from,
      to: original.selection.main.to,
      insert: versionText(original.versions[to]),
    }),
  });
}
export function createNewRevision(state: EditorState, annotationId: number) {
  const original = state.field(annotationField)[annotationId];
  if (!isAnnotationOfType(original, "revision")) {
    throw new Error("Annotation is not a revision");
  }
  const placeholder = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
  const newVersionState: VersionState = { doc: placeholder };
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
    annotations: [
      allowRevisionDocEdit.of(true),
      Transaction.addToHistory.of(true),
    ],
  });
}
export function deleteRevisionVersion(
  state: EditorState,
  annotationId: number,
  versionId: number,
) {
  const original = state.field(annotationField)[annotationId];
  if (!isAnnotationOfType(original, "revision")) {
    throw new Error("Annotation is not a revision");
  }
  if (versionId < 0 || versionId >= original.versions.length) {
    return state.update({});
  }

  // Deleting the last remaining version deletes the whole revision atom.
  if (original.versions.length === 1) {
    return state.update({
      effects: [removeAnnotation.of(original)],
      annotations: [
        allowRevisionDocEdit.of(true),
        Transaction.addToHistory.of(true),
      ],
      changes: state.changes({
        from: original.selection.main.from,
        to: original.selection.main.to,
        insert: "",
      }),
    });
  }

  const nextVersions = original.versions.filter((_, i) => i !== versionId);
  let nextSelected = original.currentlySelected;
  if (versionId < original.currentlySelected) {
    nextSelected = original.currentlySelected - 1;
  } else if (versionId === original.currentlySelected) {
    nextSelected = Math.min(versionId, nextVersions.length - 1);
  }

  const effects: StateEffect<unknown>[] = [
    _deleteVersionFromRevision.of({
      annotationId,
      versionId,
    }),
  ];
  if (nextSelected !== original.currentlySelected) {
    effects.push(
      _updateActiveRevisionVersion.of({
        annotationId,
        to: nextSelected,
      }),
    );
  }

  const annotations = [
    allowRevisionDocEdit.of(true),
    Transaction.addToHistory.of(true),
  ];
  if (versionId === original.currentlySelected) {
    return state.update({
      effects,
      annotations,
      changes: state.changes({
        from: original.selection.main.from,
        to: original.selection.main.to,
        insert: nextVersions[nextSelected] ? versionText(nextVersions[nextSelected]) : "",
      }),
    });
  }
  return state.update({
    effects,
    annotations,
  });
}
export function updateRevisionVersionState(
  state: EditorState,
  annotationId: number,
  versionId: number,
  newVersionState: VersionState,
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
    allowRevisionDocEdit.of(true),
    Transaction.addToHistory.of(true),
  ];
  if (original.currentlySelected !== versionId) {
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
export function branchSuggestion(state: EditorState, annotationId: number) {
    const annotation = state.field(annotationField)[annotationId];
    if (!isAnnotationOfType(annotation, "suggestion")) {
        throw new Error("Annotation is not a suggestion");
    }
    const { from, to } = annotation.selection.main;
    const originalText = state.doc.sliceString(from, to);

    const versions: VersionState[] = [
        { doc: originalText },
        ...annotation.replacements.map((r) => ({ doc: r.text } as VersionState)),
    ];

    const firstReplacement = annotation.replacements[0]?.text ?? originalText;

    const newRevision = {
        ...createNewAnnotation(
            state.field(annotationField),
            EditorSelection.single(from, from + firstReplacement.length),
            "revision",
        ),
        currentlySelected: 1,
        versions,
        thread: annotation.thread,
    };

    return state.update({
        effects: [
            removeAnnotation.of(annotation),
            addAnnotation.of(newRevision),
        ],
        changes: state.changes({ from, to, insert: firstReplacement }),
        annotations: [
            allowRevisionDocEdit.of(true),
            Transaction.addToHistory.of(true),
        ],
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
const _applySuggestion = StateEffect.define<{
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
//   3. syncRevisionDocsWithDocument — when no explicit
//      revision effect fired, copy the document slice
//      under each active revision back into its version
//      state so the stored text stays current.
//
// Triggers: any transaction (doc changes, effects, or both).
// Downstream: Svelte stores sync via Editor.svelte's
// updateListener; decoration plugins read this field to
// render highlights.
// -------------------------------------------------------

// TODO: when a comment gets deleted by a deletion action, track that too so we can later undo it

/**
 * Phase 1: Remap all annotation selections through the
 * transaction's change set. Removes annotations whose
 * ranges were fully consumed (collapsed to zero width),
 * except revisions which are kept alive via allowEmpty.
 */
function remapAnnotationSelections(
    annotations: Annotations,
    tr: Transaction,
): Annotations {
    return Object.fromEntries(
        filter(
            Object.entries(
                mapValues(annotations, (x) => {
                    const isRevision =
                        isAnnotationOfType(x, "revision");
                    const newSelection = cleanRangesOf(
                        x.selection.map(
                            tr.changes,
                            isRevision ? 1 : 0,
                        ),
                        isRevision,
                    );
                    if (newSelection) {
                        return { ...x, selection: newSelection };
                    }
                    return null;
                }),
            ),
            ([k, v]) => v !== null,
        ),
    ) as Annotations;
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
): void {
    if (!isAnnotationOfType(annotation, "revision")) return;

    if (e.is(_addVersionToRevision)) {
        const insertionIndex = Math.max(
            0,
            Math.min(
                e.value.at ?? annotation.versions.length,
                annotation.versions.length,
            ),
        );
        annotation.versions.splice(
            insertionIndex,
            0,
            e.value.newVersion,
        );
        annotation.currentlySelected = insertionIndex;
    } else if (e.is(_deleteVersionFromRevision)) {
        annotation.versions.splice(e.value.versionId, 1);
        if (e.value.versionId < annotation.currentlySelected) {
            annotation.currentlySelected -= 1;
        } else if (
            annotation.currentlySelected >=
            annotation.versions.length
        ) {
            annotation.currentlySelected = Math.max(
                0,
                annotation.versions.length - 1,
            );
        }
    } else if (e.is(_updateActiveRevisionVersion)) {
        annotation.currentlySelected = e.value.to;
        // When switching versions, reconstruct the selection
        // to cover the inserted text. This is critical for
        // collapsed ranges (all text was deleted) where
        // selection.map() keeps the range collapsed instead
        // of expanding around the newly inserted version
        // text.
        const oldAnnotation =
            oldAnnotations[e.value.annotationId];
        if (oldAnnotation) {
            const from = tr.changes.mapPos(
                oldAnnotation.selection.main.from,
                -1,
            );
            const vText = versionText(
                annotation.versions[e.value.to] ?? { doc: "" },
            );
            const to = from + vText.length;
            annotation.selection = EditorSelection.single(
                from,
                to,
            );
        }
    }
}

/**
 * Phase 3: For revisions not touched by an explicit effect,
 * sync the active version's doc text with the actual document
 * content under the revision's range.
 *
 * @param skipIds - revision IDs that had an explicit effect this
 *   transaction and should not be synced here.
 */
function syncRevisionDocsWithDocument(
    annotations: Annotations,
    tr: Transaction,
    skipIds: Set<number> = new Set(),
): Annotations {
    return mapValues(annotations, (x) => {
        if (isAnnotationOfType(x, "revision") && !skipIds.has(x.id)) {
            const text = tr.state.doc
                .slice(
                    x.selection.main.from,
                    x.selection.main.to,
                )
                .toString();
            x.versions[x.currentlySelected] = {
                ...x.versions[x.currentlySelected],
                doc: text,
            };
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
    let annotations = remapAnnotationSelections(
        oldAnnotations,
        tr,
    );

    // Phase 2: apply effects
    // todo: check if deletion is killing an annotation as well as .is(removeAnnotation)
    // Track which revision IDs had an explicit effect so Phase 3
    // can skip syncing only those revisions (not all of them).
    const revisionsWithExplicitEffect = new Set<number>();
    for (const e of tr.effects) {
      if (e.is(addAnnotation)) {
        console.log("Adding annotation!", e.value);
        // TODO: what if we just annotations.push
        annotations[e.value.id] = e.value;
      } else if (e.is(removeAnnotation)) {
        console.log("Removing annotation internally");
        delete annotations[e.value.id];
        console.log(annotations);
      } else if (e.is(updateThread)) {
        annotations[e.value.annotationId].thread = e.value.newThread;
        // } else if (e.is(addThreadToAnnotation)) {
        //   annotations[e.value.annotationId].thread.push(e.value.threadMessage);
        // } else if (e.is(deleteThreadFromAnnotation)) {
        //   annotations[e.value.annotationId].thread.splice(
        //     e.value.threadMessageId,
        //     1,
        //   );
        // } else if (e.is(updateThreadMessage)) {
        //   annotations[e.value.annotationId].thread[e.value.threadMessageId] =
        //     e.value.newThreadMessage;
      } else if (
        e.is(_addVersionToRevision) ||
        e.is(_deleteVersionFromRevision) ||
        e.is(_updateActiveRevisionVersion)
      ) {
        const annotation = annotations[e.value.annotationId];
        if (!isAnnotationOfType(annotation, "revision")) continue;
        revisionsWithExplicitEffect.add(e.value.annotationId);
        applyRevisionVersionEffect(
            e,
            annotation,
            oldAnnotations,
            tr,
        );

        // well uh i think this is unnecessary since
        // JavaScript would give annotation a reference to the annotation object
        // but just in case, you know.
        annotations[e.value.annotationId] = annotation;
      } else if (e.is(_updateRevisionVersionState)) {
        const annotation = annotations[e.value.annotationId];
        if (!isAnnotationOfType(annotation, "revision")) continue;
        revisionsWithExplicitEffect.add(e.value.annotationId);
        annotation.versions[e.value.versionId] = e.value.versionState;
        if (
          annotation.currentlySelected === e.value.versionId &&
          tr.docChanged
        ) {
          const oldAnnotation = oldAnnotations[e.value.annotationId];
          if (oldAnnotation) {
            const from = tr.changes.mapPos(
              oldAnnotation.selection.main.from,
              -1,
            );
            const text = versionText(e.value.versionState);
            const to = from + text.length;
            annotation.selection = EditorSelection.single(from, to);
          }
        }
        annotations[e.value.annotationId] = annotation;
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
    // Phase 3: keep active revision version text in sync with the
    // document, but only for revisions that had no explicit effect
    // this transaction and only when the document actually changed.
    if (tr.docChanged) {
      annotations = syncRevisionDocsWithDocument(
          annotations,
          tr,
          revisionsWithExplicitEffect,
      );
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
    // TODO: use Zod to verify?
    return mapValues(value as RawAnnotations, (x) => ({
      ...x,
      selection: EditorSelection.fromJSON(x.selection),
    }));
  },
});
export const invertedAnnotationFieldEffects = invertedEffects.of(
  (transaction: Transaction) => {
    const effects = [];
    const oldAnnotations = transaction.startState.field(annotationField);
    for (const effect of transaction.effects) {
      if (effect.is(addAnnotation)) {
        effects.push(removeAnnotation.of(effect.value));
      } else if (effect.is(removeAnnotation)) {
        effects.push(addAnnotation.of(effect.value));
      } else if (effect.is(updateThread)) {
        const oldAnnotation = oldAnnotations[effect.value.annotationId];
        // Was a comment in the "pending" state
        if (oldAnnotation.thread.length == 0) {
          effects.push(removeAnnotation.of(oldAnnotation));
        } else {
          effects.push(
            updateThread.of({
              ...effect.value,
              newThread: oldAnnotation.thread,
            }),
          );
        }
      } else if (effect.is(addSuggestion)) {
        const oldAnnotation =
          oldAnnotations[Math.max(...Object.keys(oldAnnotations).map(Number))];
        effects.push(removeAnnotation.of(oldAnnotation));
      } else if (
        effect.is(_addVersionToRevision) ||
        effect.is(_deleteVersionFromRevision) ||
        effect.is(_updateActiveRevisionVersion)
      ) {
        const oldAnnotation = oldAnnotations[effect.value.annotationId];
        if (!isAnnotationOfType(oldAnnotation, "revision")) continue;
        if (effect.is(_addVersionToRevision)) {
          effects.push(
            _deleteVersionFromRevision.of({
              annotationId: oldAnnotation.id,
              versionId: effect.value.at ?? oldAnnotation.versions.length,
            }),
          );
        } else if (effect.is(_deleteVersionFromRevision)) {
          effects.push(
            _addVersionToRevision.of({
              annotationId: oldAnnotation.id,
              newVersion: oldAnnotation.versions[effect.value.versionId],
              at: effect.value.versionId,
            }),
          );
        } else if (effect.is(_updateActiveRevisionVersion)) {
          effects.push(
            _updateActiveRevisionVersion.of({
              annotationId: oldAnnotation.id,
              to: oldAnnotation.currentlySelected,
            }),
          );
        }
      } else if (effect.is(_updateRevisionVersionState)) {
        const oldAnnotation = oldAnnotations[effect.value.annotationId];
        if (!isAnnotationOfType(oldAnnotation, "revision")) continue;
        effects.push(
          _updateRevisionVersionState.of({
            annotationId: oldAnnotation.id,
            versionId: effect.value.versionId,
            versionState: oldAnnotation.versions[effect.value.versionId],
          }),
        );
      } else if (effect.is(addSuggestion)) {
        const annotations = transaction.startState.field(annotationField);
        effects.push(removeAnnotation.of(annotations[getLastId(annotations)]));
      } else if (effect.is(_applySuggestion)) {
        const annotations = transaction.startState.field(annotationField);
        effects.push(addAnnotation.of(annotations[effect.value.annotationId]));
      }
    }
    // transaction.changes.iterChangedRanges((chFrom, chTo) => {
    //   oldAnnotations.forEach((oldAnnotation) => {
    //     // TODO: support multiple selections???
    //     // what about partial comment deletion... is that ok?
    //     let { from: rFrom, to: rTo } = oldAnnotation.selection.main;
    //     let from = Math.max(chFrom, rFrom),
    //       to = Math.min(chTo, rTo);
    //     if (from < to) {
    //       effects.push(
    //         addAnnotation.of(
    //           oldAnnotation.selection.replaceRange({ from, to }),
    //         ),
    //       );
    //     }
    //   });
    // });
    return effects;
  },
);
