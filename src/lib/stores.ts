import type { EditorState } from "@codemirror/state";
import { writable } from "svelte/store";
import type { Comment } from "./plugins/comments";

export const canCreateNewComment = writable(true);
export const editorState = writable<EditorState>();
export const comments = writable<Comment[]>();
