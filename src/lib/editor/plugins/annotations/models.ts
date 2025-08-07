import type { EditorSelection } from "@codemirror/state";

// what about multiple authors and stuff???
export type ThreadMessage = { message: string; author: string; time: number };
export type Thread = ThreadMessage[];
export type Comment = { type: "comment"; thread: Thread };
export type Suggestion = { type: "suggestion"; text: string; thread: Thread };
export type Revision = {
  type: "revision";
  currentlySelected: number;
  versions: string[];
  thread: Thread;
};
export type AnnotationTypes = Comment | Suggestion | Revision;
export type AnnotationType = AnnotationTypes["type"];
export interface Annotation<Type extends AnnotationTypes = AnnotationTypes> {
  selection: EditorSelection;
  value: Type;
}
export type RawAnnotation = {
  selection: EditorSelection["toJSON"];
  value: AnnotationTypes;
};
