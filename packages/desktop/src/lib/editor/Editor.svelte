<script lang="ts">
import {
    createDocument,
    createDraft,
    createSnapshot,
    deregisterOpenDoc,
    getDocumentMeta,
    listDocuments,
    loadDocumentState,
    registerOpenDoc,
    setActiveDraft,
    updateDocumentMeta,
} from "$lib/db";
import {
    getNewDocumentUndoHistoryAnalytics,
    getUndoHistoryPolicyAnalytics,
} from "$lib/db/historyPolicy";
import type { DocumentMeta } from "$lib/db/types";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import posthog from "$lib/posthog";
import { getPersistUndoHistoryForNewDocuments } from "$lib/settings.svelte";
import {
    activeAnnotation,
    annotations,
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    currentTabId,
    documentContent,
    editorView,
    lastPersistedEventId,
    lastSavedAt,
    selectedText,
    selectedTextRange,
    versionGroups,
    writingStats,
} from "$lib/stores";
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
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { onMount } from "svelte";
import { get } from "svelte/store";
import { getExtensions, savedFields } from "./extensions";
import { loadUserDictionary } from "./harper/harperLinter";
import "./plugins/annotations/default.css";
import "./harper/harper.css";
import type { EventRecord } from "$lib/db/types";
import type { ViewUpdate } from "@codemirror/view";
import { GitBranchIcon, LockIcon } from "lucide-svelte";
import DocumentTabs from "./DocumentTabs.svelte";
import DocumentTitleBar from "./DocumentTitleBar.svelte";
import DraftDeleteModal from "./DraftDeleteModal.svelte";
import DraftTreePanel from "./DraftTreePanel.svelte";
import type { ListenerOptions } from "./listeners";
import { flushMetaDebounces, flushPersistQueue } from "./listeners";
import { annotationField, versionGroupField } from "./plugins/annotations";
import Annotations from "./plugins/annotations/Annotations.svelte";
import { getActiveAnnotation } from "./plugins/annotations/utils";
import { reconstructState } from "./replay";
import { SAMPLE_DOCUMENT_CONTENT, SAMPLE_DOCUMENT_TITLE } from "./sampleDocument";
import { TabDraftController } from "./tabDrafts.svelte";

// ── Multi-window ────────────────────────────────────────────────
const windowLabel = getCurrentWebviewWindow().label;

// ── Local UI state ──────────────────────────────────────────────
let element = $state<HTMLDivElement>();

// Title editing lives in DocumentTitleBar; this delegate keeps the
// component's public API (used by +page.svelte for the Cmd+L shortcut).
let titleBar = $state<{ startEditing: () => void }>();
export function startEditingTitle() {
    titleBar?.startEditing();
}

function getWordCount(doc: string): number {
    return doc.trim().split(/\s+/).filter(Boolean).length;
}

function extractSelectedText(state: EditorState): string {
    const selection = state.selection.main;
    return selection.empty ? "" : state.sliceDoc(selection.from, selection.to);
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
function syncStoresToEditorState(state: EditorState) {
    const doc = state.doc.toString();
    const selection = state.selection.main;
    const selText = extractSelectedText(state);
    writingStats.set(computeWritingStats(doc, selText));
    $annotations = state.field(annotationField);
    $versionGroups = state.field(versionGroupField);
    $activeAnnotation = getActiveAnnotation(state);
    $documentContent = doc;
    $selectedText = selText;
    $selectedTextRange = selection.empty
        ? undefined
        : {
              from: selection.from,
              to: selection.to,
          };
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
        syncStoresToEditorState(update.state);
        trackKeyboardActions(update);
    },
};

// ── Tabs & draft tree (#160) ────────────────────────────────────
// State + actions live in TabDraftController (tabDrafts.svelte.ts);
// the editor supplies the lifecycle pieces via deps below.
const drafts = new TabDraftController({
    switchToDraft: (tabId, draftId) => switchToDraft(tabId, draftId),
    flushPendingPersist: () => flushPendingPersist(),
    seedStateJson: (sourceDraftId) => seedStateJson(sourceDraftId),
});

