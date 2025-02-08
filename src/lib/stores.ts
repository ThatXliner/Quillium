import type { EditorState } from "@codemirror/state";
import { writable } from "svelte/store";

export const canCreateNewComment = writable(true);
export const editorState = writable<EditorState>();
