<script lang="ts">
import {
    createDocument,
    createDraft,
    createSnapshot,
    createTab,
    createTabDraft,
    deleteDraft,
    deleteTab,
    deregisterOpenDoc,
    forkDraft,
    getActiveDraft,
    getActiveTab,
    getDocumentMeta,
    listDocuments,
    listTabDrafts,
    listTabs,
    loadDocumentState,
    registerOpenDoc,
    renameDraft,
    renameTab,
    restoreDraft,
    restoreTab,
    setActiveDraft,
    setActiveTab,
    setDraftLocked,
    updateDocumentMeta,
} from "$lib/db";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import posthog from "$lib/posthog";
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
import { createModel } from "$lib/ai/provider";
import {
    aiSettings,
    ensureApiKeyLoaded,
    getAiAbortSignal,
    hasApiKey,
    setAiProcessing,
} from "$lib/ai/settings.svelte";
import type { DraftMeta, EventRecord, TabMeta } from "$lib/db/types";
import { appSettings } from "$lib/settings.svelte";
import Kbd from "$lib/ui/Kbd.svelte";
import type { ViewUpdate } from "@codemirror/view";
import { generateText } from "ai";
import { GitBranchIcon, LockIcon, Pencil, SparklesIcon } from "lucide-svelte";
import { toast } from "svelte-sonner";
import DocumentTabs from "./DocumentTabs.svelte";
import DraftTreePanel from "./DraftTreePanel.svelte";
import StatusBar from "./StatusBar.svelte";
import type { ListenerOptions } from "./listeners";
import { flushMetaDebounces, flushPersistQueue } from "./listeners";
import { annotationField } from "./plugins/annotations";
import Annotations from "./plugins/annotations/Annotations.svelte";
import { getActiveAnnotation } from "./plugins/annotations/utils";
import { replayEvents } from "./replay";
import { SAMPLE_DOCUMENT_CONTENT, SAMPLE_DOCUMENT_TITLE } from "./sampleDocument";

