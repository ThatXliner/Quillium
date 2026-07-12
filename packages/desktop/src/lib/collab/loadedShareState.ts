/**
 * loadedShareState.ts — Rebuild a persisted desktop draft for Omni Web Preview.
 *
 * Kept separate from the pure share-state serializer because cross-package fixtures
 * load that serializer directly outside SvelteKit, where $app and $lib are unavailable.
 */
import type { LoadResult } from "$lib/db/types";
import { annotationField, versionGroupField } from "$lib/editor/plugins/annotations";
import { replayEvents } from "$lib/editor/replay";
import { history, historyField } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { serializeShareState } from "./shareState";

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
