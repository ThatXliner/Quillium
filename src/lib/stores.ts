import type { EditorView } from "@codemirror/view";
import { writable } from "svelte/store";
import type { Annotation, Annotations } from "$lib/editor/plugins/annotations";

// Might migrate this into Runes some time later
export const canCreateNewComment = writable(true);
export const editorView = writable<EditorView>();
export const annotations = writable<Annotations>();
// TODO: active annotations
export const activeComment = writable<Annotation<"comment"> | undefined>(
  undefined,
);
