import {
  EditorSelection,
  EditorState,
  SelectionRange,
} from "@codemirror/state";
import type { Annotation } from "./models";

export function cleanRangesOf(selection: EditorSelection) {
  const newRanges = selection.ranges.filter((range) => range.from !== range.to);
  return newRanges.length > 0
    ? EditorSelection.create(newRanges, selection.mainIndex)
    : null;
}

// Equal type and selection
export function equalAnnotationsType(a: Annotation, b: Annotation) {
  console.log(a, b);
  return a.selection.eq(b.selection) && a.value.type === b.value.type;
}

export function positionIntersects(
  position: number,
  selection: SelectionRange,
) {
  return selection.from <= position && position <= selection.to;
}
export function updateAnnotationsWithUpdatedText(
  state: EditorState,
  annotations: Annotation[],
) {
  return annotations.map((x) =>
    x.value.type === "revision"
      ? {
          ...x,
          value: {
            ...x.value,
            versions: x.value.versions.toSpliced(
              x.value.currentlySelected,
              1,
              state.doc
                .slice(x.selection.main.from, x.selection.main.to)
                .toString(),
            ),
          },
        }
      : x,
  );
}
