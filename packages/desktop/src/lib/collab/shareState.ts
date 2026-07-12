import type { EditorState } from "@codemirror/state";
import { readonlySavedFields } from "@quillium/share/core";

/**
 * shareState.ts — Production serializer for Omni Web Preview editor state.
 *
 * This module intentionally depends only on CodeMirror and the shared read-only
 * core so cross-package contract tests can exercise the exact desktop producer
 * without loading the desktop collaboration/Yjs stack.
 */
/** Serialize the fields understood by the public read-only editor. */
export function serializeShareState(state: EditorState): Record<string, unknown> {
    return state.toJSON(readonlySavedFields);
}
