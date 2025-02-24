import type { EditorView } from "@codemirror/view";
import { writable } from "svelte/store";
import type { Comment } from "$lib/editor/plugins/comments";

// Might migrate this into Runes some time later
export const canCreateNewComment = writable(true);
export const editorView = writable<EditorView>();
export const comments = writable<Comment[]>();
export const activeComment = writable<Comment | null>(null);
