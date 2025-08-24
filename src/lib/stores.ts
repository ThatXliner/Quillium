import type { EditorView } from "@codemirror/view";
import { writable, derived } from "svelte/store";

import { getActiveAnnotation } from "./editor/plugins/annotations/utils";
import type { Annotation, Annotations } from "./editor/plugins/annotations";

export const editorView = writable<EditorView>();
// TODO: Document justification
export const annotations = writable<Annotations | undefined>();
export const activeComment = writable<Annotation<"comment"> | undefined>();
// export const activeComment = derived(editorView, ($editorView) => {
//   if (!$editorView) return undefined;
//   return getActiveAnnotation($editorView.state, "comment");
// });
// export const annotations = derived(editorView, ($editorView) => {
// 	if (!$editorView) return undefined;
// 	return $editorView.state.field(annotationField);
// });
