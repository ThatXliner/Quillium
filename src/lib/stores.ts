import type { EditorView } from "@codemirror/view";
import { writable, derived } from "svelte/store";

import { getActiveAnnotation } from "./editor/plugins/annotations/utils";
import type { Annotation, Annotations } from "./editor/plugins/annotations";

export const editorView = writable<EditorView>();
// We need to manually hook into when the annotations change
// (editorView never gets updated... maybe I could do that? Would
// that be premature optimization or just passing in a reference?)
// So we manually manage and sync our own version of annotations
// as opposed to derived from editorView
export const annotations = writable<Annotations | undefined>();
// For similar reasons (getActiveAnnotation relies on editor.state, which relies on editorView)
// we have to manually manage and sync our own version of activeComment
export const activeComment = writable<Annotation<"comment"> | undefined>();

// In case we decide to bite the dust with updating editorView every time,
// here is some code to do that:
// export const activeComment = derived(editorView, ($editorView) => {
//   if (!$editorView) return undefined;
//   return getActiveAnnotation($editorView.state, "comment");
// });
// export const annotations = derived(editorView, ($editorView) => {
// 	if (!$editorView) return undefined;
// 	return $editorView.state.field(annotationField);
// });
