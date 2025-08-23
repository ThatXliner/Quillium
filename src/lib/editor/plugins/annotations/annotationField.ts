import {
  EditorSelection,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  isAnnotationOfType,
  type Annotations,
  type GenericAnnotation,
  type RawAnnotations,
  type ThreadMessage,
} from "./models";
import { cleanRangesOf } from "./utils";
// === For all annotations ===
export const addAnnotation = StateEffect.define<GenericAnnotation>();
// The reason why we store the whole annotation here instead
// of just the ID? I haven't tested getting the previous
// state ala .startState yet...
export const removeAnnotation = StateEffect.define<GenericAnnotation>();
// Mutations on annotations
// Why we separate actions instead of having a single updateAnnotation or
// mutateAnnotation? This makes the logic to implement undo/redo easier.
// significantly easier (instead of needing to sniff/track the old state)
// To be fair though, it is a little repetitive... I can't think of
// a better way to do it for now. I guess it's good to have your states explicit...
// Lowk what if we just had our own FSM and states instead of using StateEffect...

// TODO: figure if delete can just need ID or not
// === Generic annotation thread management ===
export const addThreadToAnnotation = StateEffect.define<{
  annotationId: number;
  threadMessage: ThreadMessage;
}>();
export const deleteThreadFromAnnotation = StateEffect.define<{
  annotationId: number;
  threadMessageId: number;
}>();
export const updateThreadMessage = StateEffect.define<{
  annotationId: number;
  threadMessageId: number;
  newThreadMessage: ThreadMessage;
}>();
// === For revisions ===
// These also updates the active revision version to the latest one
export const addVersionToRevision = StateEffect.define<{
  annotationId: number;
  newVersion: string;
}>();
export const deleteVersionFromRevision = StateEffect.define<{
  annotationId: number;
  versionId: number;
}>();
export const updateActiveRevisionVersion = StateEffect.define<{
  annotationId: number;
  versionId: number;
}>();
// There is no "updateRevisionVersion" since we sniff that from document changes
// TODO: do stuff for suggestions?

// StateField to track annotation data
// TODO: when a comment gets deleted by a deletion action, track that too so we can later undo it
export const annotationField = StateField.define<Annotations>({
  create(): Annotations {
    return [];
  },
  update(oldAnnotations: Annotations, tr: Transaction): Annotations {
    let annotations = oldAnnotations;
    // todo: check if deletion is killing an annotation as well as .is(removeAnnotation)
    for (const e of tr.effects) {
      if (e.is(addAnnotation)) {
        annotations[e.value.id] = e.value;
      } else if (e.is(removeAnnotation)) {
        delete annotations[e.value.id];
      } else if (e.is(addThreadToAnnotation)) {
        annotations[e.value.annotationId].thread.push(e.value.threadMessage);
      } else if (e.is(deleteThreadFromAnnotation)) {
        annotations[e.value.annotationId].thread.splice(
          e.value.threadMessageId,
          1,
        );
      } else if (e.is(updateThreadMessage)) {
        annotations[e.value.annotationId].thread[e.value.threadMessageId] =
          e.value.newThreadMessage;
      } else {
        let annotation = annotations[e.value.annotationId];
        if (isAnnotationOfType(annotation, "revision")) {
          if (e.is(addVersionToRevision)) {
            annotation.versions.push(e.value.newVersion);
          } else if (e.is(deleteVersionFromRevision)) {
            annotation.versions.splice(e.value.versionId, 1);
          } else if (e.is(updateActiveRevisionVersion)) {
            annotation.currentlySelected = e.value.versionId;
          }
        }
        // well uh i think this is unnecessary since
        // JavaScript would give annotation a reference to the annotation object
        // but just in case, you know.
        annotations[e.value.annotationId] = annotation;
      }
    }

    // Map our old annotations to the new state
    // ranges, as we don't want our revision/highlighted/etc
    // to be static markers of a row and column but instead change with the
    // document
    annotations = annotations
      .map((x) => {
        // HELP: what does .map do through deletions?
        const newSelection = x.selection.map(
          tr.changes,
          isAnnotationOfType(x, "revision") ? 1 : 0,
        );
        console.log(newSelection, x.selection, tr.changes);

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
        return {
          ...x,
          // account for deletions...
          selection: cleanRangesOf(newSelection),
        };
      })
      // Well I'm too lazy to make TypeScript realize that it won't be null
      .filter((x) => x.selection !== null) as Annotations;
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
