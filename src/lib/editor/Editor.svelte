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
    updateDocumentMeta,
} from "$lib/db";
import "./plugins/annotations/default.css";
import type { ViewUpdate } from "@codemirror/view";
import StatusBar from "./StatusBar.svelte";
import Annotations from "./plugins/annotations/Annotations.svelte";
import type { ListenerOptions } from "./listeners";
import { annotationField } from "./plugins/annotations";
import { getActiveAnnotation } from "./plugins/annotations/utils";
import { replayEvents } from "./replay";
import type { EventRecord } from "$lib/db/types";
import { appSettings } from "$lib/settings.svelte";
import { aiSettings, hasApiKey } from "$lib/ai/settings.svelte";
import { createModel } from "$lib/ai/provider";
import { generateText } from "ai";
import { Pencil, SparklesIcon } from "lucide-svelte";
import Kbd from "$lib/ui/Kbd.svelte";

// ── Local UI state ──────────────────────────────────────────────
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

let element = $state<HTMLDivElement>();
let titleEditing = $state(false);
let titleInputEl = $state<HTMLInputElement | undefined>();
let titleDraft = $state("");
let titleSuggesting = $state(false);

export function startEditingTitle() {
    titleDraft = $currentDocumentTitle;
    titleEditing = true;
    // Focus input on next tick after it mounts
    setTimeout(() => titleInputEl?.select(), 0);
}

async function suggestTitle() {
    const text = $editorView?.state.doc.toString() ?? "";
    if (!text.trim() || titleSuggesting) return;
    titleSuggesting = true;
    try {
        const model = createModel(aiSettings.provider, aiSettings.apiKey, aiSettings.model);
        const { text: suggested } = await generateText({
            model,
            prompt: `Suggest a single short, evocative title for this piece of writing. Reply with only the title — no quotes, no explanation, no punctuation at the end.\n\n${text.slice(0, 1000)}`,
        });
        const newTitle = suggested.trim().slice(0, 80);
        if (newTitle) {
            currentDocumentTitle.set(newTitle);
            const docId = get(currentDocumentId);
            if (docId) {
                const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
                updateDocumentMeta(docId, newTitle, wordCount, text.slice(0, 200), "[]").catch(
                    console.error,
                );
            }
        }
    } catch (e) {
        console.error("[suggestTitle]", e);
    } finally {
        titleSuggesting = false;
    }
}

async function commitTitle() {
    if (!titleEditing) return;
    titleEditing = false;
    const newTitle = titleDraft.trim() || "Untitled";
    if (newTitle === $currentDocumentTitle) return;
    currentDocumentTitle.set(newTitle);
    const docId = get(currentDocumentId);
    if (docId) {
        const text = $editorView?.state.doc.toString() ?? "";
        const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
        updateDocumentMeta(docId, newTitle, wordCount, text.slice(0, 200), "[]").catch(
            console.error,
        );
    }
}
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
 * latest snapshot and replaying any events that occurred after it.
 */
function buildStateFromLoad(snapshotJson: string | null, eventsSince: EventRecord[]): EditorState {
    let base: EditorState;
    if (snapshotJson && snapshotJson !== "{}") {
        try {
            base = EditorState.fromJSON(
                JSON.parse(snapshotJson),
                { extensions: getExtensions(getExtensionOptions) },
                savedFields,
            );
        } catch {
            base = EditorState.create({ extensions: getExtensions(getExtensionOptions) });
        }
    } else {
        base = EditorState.create({ extensions: getExtensions(getExtensionOptions) });
    }

    if (eventsSince.length === 0) return base;

    console.log(`[Editor] Replaying ${eventsSince.length} event(s) since last snapshot.`);
    return replayEvents(base, eventsSince);
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
            return buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince);
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
                return buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince);
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
        const parsed = JSON.parse(stateJson) as EditorState;
        const doc = parsed.doc.toString();
        return doc.split("\n")[0].trim().slice(0, 80) || "Untitled";
    } catch {
        return "Unknown";
    }
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
        loaded.snapshotStateJson ? extractTitleFromStateJson(loaded.snapshotStateJson) : "Untitled",
    );

    const state = buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince);
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
    <div class="sticky top-4 z-50 flex flex-col items-center gap-2 pointer-events-none">
        <div class="pointer-events-auto">
            <StatusBar {...stats} alwaysShowTitle={appSettings.alwaysShowTitle} titleForced={titleEditing}>
                {#snippet children()}
                    <div class="flex items-center justify-center py-1.5 px-4 w-fit mx-auto mb-3 rounded-full">
                        {#if titleEditing}
                            <input
                                bind:this={titleInputEl}
                                bind:value={titleDraft}
                                onblur={commitTitle}
                                onkeydown={(e) => {
                                    if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
                                    if (e.key === "Escape") { titleEditing = false; }
                                }}
                                class="text-sm font-medium text-black/70 bg-transparent border-none outline-none min-w-[8rem] max-w-[28rem] text-center placeholder:text-black/30"
                                aria-label="Document title"
                            />
                        {:else}
                            <button
                                onclick={startEditingTitle}
                                title="Rename title ({modKey}L)"
                                class="flex items-center gap-2 text-sm font-medium text-black/60 hover:text-black/80 transition-colors max-w-[28rem]"
                            >
                                <span class="truncate">{$currentDocumentTitle}</span>
                                <Pencil size={14} class="shrink-0 text-black/40" />
                                <Kbd keys={[modKey, "L"]} />
                            </button>
                        {/if}
                        {#if hasApiKey()}
                            <div class="w-px h-3.5 bg-black/20 shrink-0"></div>
                            <button
                                onclick={suggestTitle}
                                disabled={titleSuggesting}
                                title="Suggest a title with AI"
                                class="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-black/35 hover:text-black/60 hover:bg-white/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                            >
                                <SparklesIcon size={11} />
                                <span>{titleSuggesting ? "…" : "Suggest"}</span>
                            </button>
                        {/if}
                    </div>
                {/snippet}
            </StatusBar>
        </div>
    </div>

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
