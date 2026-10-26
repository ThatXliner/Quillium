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
    const { selection: _selection, ...shareState } = state.toJSON(readonlySavedFields);
    return shareState;
}

/** Remove author-only editor selections from current and legacy share payloads. */
export function withoutTransientShareSelection(
    state: Record<string, unknown> | null,
): Record<string, unknown> | null {
    if (!state) return null;

    const { selection: _selection, ...shareState } = state;
    if (!Array.isArray(shareState.tabs)) return shareState;

    return {
        ...shareState,
        tabs: shareState.tabs.map((tab) => {
            if (!tab || typeof tab !== "object") return tab;
            const tabRecord = tab as Record<string, unknown>;
            if (!tabRecord.state || typeof tabRecord.state !== "object") return tab;
            const { selection: _tabSelection, ...tabState } = tabRecord.state as Record<
                string,
                unknown
            >;
            return { ...tabRecord, state: tabState };
        }),
    };
}