// ── Multi-window ────────────────────────────────────────────────
const windowLabel = getCurrentWebviewWindow().label;

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
    const abortSignal = getAiAbortSignal();
    try {
        await ensureApiKeyLoaded();
        const model = createModel(aiSettings.provider, aiSettings.apiKey, aiSettings.model);
        const { text: suggested } = await generateText({
            model,
            abortSignal,
            prompt: `Suggest a single short, evocative title for this piece of writing. Reply with only the title — no quotes, no explanation, no punctuation at the end.\n\n${text.slice(0, 1000)}`,
        });
        const newTitle = suggested.trim().slice(0, 40);
        if (newTitle) {
            currentDocumentTitle.set(newTitle);
            const docId = get(currentDocumentId);
            if (docId) {
                const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
                updateDocumentMeta(docId, newTitle, wordCount, text.slice(0, 200), "[]").catch(
                    (e) => {
                        console.error(e);
                        posthog.captureException(e instanceof Error ? e : new Error(String(e)));
                    },
                );
            }
        }
    } catch (e) {
        if (!abortSignal.aborted) {
            console.error("[suggestTitle]", e);
            posthog.captureException(e instanceof Error ? e : new Error(String(e)));
        }
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
        updateDocumentMeta(docId, newTitle, wordCount, text.slice(0, 200), "[]").catch((e) => {
            console.error(e);
            posthog.captureException(e instanceof Error ? e : new Error(String(e)));
        });
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

// ── Tabs & draft tree state (#160) ──────────────────────────────
let tabs = $state<TabMeta[]>([]);
let tabDrafts = $state<DraftMeta[]>([]);
let forking = $state(false);

const currentDraft = $derived(tabDrafts.find((d) => d.id === $currentDraftId));
const isLocked = $derived(currentDraft?.locked ?? false);
// Locks come from branching or from the panel's manual lock — the banner
// copy explains whichever applies.
const currentHasBranches = $derived(tabDrafts.some((d) => d.parentDraftId === $currentDraftId));

/** Flushes queued events + debounced meta writes before switching context. */
async function flushPendingPersist(): Promise<void> {
    flushMetaDebounces();
    await flushPersistQueue();
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Resolves the active tab + draft for a document, creating a default
 * "Main" tab (with its root draft) for documents that have none yet.
 * Refreshes the local tab/draft-tree state and the currentTabId store.
 */
async function refreshTabState(docId: string): Promise<{ tabId: string; draftId: string } | null> {
    let tabList = await listTabs(docId);
    if (tabList.length === 0) {
        tabList = [await createTab(docId, "Main")];
    }
    const persistedTab = await getActiveTab(docId);
    const activeTab = tabList.find((t) => t.id === persistedTab) ?? tabList[0];

    let drafts = await listTabDrafts(activeTab.id);
    if (drafts.length === 0) {
        // Should not happen (createTab seeds a root draft; deleting the
        // last draft of a tab is rejected) — heal with a fresh tab.
        const fresh = await createTab(docId, "Main");
        tabList = [...tabList, fresh];
        drafts = await listTabDrafts(fresh.id);
        await setActiveTab(docId, fresh.id);
    }
    const persistedDraft = await getActiveDraft(activeTab.id);
    const activeDraft = drafts.find((d) => d.id === persistedDraft) ?? drafts[0];

    tabs = tabList;
    tabDrafts = drafts;
    currentTabId.set(activeTab.id);
    return activeDraft ? { tabId: activeTab.id, draftId: activeDraft.id } : null;
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
): EditorState {
    const extensions = readOnly
        ? [getExtensions(getExtensionOptions), EditorState.readOnly.of(true)]
        : getExtensions(getExtensionOptions);
    let base: EditorState;
    if (snapshotJson && snapshotJson !== "{}") {
        try {
            base = EditorState.fromJSON(JSON.parse(snapshotJson), { extensions }, savedFields);
        } catch {
            base = EditorState.create({ extensions });
        }
    } else {
        base = EditorState.create({ extensions });
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
        const doc = await getDocumentMeta(docId);
        if (doc) {
            currentDocumentTitle.set(doc.title);
        }
        const resolved = await refreshTabState(docId);
        currentDraftId.set(resolved?.draftId ?? null);
        if (resolved) {
            const loaded = await loadDocumentState(docId, resolved.draftId);
            const locked = tabDrafts.find((d) => d.id === resolved.draftId)?.locked ?? false;
            return buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince, locked);
        }
    } else {
        // No document set — load the most-recently-updated document
        const docs = await listDocuments();
        if (docs.length > 0) {
            const doc = docs[0];
            currentDocumentId.set(doc.id);
            currentDocumentTitle.set(doc.title);

            const resolved = await refreshTabState(doc.id);
            currentDraftId.set(resolved?.draftId ?? null);
            if (resolved) {
                const loaded = await loadDocumentState(doc.id, resolved.draftId);
                const locked = tabDrafts.find((d) => d.id === resolved.draftId)?.locked ?? false;
                return buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince, locked);
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
    const newDocId = await createDocument(title);
    // createDraft also creates the document's "Main" tab when none exists.
    const newDraftId = await createDraft(newDocId, "main");
    await refreshTabState(newDocId);
    const state = EditorState.create({
        doc: content,
        extensions: getExtensions(getExtensionOptions),
    });
    if (isFirstTime) {
        // Persist the initial content immediately so it survives app restarts
        // before the user makes any edits.
        const stateJson = JSON.stringify(state.toJSON(savedFields));
        await createSnapshot(newDraftId, stateJson, -1);
        await updateDocumentMeta(newDocId, title, getWordCount(content), content.slice(0, 200), "");
    }
    // Set stores after snapshot is written to avoid a race where the
    // currentDocumentId subscription triggers loadDocument before the
    // snapshot exists, resulting in an empty editor.
    currentDocumentId.set(newDocId);
    currentDocumentTitle.set(title);
    currentDraftId.set(newDraftId);
    return state;
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

    const resolved = await refreshTabState(id);
    if (gen !== loadGeneration) return;
    currentDraftId.set(resolved?.draftId ?? null);
    lastPersistedEventId.set(-1);
    lastSavedAt.set(null);

    if (!resolved) {
        currentDocumentTitle.set("Untitled");
        const state = EditorState.create({ extensions: getExtensions(getExtensionOptions) });
        $editorView.setState(state);
        return;
    }

    const [loaded, docMeta] = await Promise.all([
        loadDocumentState(id, resolved.draftId),
        getDocumentMeta(id),
    ]);
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

    const locked = tabDrafts.find((d) => d.id === resolved.draftId)?.locked ?? false;
    const state = buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince, locked);
    $editorView.setState(state);
    const text = state.doc.toString();
    writingStats.set({ words: getWordCount(text), chars: text.length, selWords: 0, selChars: 0 });
}

// ── Tab & draft-tree actions (#160) ─────────────────────────────

/**
 * Loads a draft of the current document into the editor view.
 * Shared by tab switching, draft switching, fork, and lock toggling.
 */
async function switchToDraft(draftId: string): Promise<void> {
    const docId = get(currentDocumentId);
    const tabId = get(currentTabId);
    if (!docId || !$editorView) return;

    const gen = ++loadGeneration;
    await flushPendingPersist();
    annotationEventBus.clearPendingSelections();
    if (tabId) await setActiveDraft(tabId, draftId);
    currentDraftId.set(draftId);
    lastPersistedEventId.set(-1);
    lastSavedAt.set(null);

    const loaded = await loadDocumentState(docId, draftId);
    if (gen !== loadGeneration) return;
    const latestEventId =
        loaded.eventsSince.length > 0
            ? loaded.eventsSince[loaded.eventsSince.length - 1].id
            : loaded.snapshotEventId >= 0
              ? loaded.snapshotEventId
              : -1;
    lastPersistedEventId.set(latestEventId);

    const locked = tabDrafts.find((d) => d.id === draftId)?.locked ?? false;
    const state = buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince, locked);
    $editorView.setState(state);
    const text = state.doc.toString();
    writingStats.set({ words: getWordCount(text), chars: text.length, selWords: 0, selChars: 0 });
}

async function handleTabSelect(tabId: string) {
    const docId = get(currentDocumentId);
    if (!docId || tabId === get(currentTabId)) return;
    await flushPendingPersist();
    await setActiveTab(docId, tabId);
    currentTabId.set(tabId);

    const drafts = await listTabDrafts(tabId);
    tabDrafts = drafts;
    const persisted = await getActiveDraft(tabId);
    const draft = drafts.find((d) => d.id === persisted) ?? drafts[0];
    if (draft) await switchToDraft(draft.id);
    posthog.capture("tab_switched");
}

async function handleTabCreate() {
    const docId = get(currentDocumentId);
    if (!docId) return;
    const tab = await createTab(docId, `Tab ${tabs.length + 1}`);
    tabs = [...tabs, tab];
    posthog.capture("tab_created");
    await handleTabSelect(tab.id);
}

async function handleTabRename(tabId: string, label: string) {
    await renameTab(tabId, label).catch(console.error);
    tabs = tabs.map((t) => (t.id === tabId ? { ...t, label } : t));
    posthog.capture("tab_renamed");
}

async function handleTabDelete(tabId: string) {
    if (tabs.length <= 1) return;
    const tab = tabs.find((t) => t.id === tabId);
    await flushPendingPersist();
    try {
        await deleteTab(tabId);
    } catch (e) {
        console.error("[Editor] delete tab failed", e);
        return;
    }
    const idx = tabs.findIndex((t) => t.id === tabId);
    tabs = tabs.filter((t) => t.id !== tabId);
    posthog.capture("tab_deleted");
    if (get(currentTabId) === tabId) {
        const next = tabs[Math.min(Math.max(idx, 0), tabs.length - 1)];
        currentTabId.set(null); // force handleTabSelect to run for the neighbour
        if (next) await handleTabSelect(next.id);
    }
    // Soft delete: the tab and all its drafts survive in the DB and can
    // come back from here or from the document's version history.
    toast(`Deleted tab “${tab?.label ?? "Tab"}”`, {
        duration: 8000,
        action: {
            label: "Undo",
            onClick: async () => {
                await restoreTab(tabId).catch(console.error);
                const docId = get(currentDocumentId);
                if (docId) tabs = await listTabs(docId);
                posthog.capture("tab_restored");
            },
        },
    });
}

async function handleDraftSelect(draftId: string) {
    if (draftId === get(currentDraftId)) return;
    await switchToDraft(draftId);
    posthog.capture("draft_switched");
}

/**
 * Branches a child draft off `parentDraftId`, seeded with that draft's
 * current state. The parent gets soft-locked so the branched-from text
 * stays stable underneath its children.
 */
async function handleDraftFork(parentDraftId: string) {
    const docId = get(currentDocumentId);
    const view = $editorView;
    if (!docId || !view || forking) return;
    forking = true;
    try {
        await flushPendingPersist();
        // Serialize the parent's state: the live view if it's the open
        // draft, otherwise rebuild it from its snapshot + events.
        let stateJson: string;
        if (parentDraftId === get(currentDraftId)) {
            stateJson = JSON.stringify(view.state.toJSON(savedFields));
        } else {
            const loaded = await loadDocumentState(docId, parentDraftId);
            const parentState = buildStateFromLoad(loaded.snapshotStateJson, loaded.eventsSince);
            stateJson = JSON.stringify(parentState.toJSON(savedFields));
        }
        const child = await forkDraft(parentDraftId, `v${tabDrafts.length}`, stateJson);
        const tabId = get(currentTabId);
        if (tabId) tabDrafts = await listTabDrafts(tabId);
        posthog.capture("draft_forked");
        await switchToDraft(child.id);
    } catch (e) {
        console.error("[Editor] fork draft failed", e);
        posthog.captureException(e instanceof Error ? e : new Error(String(e)));
    } finally {
        forking = false;
    }
}

async function handleDraftRename(draftId: string, label: string) {
    await renameDraft(draftId, label).catch(console.error);
    tabDrafts = tabDrafts.map((d) => (d.id === draftId ? { ...d, label } : d));
}

async function handleDraftDelete(draftId: string) {
    const draft = tabDrafts.find((d) => d.id === draftId);
    // If the open draft is being deleted, move to its parent (or any
    // sibling) first so the editor never points at a hidden draft.
    if (draftId === get(currentDraftId)) {
        const fallback =
            draft?.parentDraftId ?? tabDrafts.find((d) => d.id !== draftId)?.id ?? null;
        if (!fallback) return;
        await switchToDraft(fallback);
    } else {
        await flushPendingPersist();
    }
    try {
        await deleteDraft(draftId);
    } catch (e) {
        console.error("[Editor] delete draft failed", e);
        return;
    }
    await refreshDraftsAndCurrentLock();
    posthog.capture("draft_deleted");
    // Soft delete: the draft's text and history survive in the DB.
    toast(`Deleted draft “${draft?.label ?? "draft"}”`, {
        duration: 8000,
        action: {
            label: "Undo",
            onClick: async () => {
                await restoreDraft(draftId).catch(console.error);
                await refreshDraftsAndCurrentLock();
                posthog.capture("draft_restored");
            },
        },
    });
}

/**
 * Re-reads the active tab's drafts and rebuilds the editor state when the
 * open draft's lock changed underneath it (locks derive from live
 * children, so deleting/restoring a branch can lock or unlock its parent).
 */
async function refreshDraftsAndCurrentLock() {
    const tabId = get(currentTabId);
    if (!tabId) return;
    const wasLocked = isLocked;
    tabDrafts = await listTabDrafts(tabId);
    const current = get(currentDraftId);
    const nowLocked = tabDrafts.find((d) => d.id === current)?.locked ?? false;
    if (current && nowLocked !== wasLocked) {
        await switchToDraft(current);
    }
}

/**
 * "+ New draft": duplicates the open draft as a sibling at the same tree
 * level — a parallel take. Root drafts get a root sibling.
 */
async function handleNewDraft() {
    const docId = get(currentDocumentId);
    const tabId = get(currentTabId);
    const view = $editorView;
    const current = get(currentDraftId);
    if (!docId || !tabId || !view || !current || forking) return;
    forking = true;
    try {
        await flushPendingPersist();
        const stateJson = JSON.stringify(view.state.toJSON(savedFields));
        const parentId = tabDrafts.find((d) => d.id === current)?.parentDraftId ?? null;
        const label = `draft ${tabDrafts.length + 1}`;
        const sibling = parentId
            ? await forkDraft(parentId, label, stateJson)
            : await createTabDraft(tabId, label, stateJson);
        tabDrafts = await listTabDrafts(tabId);
        posthog.capture("draft_sibling_created");
        await switchToDraft(sibling.id);
    } catch (e) {
        console.error("[Editor] new draft failed", e);
        posthog.captureException(e instanceof Error ? e : new Error(String(e)));
    } finally {
        forking = false;
    }
}

/** Toggles the soft lock and rebuilds the editor state's read-only flag. */
async function handleDraftToggleLock(draftId: string, locked: boolean) {
    await setDraftLocked(draftId, locked).catch(console.error);
    tabDrafts = tabDrafts.map((d) => (d.id === draftId ? { ...d, locked } : d));
    posthog.capture(locked ? "draft_locked" : "draft_unlocked");
    if (draftId === get(currentDraftId)) {
        await switchToDraft(draftId);
    }
}

onMount(() => {
    fromSave.then((state) => {
        $editorView = new EditorView({
            state,
            parent: element,
        });
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
        <DocumentTabs
            {tabs}
            activeTabId={$currentTabId}
            ontabselect={handleTabSelect}
            ontabcreate={handleTabCreate}
            ontabrename={handleTabRename}
            ontabdelete={handleTabDelete}
        />

        <!-- Draft tree for the active tab — hugs the document's left edge
             (50% − half document width − panel width), hidden on viewports
             too narrow to fit beside it. -->
        {#if tabDrafts.length > 0}
            <div class="sticky top-24 z-30 h-0 pointer-events-none max-[1280px]:hidden">
                <div class="pointer-events-auto absolute w-44" style="left: calc(50% - 408px - 12rem)">
                    <DraftTreePanel
                        drafts={tabDrafts}
                        activeDraftId={$currentDraftId}
                        ondraftselect={handleDraftSelect}
                        ondraftfork={handleDraftFork}
                        ondraftrename={handleDraftRename}
                        ondraftdelete={handleDraftDelete}
                        ontogglelock={handleDraftToggleLock}
                        onnewdraft={handleNewDraft}
                    />
                </div>
            </div>
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
                <!-- Lock notice lives inside the page, like a suggestion-mode
                     strip — locks derive from having branches. -->
                <div class="mx-2 mb-2 flex items-center gap-2 rounded-md border border-amber-200/70 bg-amber-50/80 px-3 py-1.5 text-[11px] text-amber-900/70">
                    <LockIcon size={11} class="shrink-0 text-amber-700/60" />
                    <span class="flex-1 min-w-0 truncate">{currentHasBranches ? "This draft is locked because it has branches." : "This draft is locked."}</span>
                    <button
                        onclick={() => currentDraft && handleDraftToggleLock(currentDraft.id, false)}
                        class="shrink-0 font-medium hover:text-amber-950 transition-colors"
                    >Edit anyway</button>
                    <span class="shrink-0 w-px h-3 bg-amber-900/15"></span>
                    <button
                        onclick={() => currentDraft && handleDraftFork(currentDraft.id)}
                        disabled={forking}
                        class="shrink-0 flex items-center gap-1 font-medium hover:text-amber-950 transition-colors disabled:opacity-40"
                    >
                        <GitBranchIcon size={11} />
                        <span>New branch</span>
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