const currentDraft = $derived(drafts.tabDrafts.find((d) => d.id === $currentDraftId));
const isLocked = $derived(currentDraft?.locked ?? false);
// A draft locks automatically when a newer iteration supersedes it (it has a
// live iteration after it in its run); otherwise the lock was manual.
const currentIsSuperseded = $derived(
    !!currentDraft && drafts.tabDrafts.some((d) => d.parentDraftId === currentDraft.id),
);

/** Flushes queued events + debounced meta writes before switching context. */
async function flushPendingPersist(): Promise<void> {
    flushMetaDebounces();
    await flushPersistQueue();
}

/**
 * Builds an EditorState from a LoadResult, restoring from the
 * latest snapshot and replaying any events that occurred after it.
 * Locked drafts get a read-only state; unlocking rebuilds it.
 */
function buildStateFromLoad(
    snapshotJson: string | null,
    eventsSince: EventRecord[],
    readOnly = false,
    persistHistory = true,
): EditorState {
    const extensionOptions = { ...getExtensionOptions, persistHistory };
    const extensions = readOnly
        ? [getExtensions(extensionOptions), EditorState.readOnly.of(true)]
        : getExtensions(extensionOptions);
    if (eventsSince.length > 0) {
        console.log(`[Editor] Replaying ${eventsSince.length} event(s) since last snapshot.`);
    }
    return reconstructState(snapshotJson, eventsSince, extensions);
}

function captureUndoHistoryPolicyLoaded(document: DocumentMeta): void {
    posthog.capture("undo_history_policy_loaded", getUndoHistoryPolicyAnalytics(document));
}

// ── State restoration ───────────────────────────────────────────
const fromSave = (async () => {
    const docId = get(currentDocumentId);

    if (docId) {
        // Document already set (e.g. navigated from library)
        const doc = await getDocumentMeta(docId);
        if (doc) {
            currentDocumentTitle.set(doc.title);
            captureUndoHistoryPolicyLoaded(doc);
        }
        const resolved = await drafts.refreshTabState(docId);
        currentDraftId.set(resolved?.draftId ?? null);
        if (resolved) {
            const loaded = await loadDocumentState(docId, resolved.draftId);
            const locked = drafts.lockedOf(resolved.draftId);
            return buildStateFromLoad(
                loaded.snapshotStateJson,
                loaded.eventsSince,
                locked,
                doc?.persistHistory ?? true,
            );
        }
    } else {
        // No document set — load the most-recently-updated document
        const docs = await listDocuments();
        if (docs.length > 0) {
            const doc = docs[0];
            currentDocumentId.set(doc.id);
            currentDocumentTitle.set(doc.title);
            captureUndoHistoryPolicyLoaded(doc);

            const resolved = await drafts.refreshTabState(doc.id);
            currentDraftId.set(resolved?.draftId ?? null);
            if (resolved) {
                const loaded = await loadDocumentState(doc.id, resolved.draftId);
                const locked = drafts.lockedOf(resolved.draftId);
                return buildStateFromLoad(
                    loaded.snapshotStateJson,
                    loaded.eventsSince,
                    locked,
                    doc.persistHistory ?? true,
                );
            }
        }
    }

    // Blank editor (new installation).
    // Create an initial document + draft so the event log can record
    // edits immediately without waiting for the user to visit the library.
    // Pre-fill with sample content if the user hasn't seen the tutorial yet,
    // so they have real text to work with during the guided tour.
    const isFirstTime = !localStorage.getItem("quillium_tutorial_seen");
    const title = isFirstTime ? SAMPLE_DOCUMENT_TITLE : "Untitled";
    const content = isFirstTime ? SAMPLE_DOCUMENT_CONTENT : "";
    const persistHistory = getPersistUndoHistoryForNewDocuments();
    const newDocId = await createDocument(title, persistHistory);
    posthog.capture(
        "undo_history_policy_loaded",
        getNewDocumentUndoHistoryAnalytics(persistHistory),
    );
    // createDraft also creates the document's "Main" tab when none exists.
    const newDraftId = await createDraft(newDocId, "main");
    await drafts.refreshTabState(newDocId);
    const state = EditorState.create({
        doc: content,
        extensions: getExtensions({
            ...getExtensionOptions,
            persistHistory,
        }),
    });
    if (isFirstTime) {
        // Persist the initial content immediately so it survives app restarts
        // before the user makes any edits.
        const stateJson = JSON.stringify(state.toJSON(savedFields));
        await createSnapshot(newDraftId, stateJson, -1);
        await updateDocumentMeta(
            newDocId,
            title,
            getWordCount(content),
            content.slice(0, 200),
            "",
            content,
        );
    }
    // Set stores after snapshot is written to avoid a race where the
    // currentDocumentId subscription triggers loadDocument before the
    // snapshot exists, resulting in an empty editor.
    currentDocumentId.set(newDocId);
    currentDocumentTitle.set(title);
    currentDraftId.set(newDraftId);
    return state;
})();

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
let activeDraftWrite: Promise<void> = Promise.resolve();

