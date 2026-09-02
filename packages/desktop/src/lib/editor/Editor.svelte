<script lang="ts">
import { logAppEvent } from "$lib/appLog";
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
import {
    appSettings,
    getPersistUndoHistoryForNewDocuments,
    persistSettings,
} from "$lib/settings.svelte";
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
import { isTauri } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { onMount, tick } from "svelte";
import { toast } from "svelte-sonner";
import { get } from "svelte/store";
import { getExtensions, savedFields } from "./extensions";
import { loadUserDictionary } from "./harper/harperLinter";
import { isCommentShortcut } from "./plugins/annotations/commentShortcut";
import "./plugins/annotations/default.css";
import "./harper/harper.css";
import type { EventRecord } from "$lib/db/types";
import { type PointerDragOptions, pointerDrag } from "$lib/ui/pointerDrag";
import type { ViewUpdate } from "@codemirror/view";
import {
    ClipboardPasteIcon,
    CopyIcon,
    GitBranchIcon,
    LockIcon,
    Maximize2Icon,
    MessageSquareIcon,
    Minimize2Icon,
    ScanTextIcon,
    ScissorsIcon,
} from "lucide-svelte";
import DocumentTabs from "./DocumentTabs.svelte";
import DocumentTitleBar from "./DocumentTitleBar.svelte";
import DraftDeleteModal from "./DraftDeleteModal.svelte";
import DraftTreePanel from "./DraftTreePanel.svelte";
import {
    DRAFT_PANEL_DEFAULT_WIDTH,
    DRAFT_PANEL_MIN_WIDTH,
    clampDraftPanelWidth,
    getDraftPanelMaxWidth,
    getDraftPanelWidthFromKey,
} from "./draftPanelResize";
import type { ListenerOptions } from "./listeners";
import { flushMetaDebounces, flushPersistQueue } from "./listeners";
import {
    annotationField,
    createCommentFromSelection,
    createRevisionFromSelection,
    versionGroupField,
} from "./plugins/annotations";
import Annotations from "./plugins/annotations/Annotations.svelte";
import { getActiveAnnotation } from "./plugins/annotations/utils";
import { reconstructState } from "./replay";
import { SAMPLE_DOCUMENT_CONTENT, SAMPLE_DOCUMENT_TITLE } from "./sampleDocument";
import { TabDraftController } from "./tabDrafts.svelte";

let {
    focusMode = false,
    focusControlsVisible = false,
}: {
    focusMode?: boolean;
    focusControlsVisible?: boolean;
} = $props();

// ── Multi-window ────────────────────────────────────────────────
const windowLabel = getCurrentWebviewWindow().label;

// ── Local UI state ──────────────────────────────────────────────
let element = $state<HTMLDivElement>();
let viewportWidth = $state(typeof window === "undefined" ? 1280 : window.innerWidth);
let resizingDraftPanel = $state(false);
let draftPanelDragStartWidth = 0;
let contextMenu = $state<{ x: number; y: number } | null>(null);
let contextMenuItem = $state<HTMLButtonElement>();
let nativeContextMenu: Menu | undefined;

const CONTEXT_MENU_WIDTH = 208;
const CONTEXT_MENU_HEIGHT = 286;
const CONTEXT_MENU_MARGIN = 8;
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const commentShortcutLabel = isMac ? "⌘⇧M" : "Ctrl+Shift+M";
const revisionShortcutLabel = isMac ? "⌘⌥K" : "Ctrl+Alt+K";

function closeContextMenu(): void {
    contextMenu = null;
}

function openFallbackContextMenu(x: number, y: number): void {
    const maxX = Math.max(
        CONTEXT_MENU_MARGIN,
        window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN,
    );
    const maxY = Math.max(
        CONTEXT_MENU_MARGIN,
        window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN,
    );
    contextMenu = {
        x: Math.min(Math.max(x, CONTEXT_MENU_MARGIN), maxX),
        y: Math.min(Math.max(y, CONTEXT_MENU_MARGIN), maxY),
    };
    tick().then(() => contextMenuItem?.focus());
}

