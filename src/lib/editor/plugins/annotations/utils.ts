import {
  AnnotationType,
  EditorSelection,
  EditorState,
  SelectionRange,
} from "@codemirror/state";
import {
  isAnnotationOfType,
  type Annotation,
  type Annotations,
  type GenericAnnotation,
} from "./models";
import { annotationField } from "./annotationField";

export function cleanRangesOf(selection: EditorSelection) {
  const newRanges = selection.ranges.filter((range) => range.from !== range.to);
  return newRanges.length > 0
    ? EditorSelection.create(newRanges, selection.mainIndex)
    : null;
}

// Equal type and selection
export function equalAnnotationsSignature(
  a: GenericAnnotation,
  b: GenericAnnotation,
) {
  return a.selection.eq(b.selection) && a._type === b._type;
}

export function positionIntersects(
  position: number,
  selection: SelectionRange,
) {
  return selection.from <= position && position <= selection.to;
}

export function getActiveAnnotation<T extends AnnotationType>(
  state: EditorState,
  type: T,
): Annotation<T> | undefined {
  const cursor = state.selection.main;
  const cursorPos = cursor.head;

  const annotations = state.field(annotationField);
  const rangesWhereCursorIsInside: {
    range: SelectionRange;
    associatedAnnotation: Annotation<T>;
  }[] = [];
  for (const annotation of annotations) {
    if (!isAnnotationOfType(annotation, type)) continue;

    // TODO: change these "active checks" to use the state machine
    if (
      isAnnotationOfType(annotation, "comment") &&
      annotation.thread.length === 0
    )
      return annotation;
    if (
      isAnnotationOfType(annotation, "revision") &&
      annotation.versions.length === 0
    )
      return annotation;

    for (const range of annotation.selection.ranges)
      if (
        positionIntersects(cursorPos, range) &&
        // Having this extra condition makes it feel like Google docs
        // Basically what this is doing that if the cursor is a selection,
        // we only want to show the annotation if the entire selection is within
        // a single annotation
        (!cursor.empty ? positionIntersects(cursor.anchor, range) : true)
      ) {
        rangesWhereCursorIsInside.push({
          range,
          associatedAnnotation: annotation,
        });
      }
  }
  return rangesWhereCursorIsInside.sort(
    (a, b) => a.range.to - a.range.from - (b.range.to - b.range.from),
  )?.[0]?.associatedAnnotation;
}
