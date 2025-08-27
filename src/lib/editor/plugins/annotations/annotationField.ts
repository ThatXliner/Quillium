import {
  EditorSelection,
  EditorState,
  SelectionRange,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  createNewAnnotation,
  isAnnotationOfType,
  type Annotations,
  type GenericAnnotation,
  type RawAnnotations,
  type Thread,
} from "./models";
import { cleanRangesOf, mapRange } from "./utils";
import { invertedEffects } from "@codemirror/commands";
import { SearchCursor } from "@codemirror/search";
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
  newVersion: string;
}>();
const _deleteVersionFromRevision = StateEffect.define<{
  annotationId: number;
  versionId: number;
}>();
const _updateActiveRevisionVersion = StateEffect.define<{
  annotationId: number;
  to: number;
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
    changes: state.changes({
      from: original.selection.main.from,
      to: original.selection.main.to,
      insert: original.versions[to],
    }),
  });
}
export function createNewRevision(state: EditorState, annotationId: number) {
  const original = state.field(annotationField)[annotationId];
  if (!isAnnotationOfType(original, "revision")) {
    throw new Error("Annotation is not a revision");
  }
  return state.update({
    effects: [
      _addVersionToRevision.of({
        annotationId,
        newVersion: "Lorem Ipsum",
      }),
    ],
    changes: state.changes({
      from: original.selection.main.from,
      to: original.selection.main.to,
      insert: "Lorem Ipsum",
    }),
  });
}
// === For suggestions ===
export const addSuggestion = StateEffect.define<{
  targetText: string;
  replacements: string[];
}>();

// StateField to track annotation data
// TODO: when a comment gets deleted by a deletion action, track that too so we can later undo it
export const annotationField = StateField.define<Annotations>({
  create(): Annotations {
    return [];
  },
  update(oldAnnotations: Annotations, tr: Transaction): Annotations {
    let annotations = oldAnnotations;

    // Map our old annotations to the new state
    // ranges, as we don't want our revision/highlighted/etc
    // to be static markers of a row and column but instead change with the
    // document
    annotations = annotations
      .map((x) => {
        // Run it through deletions
        const newSelection = cleanRangesOf(
          x.selection.map(
            tr.changes,
            isAnnotationOfType(x, "revision") ? 1 : 0,
          ),
        );

        // Idk how adding to the end of a revision version should work
        // which is why this code is currently commented out
        // if (x.value.type === "revision") {
        // 	newSelection = newSelection.addRange(
        // 		newSelection.main.extend(
        // 			newSelection.main.from,
        // 			newSelection.main.to,
        // 		),
        // 	);
        // }
        if (newSelection) {
          return { ...x, selection: newSelection };
        }
        return null;
      })
      .filter((x) => x !== null);

    // todo: check if deletion is killing an annotation as well as .is(removeAnnotation)
    let doUpdateRevision = true;
    for (const e of tr.effects) {
      if (e.is(addAnnotation)) {
        console.log("Adding annotation!", e.value);
        // TODO: what if we just annotations.push
        annotations[e.value.id] = e.value;
      } else if (e.is(removeAnnotation)) {
        annotations = annotations.splice(e.value.id, 1);
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
        let annotation = annotations[e.value.annotationId];
        if (!isAnnotationOfType(annotation, "revision")) continue;
        doUpdateRevision = false;
        if (e.is(_addVersionToRevision)) {
          annotation.versions.push(e.value.newVersion);
          annotation.currentlySelected = annotation.versions.length - 1;
        } else if (e.is(_deleteVersionFromRevision)) {
          annotation.versions.splice(e.value.versionId, 1);
          if (annotation.currentlySelected === e.value.versionId) {
            annotation.currentlySelected = Math.max(0, e.value.versionId - 1);
          }
        } else if (e.is(_updateActiveRevisionVersion)) {
          annotation.currentlySelected = e.value.to;
        }

        // well uh i think this is unnecessary since
        // JavaScript would give annotation a reference to the annotation object
        // but just in case, you know.
        annotations[e.value.annotationId] = annotation;
      } else if (e.is(addSuggestion)) {
        const cursor = new SearchCursor(tr.state.doc, e.value.targetText);
        for (const { from, to } of cursor) {
          // Search through the document for the text
          annotations.push({
            ...createNewAnnotation(
              annotations,
              EditorSelection.single(from, to),
              "suggestion",
            ),
            replacements: e.value.replacements,
          });
        }
      }
    }
    // doc -> revision
    if (doUpdateRevision) {
      // TODO: run on every character update?
      annotations = annotations.map((x) => {
        if (isAnnotationOfType(x, "revision")) {
          // the revision version's associated internal text needs to be updated
          x.versions[x.currentlySelected] = tr.state.doc
            .slice(x.selection.main.from, x.selection.main.to)
            // TODO: maybe even include comments!??
            .toString();
        }
        return x;
      });
    }
    return annotations;
  },
  toJSON(value: Annotations) {
    return value.map((c) => ({
      ...c,
      selection: c.selection.toJSON(),
    }));
  },
  fromJSON(value: unknown) {
    // TODO: use Zod to verify?
    return (value as RawAnnotations).map((x) => ({
      ...x,
      selection: EditorSelection.fromJSON(x.selection),
    }));
  },
});
export const invertedAnnotationFieldEffects = invertedEffects.of(
  (transaction: Transaction) => {
    let effects = [];
    const oldAnnotations = transaction.startState.field(annotationField);
    for (const effect of transaction.effects) {
      if (effect.is(addAnnotation)) {
        effects.push(removeAnnotation.of(effect.value));
      } else if (effect.is(removeAnnotation)) {
        effects.push(addAnnotation.of(effect.value));
      } else if (effect.is(updateThread)) {
        let oldAnnotation = oldAnnotations[effect.value.annotationId];
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
        let oldAnnotation = oldAnnotations[oldAnnotations.length - 1];
        effects.push(removeAnnotation.of(oldAnnotation));
      } else if (
        effect.is(_addVersionToRevision) ||
        effect.is(_deleteVersionFromRevision) ||
        effect.is(_updateActiveRevisionVersion)
      ) {
        let oldAnnotation = oldAnnotations[effect.value.annotationId];
        if (!isAnnotationOfType(oldAnnotation, "revision")) continue;
        if (effect.is(_addVersionToRevision)) {
          effects.push(
            _deleteVersionFromRevision.of({
              annotationId: oldAnnotation.id,
              versionId: oldAnnotation.versions.length - 1,
            }),
          );
        } else if (effect.is(_deleteVersionFromRevision)) {
          effects.push(
            _addVersionToRevision.of({
              annotationId: oldAnnotation.id,
              newVersion: oldAnnotation.versions[effect.value.versionId],
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
