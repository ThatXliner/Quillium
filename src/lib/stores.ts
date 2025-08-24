import type { EditorView } from "@codemirror/view";
import { writable, derived } from "svelte/store";

import { getActiveAnnotation } from "./editor/plugins/annotations/utils";
import { annotationField } from "./editor/plugins/annotations";

export const editorView = writable<EditorView>();
// TODO: active annotations
export const activeComment = derived(editorView, ($editorView) => {
	if (!$editorView) return undefined;
	return getActiveAnnotation($editorView.state, "comment");
});
export const annotations = derived(editorView, ($editorView) => {
	if (!$editorView) return undefined;
	return $editorView.state.field(annotationField);
});
