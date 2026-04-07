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
import posthog from "$lib/posthog";
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
    lastPersistedEventId,
    lastSavedAt,
    writingStats,
} from "$lib/stores";
import { annotationEventBus } from "$lib/editor/plugins/annotations/eventBus";
import {
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
import { aiSettings, hasApiKey, setAiProcessing, ensureApiKeyLoaded } from "$lib/ai/settings.svelte";
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
    setAiProcessing(true);
    try {
        await ensureApiKeyLoaded();
        const model = createModel(aiSettings.provider, aiSettings.apiKey, aiSettings.model);
        const { text: suggested } = await generateText({
            model,
            prompt: `Suggest a single short, evocative title for this piece of writing. Reply with only the title — no quotes, no explanation, no punctuation at the end.\n\n${text.slice(0, 1000)}`,
        });
        const newTitle = suggested.trim().slice(0, 40);
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
        setAiProcessing(false);
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

// Bridge from CodeMirror → Svelte reactivity.
//
// $derived and $effect cannot observe CodeMirror state changes because
// EditorView is a plain mutable object, not $state — Svelte never sees
// view.state being swapped on each transaction. This function is called
// from CodeMirror's updateListener on every transaction, manually pushing
// the new state into Svelte-reactive stores so the rest of the UI can
// react normally. $effect is not used here; the hook is CodeMirror's own.
function syncStoresToEditorState(update: ViewUpdate, doc: string, selText: string) {
    $annotations = update.state.field(annotationField);
    $activeAnnotation = getActiveAnnotation(update.state);
    $documentContent = doc;
    $selectedText = selText;
}

// ── Keyboard shortcut telemetry ─────────────────────────────────
// Track undo/redo and other notable editor actions so we can catch
// abuse patterns (e.g. ctrl-z spam) in PostHog.
function trackKeyboardActions(update: ViewUpdate) {
    for (const tr of update.transactions) {
        if (tr.isUserEvent("undo")) {
            posthog.capture("editor_undo");
        } else if (tr.isUserEvent("redo")) {
            posthog.capture("editor_redo");
        } else if (tr.isUserEvent("select.all")) {
            posthog.capture("editor_select_all");
        }
    }
}

// ── Update listener ─────────────────────────────────────────────
const getExtensionOptions: ListenerOptions = {
    updateListener(update: ViewUpdate) {
        const doc = update.state.doc.toString();
        const selText = extractSelectedText(update);

        writingStats.set(computeWritingStats(doc, selText));
        syncStoresToEditorState(update, doc, selText);
        trackKeyboardActions(update);
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

    // Blank editor (new installation).
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
        const parsed = JSON.parse(stateJson) as { doc?: string | string[] };
        const firstLine = Array.isArray(parsed.doc)
            ? (parsed.doc[0] ?? "")
            : String(parsed.doc ?? "");
        return firstLine.trim().slice(0, 40) || "Untitled";
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
let loadGeneration = 0;
export async function loadDocument(id: string) {
    if (!$editorView) return;

    const gen = ++loadGeneration;

    // Clear stale pending selections from the previous document so they
    // can't be consumed by a new document whose annotations share the same IDs.
    annotationEventBus.clearPendingSelections();

    const draftId = await resolveActiveDraft(id);
    if (gen !== loadGeneration) return;
    currentDraftId.set(draftId);
    lastPersistedEventId.set(-1);
    lastSavedAt.set(null);

    if (!draftId) {
        currentDocumentTitle.set("Untitled");
        const state = EditorState.create({ extensions: getExtensions(getExtensionOptions) });
        $editorView.setState(state);
        return;
    }

    const loaded = await loadDocumentState(id, draftId);
    if (gen !== loadGeneration) return;
    currentDocumentTitle.set(
        loaded.snapshotStateJson ? extractTitleFromStateJson(loaded.snapshotStateJson) : "Untitled",
    );

    // Seed lastPersistedEventId from the loaded state so named checkpoints
    // can be created immediately without requiring a new edit first.
    const latestEventId =
        loaded.eventsSince.length > 0
            ? loaded.eventsSince[loaded.eventsSince.length - 1].id
            : loaded.snapshotEventId >= 0
              ? loaded.snapshotEventId
              : -1;
    lastPersistedEventId.set(latestEventId);

    const state = buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince);
    $editorView.setState(state);
    const text = state.doc.toString();
    writingStats.set({ words: getWordCount(text), chars: text.length, selWords: 0, selChars: 0 });
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

    // Watch for document switches (e.g. navigating from library to a new/different doc).
    // fromSave only runs once at init, so we need to reload when currentDocumentId changes.
    let initialised = false;
    const unsubscribe = currentDocumentId.subscribe((id) => {
        if (!initialised) {
            initialised = true;
            return; // skip the initial value — fromSave already handles it
        }
        if (id) {
            fromSave.then(() => loadDocument(id));
        }
    });

    return () => {
        unsubscribe();
    };
});
</script>

<div class="w-full h-full overflow-y-auto relative">
    <div class="sticky top-4 z-50 flex flex-col items-center gap-2 pointer-events-none">
        <div class="pointer-events-auto">
            <StatusBar titleVisibility={appSettings.titleVisibility} titleForced={titleEditing}>
                {#snippet children()}
                    <div class="flex items-center justify-center py-1.5 px-4 mx-auto mb-3 rounded-full {appSettings.titleVisibility !== 'always' ? 'max-w-full' : ''}">
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
                                class="flex items-center gap-2 text-sm font-medium text-black/60 hover:text-black/80 transition-colors {appSettings.titleVisibility !== 'always' ? 'max-w-[28rem]' : ''}"
                            >
                                <span class={appSettings.titleVisibility !== 'always' ? 'truncate' : ''}>{$currentDocumentTitle}</span>
                                <Pencil size={14} class="shrink-0 text-black/40" />
                                <Kbd keys={[modKey, "L"]} />
                            </button>
                        {/if}
                        {#if appSettings.aiEnabled && hasApiKey()}
                            <div class="w-px h-3.5 bg-black/20 shrink-0 mx-1.5"></div>
                            <button
                                onclick={suggestTitle}
                                disabled={titleSuggesting}
                                title="Suggest a title with AI"
                                class="flex items-center gap-1 pr-2 py-1 rounded-md text-[10px] font-medium text-black/35 hover:text-black/60 hover:bg-white/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
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