function persistActiveDraft(tabId: string, draftId: string): Promise<void> {
    const write = activeDraftWrite.then(() => setActiveDraft(tabId, draftId));
    activeDraftWrite = write.catch(() => {});
    return write;
}

export async function loadDocument(id: string) {
    if (!$editorView) return;

    const gen = ++loadGeneration;

    // Clear stale pending selections from the previous document so they
    // can't be consumed by a new document whose annotations share the same IDs.
    annotationEventBus.clearPendingSelections();

    const [resolved, docMeta] = await Promise.all([
        drafts.refreshTabState(id),
        getDocumentMeta(id),
    ]);
    if (gen !== loadGeneration) return;
    if (docMeta) captureUndoHistoryPolicyLoaded(docMeta);
    currentDraftId.set(resolved?.draftId ?? null);
    lastPersistedEventId.set(-1);
    lastSavedAt.set(null);

    if (!resolved) {
        currentDocumentTitle.set("Untitled");
        const state = EditorState.create({
            extensions: getExtensions({
                ...getExtensionOptions,
                persistHistory: docMeta?.persistHistory ?? true,
            }),
        });
        $editorView.setState(state);
        return;
    }

    const loaded = await loadDocumentState(id, resolved.draftId);
    if (gen !== loadGeneration) return;
    currentDocumentTitle.set(docMeta?.title ?? "Untitled");

    // Seed lastPersistedEventId from the loaded state so named checkpoints
    // can be created immediately without requiring a new edit first.
    const latestEventId =
        loaded.eventsSince.length > 0
            ? loaded.eventsSince[loaded.eventsSince.length - 1].id
            : loaded.snapshotEventId >= 0
              ? loaded.snapshotEventId
              : -1;
    lastPersistedEventId.set(latestEventId);

    const locked = drafts.lockedOf(resolved.draftId);
    const state = buildStateFromLoad(
        loaded.snapshotStateJson,
        loaded.eventsSince,
        locked,
        docMeta?.persistHistory ?? true,
    );
    $editorView.setState(state);
    syncStoresToEditorState(state);
}

// ── Tab & draft-tree actions (#160) ─────────────────────────────

/**
 * Loads a draft of the current document into the editor view.
 * Shared by tab switching, draft switching, fork, and lock toggling.
 */