async function showNativeContextMenu(): Promise<boolean> {
    if (!isTauri()) return false;
    try {
        nativeContextMenu ??= await Menu.new({
            items: [
                { item: "Cut", text: "Cut" },
                { item: "Copy", text: "Copy" },
                { item: "Paste", text: "Paste" },
                { item: "Separator" },
                { item: "SelectAll", text: "Select All" },
                { item: "Separator" },
                {
                    id: "editor-context-add-comment",
                    text: "Add Comment",
                    action: () => addCommentFromContextMenu(),
                },
                {
                    id: "editor-context-add-revision",
                    text: "Add Revision",
                    action: () => addRevisionFromContextMenu(),
                },
            ],
        });
        void logAppEvent("info", "editor-context-menu", "native context menu opened", {
            selectionLength:
                ($editorView?.state.selection.main.to ?? 0) -
                ($editorView?.state.selection.main.from ?? 0),
        });
        await nativeContextMenu.popup();
        return true;
    } catch (error) {
        void logAppEvent("warn", "editor-context-menu", "native context menu failed", {
            error,
        });
        return false;
    }
}

async function handleEditorContextMenu(event: MouseEvent): Promise<void> {
    const view = $editorView;
    if (!view || view.state.readOnly) return;

    const selection = view.state.selection.main;
    if (selection.empty) return;

    const clickedPosition = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (
        clickedPosition === null ||
        clickedPosition < selection.from ||
        clickedPosition > selection.to
    ) {
        return;
    }

    event.preventDefault();
    if (await showNativeContextMenu()) return;
    openFallbackContextMenu(event.clientX, event.clientY);
}

function editorContextMenu(node: HTMLElement): { destroy: () => void } {
    node.addEventListener("contextmenu", handleEditorContextMenu);
    return {
        destroy: () => node.removeEventListener("contextmenu", handleEditorContextMenu),
    };
}

function handleContextMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && contextMenu) {
        event.preventDefault();
        closeContextMenu();
        $editorView?.focus();
    }
}

function addCommentFromContextMenu(): void {
    const view = $editorView;
    closeContextMenu();
    if (view) createCommentFromSelection(view, "context-menu");
}

function addRevisionFromContextMenu(): void {
    const view = $editorView;
    closeContextMenu();
    if (view) createRevisionFromSelection(view);
}

type EditorEditCommand = "copy" | "cut" | "paste" | "selectAll";

async function runContextMenuEditCommand(command: EditorEditCommand): Promise<void> {
    const view = $editorView;
    closeContextMenu();
    if (!view) return;

    view.focus();
    const browserCommand = command === "selectAll" ? "selectAll" : command;
    if (document.execCommand(browserCommand)) {
        void logAppEvent("info", "editor-context-menu", "browser edit command handled", {
            command,
            path: "exec-command",
        });
        return;
    }

    // This path is only used in browser preview or if a native menu cannot be
    // created. The packaged app normally uses native Cut/Copy/Paste roles, which
    // preserve Quillium's annotation-aware clipboard events.
    try {
        const selection = view.state.selection.main;
        if (command === "selectAll") {
            view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        } else if (command === "paste") {
            const text = await navigator.clipboard.readText();
            view.dispatch({
                changes: { from: selection.from, to: selection.to, insert: text },
                selection: { anchor: selection.from + text.length },
                userEvent: "input.paste",
            });
        } else {
            const text = view.state.sliceDoc(selection.from, selection.to);
            await navigator.clipboard.writeText(text);
            if (command === "cut") {
                view.dispatch({
                    changes: { from: selection.from, to: selection.to, insert: "" },
                    selection: { anchor: selection.from },
                    userEvent: "delete.cut",
                });
            }
        }
        void logAppEvent("warn", "editor-context-menu", "edit command used plain-text fallback", {
            command,
        });
    } catch (error) {
        void logAppEvent("error", "editor-context-menu", "edit command failed", {
            command,
            error,
        });
        toast.error(`${command === "selectAll" ? "Select all" : command} failed`);
    }
}

function handleCommentShortcutKeydown(event: KeyboardEvent): void {
    if (!isCommentShortcut(event)) return;

    const view = $editorView;
    const selection = view?.state.selection.main;
    void logAppEvent("info", "comment-shortcut", "comment shortcut reached webview", {
        variant: "primary",
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
        composing: event.isComposing,
        editorMounted: Boolean(view),
        editorFocused: view?.hasFocus ?? false,
        selectionLength: selection ? selection.to - selection.from : 0,
        readOnly: view?.state.readOnly,
        targetInsideCodeMirror:
            event.target instanceof Element && Boolean(event.target.closest(".cm-editor")),
    });
}

