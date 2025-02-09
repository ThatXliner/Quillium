import type { EditorView } from "@codemirror/view";
import { writable } from "svelte/store";
import type { Comment } from "./plugins/comments";

export const canCreateNewComment = writable(true);
export const editorView = writable<EditorView>();
export const comments = writable<Comment[]>();
export const activeComment = writable<Comment | null>(null);
