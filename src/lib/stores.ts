import type { EditorView } from "@codemirror/view";
import { writable } from "svelte/store";
import type { Annotation, Comment } from "$lib/editor/plugins/annotations";

// Might migrate this into Runes some time later
export const canCreateNewComment = writable(true);
export const editorView = writable<EditorView>();
export const comments = writable<Annotation<Comment>[]>();
export const activeComment = writable<Annotation<Comment> | null>(null);
