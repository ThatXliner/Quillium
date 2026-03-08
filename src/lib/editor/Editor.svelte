<script lang="ts">
/**
 * Editor.svelte — Main editor component and application entry point
 * for the writing surface.
 *
 * Role: Bootstraps a CodeMirror 6 EditorView, wires it into
 * Svelte stores, and orchestrates persistence (load/save via Tauri).
 *
 * Key dependencies:
 *   - CodeMirror 6 (EditorState, EditorView) — core editing engine
 *   - $lib/db — Tauri invoke wrappers for event-log persistence
 *   - extensions.ts — assembles the full CodeMirror extension stack
 *   - listeners.ts — persistence & change-reaction listeners
 *   - $lib/stores — Svelte stores that expose editor state to the
 *     rest of the UI (AI sidebar, annotation panel, status bar)
 *
 * Interactions:
 *   - On every editor update the `updateListener` callback syncs
 *     document content, selection, annotations, and writing stats
 *     into Svelte stores so sibling components can react.
 *   - The Annotations panel and AI sidebar read from those stores;
 *     they never touch the EditorView directly.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { get } from "svelte/store";
import { onMount } from "svelte";
import posthog from "posthog-js";
import { getExtensions, savedFields } from "./extensions";
import {
    editorView,
    annotations,
    documentContent,
    selectedText,
    activeAnnotation,
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
} from "$lib/stores";
import {
    initDb,
    listDocuments,
    listDrafts,
    createDocument,
    createDraft,
    loadDocumentState,
} from "$lib/db";
import "./plugins/annotations/default.css";
import type { ViewUpdate } from "@codemirror/view";
import StatusBar from "./StatusBar.svelte";
import Annotations from "./plugins/annotations/Annotations.svelte";
import type { ListenerOptions } from "./listeners";
import { annotationField } from "./plugins/annotations";
import { getActiveAnnotation } from "./plugins/annotations/utils";

// ── Local UI state ──────────────────────────────────────────────
let element = $state<HTMLDivElement>();
let stats = $state<{
    words: number;
    chars: number;
    selWords: number;
    selChars: number;
}>({
    words: 0,
    chars: 0,
    selWords: 0,
    selChars: 0,
});

function getWordCount(doc: string): number {
    return doc.trim().split(/\s+/).filter(Boolean).length;
}

function extractSelectedText(update: ViewUpdate): string {
    const selection = update.state.selection.main;
    return selection.empty ? "" : update.state.sliceDoc(selection.from, selection.to);
}

function computeWritingStats(doc: string, selText: string) {
    return {
        words: getWordCount(doc),
        chars: doc.length,
        selWords: selText ? getWordCount(selText) : 0,
        selChars: selText.length,
    };
}

function syncStoresToEditorState(update: ViewUpdate, doc: string, selText: string) {
    $annotations = update.state.field(annotationField);
    $activeAnnotation = getActiveAnnotation(update.state);
    $documentContent = doc;
    $selectedText = selText;
}

// ── Update listener ─────────────────────────────────────────────
const getExtensionOptions: ListenerOptions = {
    updateListener(update: ViewUpdate) {
        const doc = update.state.doc.toString();
        const selText = extractSelectedText(update);

        stats = computeWritingStats(doc, selText);
        syncStoresToEditorState(update, doc, selText);
    },
};

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Resolves the active draft for a document. If no drafts exist,
 * creates one. Returns the draft ID.
 */
async function resolveActiveDraft(docId: string): Promise<string | null> {
    const drafts = await listDrafts(docId);
    if (drafts.length > 0) {
        const active = drafts.find((d) => d.isActive) ?? drafts[0];
        return active.id;
    }
    // Create a default draft for new documents
    return createDraft(docId, "Draft");
}

/**
 * Builds an EditorState from a LoadResult, restoring from the
 * latest snapshot and logging a warning if there are events to
 * replay (replay is deferred to v2).
 */
function buildStateFromLoad(
    snapshotJson: string | null,
    eventCount: number,
): EditorState {
    if (snapshotJson && snapshotJson !== "{}") {
        if (eventCount > 0) {
            console.warn(
                `[Editor] ${eventCount} event(s) since last snapshot — ` +
                    "full replay not yet implemented; loading snapshot only.",
            );
        }
        try {
            return EditorState.fromJSON(
                JSON.parse(snapshotJson),
                { extensions: getExtensions(getExtensionOptions) },
                savedFields,
            );
        } catch {
            // fall through to blank state
        }
    }
    return EditorState.create({ extensions: getExtensions(getExtensionOptions) });
}