async function switchToDraft(tabId: string, draftId: string): Promise<void> {
    const docId = get(currentDocumentId);
    if (!docId || !$editorView) return;

    const gen = ++loadGeneration;
    await flushPendingPersist();
    if (gen !== loadGeneration || get(currentDocumentId) !== docId || get(currentTabId) !== tabId) {
        return;
    }

    const [loaded, docMeta] = await Promise.all([
        loadDocumentState(docId, draftId),
        getDocumentMeta(docId),
    ]);
    if (gen !== loadGeneration || get(currentDocumentId) !== docId || get(currentTabId) !== tabId) {
        return;
    }
    const latestEventId =
        loaded.eventsSince.length > 0
            ? loaded.eventsSince[loaded.eventsSince.length - 1].id
            : loaded.snapshotEventId >= 0
              ? loaded.snapshotEventId
              : -1;
    const locked = drafts.lockedOf(draftId);
    const state = buildStateFromLoad(
        loaded.snapshotStateJson,
        loaded.eventsSince,
        locked,
        docMeta?.persistHistory ?? true,
    );

    // Commit the tab/draft pointer only after its state is ready and this is
    // still the newest request. That keeps an older, slower load from changing
    // identity while a newer draft owns the visible editor.
    await persistActiveDraft(tabId, draftId);
    // Active-draft writes are serialized. Once this request reaches the commit
    // queue, finish its same-tab UI commit even if a newer load started; that
    // newer request will commit after this one, while a failed newer load
    // leaves the last successfully persisted draft and editor state aligned.
    if (get(currentDocumentId) !== docId || get(currentTabId) !== tabId) {
        return;
    }
    annotationEventBus.clearPendingSelections();
    currentDraftId.set(draftId);
    lastPersistedEventId.set(-1);
    lastSavedAt.set(null);
    lastPersistedEventId.set(latestEventId);

    $editorView.setState(state);
    // EditorView.setState() does not emit an update event. Refresh every Svelte
    // mirror now so annotations, AI context, selections, and stats cannot leak
    // from the tab that was previously open.
    syncStoresToEditorState(state);
}

/**
 * Serializes a draft's current state to seed a new draft: the live view if
 * it's the open draft, otherwise rebuilt from its snapshot + events.
 */
async function seedStateJson(sourceDraftId: string): Promise<string> {
    const view = $editorView;
    if (view && sourceDraftId === get(currentDraftId)) {
        return JSON.stringify(view.state.toJSON(savedFields));
    }
    const docId = get(currentDocumentId);
    const [loaded, docMeta] = await Promise.all([
        loadDocumentState(docId ?? "", sourceDraftId),
        docId ? getDocumentMeta(docId) : Promise.resolve(null),
    ]);
    const sourceState = buildStateFromLoad(
        loaded.snapshotStateJson,
        loaded.eventsSince,
        false,
        docMeta?.persistHistory ?? true,
    );
    return JSON.stringify(sourceState.toJSON(savedFields));
}

onMount(() => {
    fromSave.then((state) => {
        $editorView = new EditorView({
            state,
            parent: element,
        });
        syncStoresToEditorState(state);
        loadUserDictionary();
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
            // Register the initial document so other windows know it's open here.
            if (id) registerOpenDoc(id, windowLabel).catch(console.error);
            return; // skip loadDocument — fromSave already handles the initial value
        }
        // Deregister the previous document, register the new one.
        deregisterOpenDoc(windowLabel).catch(console.error);
        if (id) {
            registerOpenDoc(id, windowLabel).catch(console.error);
            fromSave.then(() => loadDocument(id));
        }
    });

    return () => {
        unsubscribe();
        deregisterOpenDoc(windowLabel).catch(console.error);
    };
});
</script>

