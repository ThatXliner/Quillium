import {
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
export function updateAnnotationsWithUpdatedText(
  state: EditorState,
  annotations: Annotations,
) {
  return annotations.map((x) => {
    if (isAnnotationOfType(x, "revision")) {
      x.versions[x.currentlySelected] = state.doc
        .slice(x.selection.main.from, x.selection.main.to)
        .toString();
    }
    return x;
  });
}