// ── State restoration ───────────────────────────────────────────
const fromSave = (async () => {
    await initDb();
    const docId = get(currentDocumentId);

    if (docId) {
        // Document already set (e.g. navigated from library)
        const draftId = await resolveActiveDraft(docId);
        currentDraftId.set(draftId);
        if (draftId) {
            const loaded = await loadDocumentState(docId, draftId);
            currentDocumentTitle.set(
                loaded.snapshotStateJson
                    ? extractTitleFromStateJson(loaded.snapshotStateJson)
                    : "Untitled",
            );
            return buildStateFromLoad(
                loaded.snapshotStateJson,
                loaded.eventsSince.length,
            );
        }
    } else {
        // No document set — load the most-recently-updated document
        const docs = await listDocuments();
        if (docs.length > 0) {
            const doc = docs[0];
            currentDocumentId.set(doc.id);
            currentDocumentTitle.set(doc.title);

            const draftId = await resolveActiveDraft(doc.id);
            currentDraftId.set(draftId);
            if (draftId) {
                const loaded = await loadDocumentState(doc.id, draftId);
                return buildStateFromLoad(
                    loaded.snapshotStateJson,
                    loaded.eventsSince.length,
                );
            }
        }
    }

    // Blank editor (new installation or empty DB after migration).
    // Create an initial document + draft so the event log can record
    // edits immediately without waiting for the user to visit the library.
    const newDocId = await createDocument("Untitled");
    const newDraftId = await createDraft(newDocId, "Draft");
    currentDocumentId.set(newDocId);
    currentDocumentTitle.set("Untitled");
    currentDraftId.set(newDraftId);
    return EditorState.create({ extensions: getExtensions(getExtensionOptions) });
})();

function extractTitleFromStateJson(stateJson: string): string {
    try {
        const parsed = JSON.parse(stateJson);
        const doc = parsed?.doc;
        if (typeof doc === "string") {
            return doc.split("\n")[0].trim().slice(0, 80) || "Untitled";
        }
    } catch {
        // ignore
    }
    return "Untitled";
}

/**
 * Reloads the current document from the DB.
 * Used by the debug panel after writing a scenario.
 */
export async function reload() {
    const docId = get(currentDocumentId);
    if (!docId || !$editorView) return;
    await loadDocument(docId);
}

/**
 * Loads a specific document from SQLite into the editor.
 * Called by the library when the user opens a document.
 */
export async function loadDocument(id: string) {
    if (!$editorView) return;
    currentDocumentId.set(id);

    const draftId = await resolveActiveDraft(id);
    currentDraftId.set(draftId);

    if (!draftId) {
        const state = EditorState.create({ extensions: getExtensions(getExtensionOptions) });
        $editorView.setState(state);
        return;
    }

    const loaded = await loadDocumentState(id, draftId);
    currentDocumentTitle.set(
        loaded.snapshotStateJson
            ? extractTitleFromStateJson(loaded.snapshotStateJson)
            : "Untitled",
    );

    const state = buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince.length);
    $editorView.setState(state);
    const text = state.doc.toString();
    stats = { words: getWordCount(text), chars: text.length, selWords: 0, selChars: 0 };
}

onMount(() => {
    fromSave.then((state) => {
        $editorView = new EditorView({
            state,
            parent: element,
        });
        posthog.capture("app_session_started", {
            word_count: getWordCount(state.doc.toString()),
        });
    });
});
</script>

<div class="w-full h-full overflow-y-auto relative">
    <div class="sticky top-4 z-50"><StatusBar {...stats} /></div>

    {#await fromSave then}
        <div
            id="editor-document"
            class="mx-auto w-[816px] min-h-[calc(100vh-4rem)] mt-12 mb-12 bg-white rounded-lg shadow-xl py-3 px-1"
            bind:this={element}
        ></div>
    {/await}

    <Annotations />
</div>

<style>
    :global(.cm-editor.cm-focused) {
        outline: none;
    }
    :global(.cm-content) {
        font-family: var(--doc-font-family);
        font-size: var(--doc-font-size);
    }
    :global(.cm-editor) {
        z-index: 0 !important;
    }
    :global(.cm-scroller) {
        overflow: visible !important;
    }
    :global(.cm-content) {
        text-indent: 2em;
    }
</style>
