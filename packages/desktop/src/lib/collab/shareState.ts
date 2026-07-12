import { history, historyField } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { readonlySavedFields } from "@quillium/share/core";

/**
 * shareState.ts — Production serializer for Omni Web Preview editor state.
 *
 * This module intentionally depends only on CodeMirror and the shared read-only
 * core so cross-package contract tests can exercise the exact desktop producer
 * without loading the desktop collaboration/Yjs stack.
 */
import type { LoadResult } from "../db/types";
import { annotationField, versionGroupField } from "../editor/plugins/annotations";
import { replayEvents } from "../editor/replay";

/** Serialize the fields understood by the public read-only editor. */
export function serializeShareState(state: EditorState): Record<string, unknown> {
    return state.toJSON(readonlySavedFields);
}

const persistedFields = { historyField, annotationField, versionGroupField };

export function serializeLoadedShareState(loaded: LoadResult): Record<string, unknown> {
    const extensions = [
        history(),
        EditorState.allowMultipleSelections.of(true),
        annotationField,
        versionGroupField,
    ];
    let state = EditorState.create({ extensions });
    if (loaded.snapshotStateJson && loaded.snapshotStateJson !== "{}") {
        try {
            state = EditorState.fromJSON(
                JSON.parse(loaded.snapshotStateJson),
                { extensions },
                persistedFields,
            );
        } catch {
            // A damaged snapshot still has a chance to recover from its event tail.
        }
    }
    if (loaded.eventsSince.length > 0) state = replayEvents(state, loaded.eventsSince);
    return serializeShareState(state);
}
