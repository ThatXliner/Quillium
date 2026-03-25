/**
 * forkState.ts — Pure logic for computing the snapshot state JSON to use
 * when creating a new draft branch.
 *
 * Extracted from Editor.svelte so it can be unit-tested without Tauri or a DOM.
 */
import { EditorState } from "@codemirror/state";
import type { Extension, StateField } from "@codemirror/state";

export type ForkMode = "duplicate" | "duplicate_without_annotations" | "blank";

/**
 * Given the current editor state and a fork mode, returns the serialised
 * state JSON to seed the new draft with, or null for a blank document.
 *
 * @param state       The current EditorState.
 * @param savedFields The fields map used by EditorState.toJSON / fromJSON.
 * @param extensions  Extensions for creating a clean state (duplicate_without_annotations only).
 * @param mode        The fork mode from settings.
 */
export function computeForkStateJson(
    state: EditorState,
    savedFields: Record<string, StateField<unknown>>,
    extensions: Extension,
    mode: ForkMode,
): string | null {
    if (mode === "duplicate") {
        return JSON.stringify(state.toJSON(savedFields));
    }
    if (mode === "duplicate_without_annotations") {
        const clean = EditorState.create({ doc: state.doc.toString(), extensions });
        return JSON.stringify(clean.toJSON(savedFields));
    }
    // "blank"
    return null;
}
