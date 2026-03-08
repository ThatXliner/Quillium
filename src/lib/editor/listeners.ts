/**
 * listeners.ts — CodeMirror update listeners for persistence and
 * change reactions.
 *
 * Role: Provides the `listeners()` factory that returns an array of
 * CodeMirror extensions responsible for reacting to editor state
 * changes. The auto-save listener branches on `currentDocumentId`:
 *   - If set: saves to SQLite via updateDocument()
 *   - Otherwise: falls back to legacy invoke("save")
 *
 * Key dependencies:
 *   - ./extensions (savedFields) — determines which StateFields are
 *     included in the serialised JSON snapshot
 *   - Tauri invoke("save") — legacy writes to state.json
 *   - $lib/db (updateDocument) — SQLite writes
 *   - ./plugins/annotations (annotationsChanged) — detects annotation
 *     mutations
 *
 * Interactions:
 *   - extensions.ts includes `listeners(options)` in the extension
 *     stack so these listeners are active for every EditorView.
 */
import { savedFields } from "./extensions";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import { currentDocumentId, currentDocumentTitle } from "$lib/stores";
import { updateDocument } from "$lib/db";
import { annotationsChanged } from "./plugins/annotations";

export interface ListenerOptions {
    updateListener?: (update: ViewUpdate) => void;
    persist?: boolean;
}

function extractTitle(text: string): string {
    return text.split("\n")[0].trim().slice(0, 80) || "Untitled";
}

/**
 * Serialises the current editor state and persists it — either to
 * SQLite (when a document ID is set) or to the legacy state.json.
 */
async function persistStateToDisk(update: ViewUpdate) {
    const stateJson = JSON.stringify(update.state.toJSON(savedFields));
    const docId = get(currentDocumentId);

    if (docId) {
        const docText = update.state.doc.toString();
        const title = extractTitle(docText);
        const wordCount = docText.trim().split(/\s+/).filter(Boolean).length;
        currentDocumentTitle.set(title);
        await updateDocument(
            docId,
            stateJson,
            title,
            wordCount,
            docText.slice(0, 200),
            [],
        );
    } else {
        invoke("save", { state: stateJson }).catch(console.error);
    }
}

// ── Auto-save listener ────────────────────────────────────────────
const save = EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged || annotationsChanged(update)) {
        persistStateToDisk(update);
    }
});

export const listeners = (options?: ListenerOptions) => [
    ...(options?.persist === false ? [] : [save]),
    ...(options?.updateListener ? [EditorView.updateListener.of(options.updateListener)] : []),
];
