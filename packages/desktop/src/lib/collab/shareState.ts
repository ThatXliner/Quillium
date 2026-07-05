import type { LoadResult } from "$lib/db/types";
import { annotationField, versionGroupField } from "$lib/editor/plugins/annotations";
import { replayEvents } from "$lib/editor/replay";
import { history, historyField } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { type SerializedAnnotation, serializeAnnotations } from "./sharePayload";

type SerializedShareState = {
    content: string;
    annotations: SerializedAnnotation[];
};

const shareSavedFields = { historyField, annotationField, versionGroupField };

function shareStateExtensions() {
    return [
        history(),
        EditorState.allowMultipleSelections.of(true),
        annotationField,
        versionGroupField,
    ];
}

function buildShareStateFromLoad(loaded: LoadResult): EditorState {
    let base: EditorState;
    if (loaded.snapshotStateJson && loaded.snapshotStateJson !== "{}") {
        try {
            base = EditorState.fromJSON(
                JSON.parse(loaded.snapshotStateJson),
                { extensions: shareStateExtensions() },
                shareSavedFields,
            );
        } catch {
            base = EditorState.create({ extensions: shareStateExtensions() });
        }
    } else {
        base = EditorState.create({ extensions: shareStateExtensions() });
    }

    return loaded.eventsSince.length > 0 ? replayEvents(base, loaded.eventsSince) : base;
}

export function serializeLoadedShareState(loaded: LoadResult): SerializedShareState {
    const state = buildShareStateFromLoad(loaded);
    const content = state.doc.toString();
    return {
        content,
        annotations: serializeAnnotations(content, state.field(annotationField, false)),
    };
}