const effectiveDraftPanelWidth = $derived(
    clampDraftPanelWidth(appSettings.draftPanelWidth, viewportWidth),
);
const draftPanelMaxWidth = $derived(getDraftPanelMaxWidth(viewportWidth));
const draftPanelIsFullWidth = $derived(effectiveDraftPanelWidth === draftPanelMaxWidth);

const draftPanelDragOptions: PointerDragOptions = {
    cursor: "ew-resize",
    onStart: () => {
        resizingDraftPanel = true;
        draftPanelDragStartWidth = effectiveDraftPanelWidth;
    },
    onMove: (dx) => {
        appSettings.draftPanelWidth = clampDraftPanelWidth(
            draftPanelDragStartWidth - dx,
            viewportWidth,
        );
    },
    onEnd: () => {
        resizingDraftPanel = false;
        persistSettings();
    },
};

function handleDraftPanelResizeKeydown(event: KeyboardEvent): void {
    const width = getDraftPanelWidthFromKey(
        event.key,
        effectiveDraftPanelWidth,
        viewportWidth,
        event.shiftKey,
    );
    if (width === null) return;
    event.preventDefault();
    appSettings.draftPanelWidth = width;
    persistSettings();
}

function resetDraftPanelWidth(): void {
    appSettings.draftPanelWidth = DRAFT_PANEL_DEFAULT_WIDTH;
    persistSettings();
}

function toggleDraftPanelFullWidth(): void {
    appSettings.draftPanelWidth = draftPanelIsFullWidth
        ? DRAFT_PANEL_DEFAULT_WIDTH
        : draftPanelMaxWidth;
    persistSettings();
}

$effect(() => {
    const updateViewportWidth = () => {
        viewportWidth = window.innerWidth;
    };
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
});

// Title editing lives in DocumentTitleBar; this delegate keeps the
// component's public API (used by +page.svelte for the Cmd+L shortcut).
let titleBar = $state<{ startEditing: () => void }>();
export function startEditingTitle() {
    titleBar?.startEditing();
}

export function createNewTab(): Promise<void> {
    return drafts.handleTabCreate();
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
    window.addEventListener("keydown", handleCommentShortcutKeydown, true);
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
        window.removeEventListener("keydown", handleCommentShortcutKeydown, true);
        unsubscribe();
        deregisterOpenDoc(windowLabel).catch(console.error);
        if (nativeContextMenu) {
            void nativeContextMenu.close().catch((error) => {
                void logAppEvent("warn", "editor-context-menu", "context menu cleanup failed", {
                    error,
                });
            });
            nativeContextMenu = undefined;
        }
    };
});
</script>

<svelte:window
    onkeydown={handleContextMenuKeydown}
    onresize={closeContextMenu}
    onscroll={closeContextMenu}
/>