<div class="w-full h-full overflow-y-auto relative">
    <div class="sticky top-4 z-50 flex flex-col items-center gap-2 pointer-events-none">
        <div class="pointer-events-auto">
            <DocumentTitleBar bind:this={titleBar} />
        </div>
    </div>

    {#await fromSave then}
        <DocumentTabs
            tabs={drafts.tabs}
            activeTabId={$currentTabId}
            ontabselect={(id) => drafts.handleTabSelect(id)}
            ontabcreate={() => drafts.handleTabCreate()}
            ontabrename={(id, label) => drafts.handleTabRename(id, label)}
            ontabdelete={(id) => drafts.handleTabDelete(id)}
            ontabreorder={(ids) => drafts.handleTabReorder(ids)}
        />

        <!-- Draft tree for the active tab — hugs the document's left edge,
             hidden on viewports too narrow to fit beside it. -->
        {#if drafts.tabDrafts.length > 0}
            <div class="sticky top-24 z-30 h-0 pointer-events-none max-[1280px]:hidden">
                <div
                    class="pointer-events-auto absolute w-48"
                    style="right: calc(50% + 408px + 1rem)"
                >
                    <DraftTreePanel
                        drafts={drafts.tabDrafts}
                        activeDraftId={$currentDraftId}
                        ondraftselect={(id) => drafts.handleDraftSelect(id)}
                        ondraftiterate={(id) => drafts.handleDraftIterate(id)}
                        ondraftbranch={(id) => drafts.handleDraftBranch(id)}
                        ondraftrename={(id, label) => drafts.handleDraftRename(id, label)}
                        ondraftdelete={(id) => drafts.handleDraftDelete(id)}
                        ontogglelock={(id, locked) => drafts.handleDraftToggleLock(id, locked)}
                    />
                </div>
            </div>
        {/if}

        {#if drafts.pendingDelete}
            <DraftDeleteModal
                label={drafts.pendingDelete.label}
                descendants={drafts.pendingDelete.descendants}
                onorphan={() => drafts.handleDeleteOrphan(drafts.pendingDelete!.id)}
                oncascade={() => drafts.handleDeleteCascade(drafts.pendingDelete!.id)}
                oncancel={() => (drafts.pendingDelete = null)}
            />
        {/if}

        <!--
            Document width is fluid below 816px (shrinks to fit narrow
            tablet/phone webviews) but capped at 816px on desktop, so the
            desktop layout is byte-for-byte identical to the previous
            `w-[816px]`. The mx-3 horizontal inset only has an effect once
            the viewport is narrower than 816px + margins; on desktop the
            max-w cap wins and mx-auto centers it unchanged.
            Top-left corner is square so the tab strip sits flush (#160).
        -->
        <div
            id="editor-document"
            class="mx-auto w-full max-w-[816px] min-h-[calc(100vh-4rem)] mb-12 bg-white rounded-tr-lg rounded-b-lg shadow-xl py-3 px-1 max-[840px]:mx-3 max-[840px]:w-auto"
        >
            {#if isLocked}
                <!-- Lock notice lives inside the page, like a suggestion-mode strip. -->
                <div class="mx-2 mb-2 flex items-center gap-2 rounded-md border border-amber-200/70 bg-amber-50/80 px-3 py-1.5 text-[11px] text-amber-900/70">
                    <LockIcon size={11} class="shrink-0 text-amber-700/60" />
                    <span class="flex-1 min-w-0 truncate">{currentIsSuperseded ? "This is an older version." : "This draft is locked."}</span>
                    <button
                        onclick={() => currentDraft && drafts.handleDraftToggleLock(currentDraft.id, false)}
                        class="shrink-0 font-medium hover:text-amber-950 transition-colors"
                    >Edit anyway</button>
                    <span class="shrink-0 w-px h-3 bg-amber-900/15"></span>
                    <button
                        onclick={() => currentDraft && drafts.handleDraftBranch(currentDraft.id)}
                        disabled={drafts.forking}
                        class="shrink-0 flex items-center gap-1 font-medium hover:text-amber-950 transition-colors disabled:opacity-40"
                    >
                        <GitBranchIcon size={11} />
                        <span>New take</span>
                    </button>
                </div>
            {/if}
            <div bind:this={element}></div>
        </div>
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
