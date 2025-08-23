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
import { cleanRangesOf, updateAnnotationsWithUpdatedText } from "./utils";

export const addAnnotation = StateEffect.define<GenericAnnotation>();
export const updateAnnotation = StateEffect.define<GenericAnnotation>();
export const removeAnnotation = StateEffect.define<GenericAnnotation>();
// or commands?
export const addThreadToComment = StateEffect.define<{
  commentId: number;
  threadMessage: ThreadMessage;
}>();
export const addVersionToRevision = StateEffect.define<{
  revisionAnnotationId: number;
  newVersion: string;
}>();
export const changeActiveVersion = StateEffect.define<{
  revisionAnnotationId: number;
  newVersionId: number;
}>();

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
        // XXX: Not sure if this is the right attribute to use
        annotations[e.value.id] = e.value;
      } else if (e.is(removeAnnotation)) {
        delete annotations[e.value.id];
      } else if (e.is(updateAnnotation)) {
        annotations[e.value.id] = e.value;
      }
    }
    // if (tr.changes.iterChangedRanges(range => {}))

    // Map our old annotations to the new state
    // ranges, as we don't want our annotations/highlighted portion
    // to be static markers of a row and column but instead change with the
    // document

    annotations = annotations
      .map((x) => {
        const newSelection = x.selection.map(
          tr.changes,
          isAnnotationOfType(x, "revision") ? 1 : 0,
        );
        console.log(newSelection, x.selection, tr.changes);
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
          selection: cleanRangesOf(newSelection),
        };
      })
      // Well I'm too lazy to make TypeScript realize that it won't be null
      .filter((x) => x.selection !== null) as Annotations;
    // TODO: run on every character update
    annotations = updateAnnotationsWithUpdatedText(tr.state, annotations);

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