<div class="editor-shell w-full h-full overflow-y-auto relative" class:focus-mode={focusMode}>
    <div
        class="focus-chrome sticky top-4 z-50 flex flex-col items-center gap-2 pointer-events-none"
        class:focus-chrome-visible={focusControlsVisible}
    >
        <div class="pointer-events-auto">
            <DocumentTitleBar bind:this={titleBar} />
        </div>
    </div>

    {#await fromSave then}
        <div class="focus-chrome" class:focus-chrome-visible={focusControlsVisible}>
            <DocumentTabs
                tabs={drafts.tabs}
                activeTabId={$currentTabId}
                ontabselect={(id) => drafts.handleTabSelect(id)}
                ontabcreate={() => drafts.handleTabCreate()}
                ontabrename={(id, label) => drafts.handleTabRename(id, label)}
                ontabdelete={(id) => drafts.handleTabDelete(id)}
                ontabreorder={(ids) => drafts.handleTabReorder(ids)}
            />
        </div>

        <!-- Draft tree for the active tab — hugs the document's left edge,
             hidden on viewports too narrow to fit beside it. -->
        {#if drafts.tabDrafts.length > 0}
            <div
                class="focus-chrome sticky top-24 z-30 h-0 pointer-events-none max-[1280px]:hidden"
                class:focus-chrome-visible={focusControlsVisible}
            >
                <div
                    data-annotation-occluder
                    class="pointer-events-auto absolute"
                    style="right: calc(50% + 408px + 1rem)"
                    style:width="{effectiveDraftPanelWidth}px"
                >
                    <div class="draft-panel-resize-controls" class:is-resizing={resizingDraftPanel}>
                        <div
                            role="slider"
                            tabindex="0"
                            aria-label="Resize drafts panel"
                            aria-orientation="horizontal"
                            aria-valuemin={DRAFT_PANEL_MIN_WIDTH}
                            aria-valuemax={draftPanelMaxWidth}
                            aria-valuenow={effectiveDraftPanelWidth}
                            aria-valuetext="{effectiveDraftPanelWidth} pixels"
                            title="Drag to resize. Use arrow keys for precise control; double-click to reset."
                            class="draft-panel-resize-handle"
                            use:pointerDrag={draftPanelDragOptions}
                            onkeydown={handleDraftPanelResizeKeydown}
                            ondblclick={resetDraftPanelWidth}
                        ></div>
                        <button
                            type="button"
                            aria-label={draftPanelIsFullWidth
                                ? "Restore default drafts panel width"
                                : "Expand drafts panel to available width"}
                            title={draftPanelIsFullWidth ? "Restore default width" : "Fill available width"}
                            class="draft-panel-full-width-button"
                            onpointerdown={(event) => event.stopPropagation()}
                            onclick={(event) => {
                                event.stopPropagation();
                                toggleDraftPanelFullWidth();
                            }}
                        >
                            {#if draftPanelIsFullWidth}
                                <Minimize2Icon size={12} />
                            {:else}
                                <Maximize2Icon size={12} />
                            {/if}
                        </button>
                    </div>
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
            class="editor-document mx-auto w-full max-w-[816px] min-h-[calc(100vh-4rem)] mb-12 bg-white rounded-tr-lg rounded-b-lg shadow-xl py-3 px-1 max-[840px]:mx-3 max-[840px]:w-auto"
            use:editorContextMenu
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

    {#if contextMenu}
        <button
            type="button"
            aria-label="Close editor menu"
            class="fixed inset-0 z-[89] cursor-default border-0 bg-transparent p-0"
            onclick={closeContextMenu}
        ></button>
        <div
            role="menu"
            aria-label="Editor actions"
            class="fixed z-[90] min-w-52 rounded-xl shadow-xl border border-white/40 bg-white/90 p-1 backdrop-blur-md"
            style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
        >
            <button
                bind:this={contextMenuItem}
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-black/70 transition-colors hover:bg-yellow-50 hover:text-black focus-visible:bg-yellow-50 focus-visible:text-black focus-visible:outline-none"
                onpointerdown={(event) => event.preventDefault()}
                onclick={() => void runContextMenuEditCommand("cut")}
            >
                <ScissorsIcon size={15} class="text-black/40" />
                <span class="flex-1">Cut</span>
                <span class="text-[11px] text-black/30">{isMac ? "⌘X" : "Ctrl+X"}</span>
            </button>
            <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-black/70 transition-colors hover:bg-yellow-50 hover:text-black focus-visible:bg-yellow-50 focus-visible:text-black focus-visible:outline-none"
                onpointerdown={(event) => event.preventDefault()}
                onclick={() => void runContextMenuEditCommand("copy")}
            >
                <CopyIcon size={15} class="text-black/40" />
                <span class="flex-1">Copy</span>
                <span class="text-[11px] text-black/30">{isMac ? "⌘C" : "Ctrl+C"}</span>
            </button>
            <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-black/70 transition-colors hover:bg-yellow-50 hover:text-black focus-visible:bg-yellow-50 focus-visible:text-black focus-visible:outline-none"
                onpointerdown={(event) => event.preventDefault()}
                onclick={() => void runContextMenuEditCommand("paste")}
            >
                <ClipboardPasteIcon size={15} class="text-black/40" />
                <span class="flex-1">Paste</span>
                <span class="text-[11px] text-black/30">{isMac ? "⌘V" : "Ctrl+V"}</span>
            </button>
            <div role="separator" class="mx-2 my-1 h-px bg-black/[0.07]"></div>
            <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-black/70 transition-colors hover:bg-yellow-50 hover:text-black focus-visible:bg-yellow-50 focus-visible:text-black focus-visible:outline-none"
                onpointerdown={(event) => event.preventDefault()}
                onclick={() => void runContextMenuEditCommand("selectAll")}
            >
                <ScanTextIcon size={15} class="text-black/40" />
                <span class="flex-1">Select All</span>
                <span class="text-[11px] text-black/30">{isMac ? "⌘A" : "Ctrl+A"}</span>
            </button>
            <div role="separator" class="mx-2 my-1 h-px bg-black/[0.07]"></div>
            <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-black/70 transition-colors hover:bg-yellow-50 hover:text-black focus-visible:bg-yellow-50 focus-visible:text-black focus-visible:outline-none"
                onpointerdown={(event) => event.preventDefault()}
                onclick={addCommentFromContextMenu}
            >
                <MessageSquareIcon size={15} class="text-amber-500" />
                <span class="flex-1">Add Comment</span>
                <span class="text-[11px] text-black/30">{commentShortcutLabel}</span>
            </button>
            <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-black/70 transition-colors hover:bg-yellow-50 hover:text-black focus-visible:bg-yellow-50 focus-visible:text-black focus-visible:outline-none"
                onpointerdown={(event) => event.preventDefault()}
                onclick={addRevisionFromContextMenu}
            >
                <GitBranchIcon size={15} class="text-violet-500" />
                <span class="flex-1">Add Revision</span>
                <span class="text-[11px] text-black/30">{revisionShortcutLabel}</span>
            </button>
        </div>
    {/if}


    <div class="focus-chrome" class:focus-chrome-visible={focusControlsVisible}>
        <Annotations />
    </div>
</div>

<style>
    .focus-chrome {
        transition:
            opacity 240ms ease,
            visibility 240ms ease;
    }
    .focus-mode .focus-chrome:not(.focus-chrome-visible) {
        visibility: hidden;
        opacity: 0;
        pointer-events: none;
    }
    .focus-mode .editor-document {
        min-height: calc(100vh - 2rem);
        margin-bottom: 1rem;
        border-radius: 0.5rem;
        box-shadow: 0 8px 30px rgb(0 0 0 / 8%);
        transition:
            min-height 240ms ease,
            margin 240ms ease,
            border-radius 240ms ease,
            box-shadow 240ms ease;
    }
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
    .draft-panel-resize-controls {
        position: absolute;
        inset-block: 0;
        left: -10px;
        z-index: 1;
        width: 12px;
        min-height: 3rem;
    }
    .draft-panel-resize-handle {
        position: absolute;
        inset: 0;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: ew-resize;
        touch-action: none;
    }
    .draft-panel-resize-handle::after {
        position: absolute;
        top: 50%;
        left: 5px;
        width: 2px;
        height: 2.5rem;
        border-radius: 9999px;
        background: rgb(0 0 0 / 12%);
        content: "";
        transform: translateY(-50%);
        transition:
            width 120ms ease,
            background-color 120ms ease;
    }
    .draft-panel-resize-controls:hover .draft-panel-resize-handle::after,
    .draft-panel-resize-handle:focus-visible::after,
    .draft-panel-resize-controls.is-resizing .draft-panel-resize-handle::after {
        width: 3px;
        background: rgb(217 119 6 / 65%);
    }
    .draft-panel-resize-handle:focus-visible {
        outline: 2px solid rgb(245 158 11 / 55%);
        outline-offset: 1px;
        border-radius: 9999px;
    }
    .draft-panel-full-width-button {
        position: absolute;
        bottom: 8px;
        left: -4px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 1px solid rgb(0 0 0 / 10%);
        border-radius: 9999px;
        background: white;
        box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
        color: rgb(0 0 0 / 35%);
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
        transition:
            opacity 180ms ease,
            color 180ms ease,
            background 180ms ease;
    }
    .draft-panel-resize-controls:hover .draft-panel-full-width-button,
    .draft-panel-resize-controls:focus-within .draft-panel-full-width-button {
        opacity: 1;
        pointer-events: auto;
    }
    .draft-panel-full-width-button:hover,
    .draft-panel-full-width-button:focus-visible {
        background: rgb(245 158 11 / 10%);
        color: rgb(180 83 9 / 80%);
    }
</style>
