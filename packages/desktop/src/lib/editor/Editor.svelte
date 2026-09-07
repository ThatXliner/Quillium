<script lang="ts">
import { logAppEvent } from "$lib/appLog";
import { fingerprintReviewContent } from "$lib/college/review";
import { applyCollegeToExistingTab, cancelCollegeTabPick, collegeWorkspace } from "$lib/college/workspace.svelte";
import { deregisterOpenDoc, registerOpenDoc } from "$lib/db";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { appSettings, updateSettings } from "$lib/settings.svelte";
import {
    activeAnnotation,
    annotations,
    currentDocumentId,
    currentDraftId,
    currentTabId,
    documentContent,
    editorView,
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
 * Svelte stores, and renders the writing surface. DocumentLoader owns loading.
 *
 * Key dependencies:
 *   - CodeMirror 6 (EditorState, EditorView) — core editing engine
 *   - documentLoader.ts — bootstrap, load cancellation, and draft commits
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
import { currentDraftLabel, currentTabLabel } from "$lib/stores";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isTauri } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { onMount, tick } from "svelte";
import { toast } from "svelte-sonner";
import { get } from "svelte/store";
import NameVersionPrompt from "./NameVersionPrompt.svelte";
import { loadUserDictionary } from "./harper/harperLinter";
import "./plugins/annotations/default.css";
import "./harper/harper.css";
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
import { DocumentLoader } from "./documentLoader";
import {
    DRAFT_PANEL_DEFAULT_WIDTH,
    DRAFT_PANEL_MIN_WIDTH,
    clampDraftPanelWidth,
    getDraftPanelMaxWidth,
    getDraftPanelWidthFromKey,
} from "./draftPanelResize";
import type { ListenerOptions } from "./listeners";
import {
    annotationField,
    createCommentFromSelection,
    createRevisionFromSelection,
    versionGroupField,
} from "./plugins/annotations";
import Annotations from "./plugins/annotations/Annotations.svelte";
import { getActiveAnnotation } from "./plugins/annotations/utils";

let {
    showSample = false,
    focusMode = false,
    focusControlsVisible = false,
}: {
    showSample?: boolean;
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
const commentShortcutLabel = isMac ? "⌘⇧C" : "Ctrl+Shift+C";
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

let draggedDraftPanelWidth = $state<number | null>(null);
const effectiveDraftPanelWidth = $derived(
    clampDraftPanelWidth(draggedDraftPanelWidth ?? appSettings.draftPanelWidth, viewportWidth),
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
        draggedDraftPanelWidth = clampDraftPanelWidth(
            draftPanelDragStartWidth - dx,
            viewportWidth,
        );
    },
    onEnd: () => {
        resizingDraftPanel = false;
        if (draggedDraftPanelWidth !== null) {
            updateSettings({ draftPanelWidth: draggedDraftPanelWidth });
            draggedDraftPanelWidth = null;
        }
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
    updateSettings({ draftPanelWidth: width });
}

function resetDraftPanelWidth(): void {
    updateSettings({ draftPanelWidth: DRAFT_PANEL_DEFAULT_WIDTH });
}

function toggleDraftPanelFullWidth(): void {
    updateSettings({
        draftPanelWidth: draftPanelIsFullWidth ? DRAFT_PANEL_DEFAULT_WIDTH : draftPanelMaxWidth,
    });
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

let view: EditorView | undefined;
const loader = new DocumentLoader(getExtensionOptions, ({ state }) => {
    if (view) {
        view.setState(state);
    } else {
        view = new EditorView({ state, parent: element });
        $editorView = view;
        loadUserDictionary();
        posthog.capture("app_session_started", {
            word_count: getWordCount(state.doc.toString()),
        });
    }
    syncStoresToEditorState(state);
});
let nameVersionTarget = $state<ReturnType<DocumentLoader["namedVersionTarget"]>>();
$effect(() =>
    appEventBus.on("name-version", () => {
        if (!nameVersionTarget) nameVersionTarget = loader.namedVersionTarget();
    }),
);

const drafts = loader.drafts;
const pickingCollegeTab = $derived(collegeWorkspace.setup !== null && collegeWorkspace.documentId === $currentDocumentId);
$effect(() => appEventBus.on("college-tabs-created", event => {
    void drafts.acceptCreatedCollegeTabs(event.documentId, event.tabs, event.selectFirst).catch(error => toast.error(String(error)));
}));
$effect(() => appEventBus.on("college-review-source", event => {
    void openCollegeReviewSource(event).catch((error) => toast.error(String(error)));
}));
$effect(() => {
    if (!pickingCollegeTab) return;
    void tick().then(() => document.querySelector<HTMLElement>('[data-college-target="true"][aria-selected="true"]')?.focus());
});
async function selectWorkspaceTab(id: string): Promise<void> {
    if (pickingCollegeTab) {
        if (collegeWorkspace.saving) return;
        const documentId = $currentDocumentId;
        if (await applyCollegeToExistingTab(id)) {
            if (documentId !== $currentDocumentId) return;
            await drafts.handleTabSelect(id);
            toast.success("Prompt applied. Your writing is unchanged.");
        }
    } else await drafts.handleTabSelect(id);
}

async function openCollegeReviewSource(event: Extract<import("$lib/events/appEventBus").AppEvent, { type: "college-review-source" }>): Promise<void> {
    const opened = await loader.navigateToDraft(
        event.sourceRef.documentId,
        event.sourceRef.tabId,
        event.sourceRef.draftId,
    );
    if (!opened || !$editorView) {
        toast.error("That related draft is no longer available.");
        return;
    }
    const targetView = $editorView;
    const text = targetView.state.doc.toString();
    if (event.citation && event.fingerprint) {
        const citationMatches =
            fingerprintReviewContent(text) === event.fingerprint &&
            event.citation.to <= text.length &&
            text.slice(event.citation.from, event.citation.to) === event.citation.quote;
        if (!citationMatches) {
            targetView.focus();
            toast.info("This draft changed after the review. The captured passage is no longer selected.");
            return;
        }
        targetView.dispatch({
            selection: { anchor: event.citation.from, head: event.citation.to },
            effects: EditorView.scrollIntoView(event.citation.from, { y: "center" }),
        });
    }
    targetView.focus();
}


const currentDraft = $derived(drafts.tabDrafts.find((d) => d.id === $currentDraftId));
$effect(() => {
    currentTabLabel.set(drafts.tabs.find((tab) => tab.id === $currentTabId)?.label ?? "");
    currentDraftLabel.set(currentDraft?.label ?? "");
});
const isLocked = $derived(currentDraft?.locked ?? false);
// A draft locks automatically when a newer iteration supersedes it (it has a
// live iteration after it in its run); otherwise the lock was manual.
const currentIsSuperseded = $derived(
    !!currentDraft && drafts.tabDrafts.some((d) => d.parentDraftId === currentDraft.id),
);

/** Reload after the debug panel writes a scenario. */
export async function reload(): Promise<void> {
    const documentId = get(currentDocumentId);
    if (documentId) await loader.load({ documentId });
}

onMount(() => {
    const unsubscribe = currentDocumentId.subscribe((id) => {
        deregisterOpenDoc(windowLabel).catch(console.error);
        if (id) registerOpenDoc(id, windowLabel).catch(console.error);
    });
    loader.start(showSample);

    return () => {
        unsubscribe();
        loader.dispose();
        view?.destroy();
        view = undefined;
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
    onkeydown={(event) => { if (event.key === "Escape" && pickingCollegeTab) { event.preventDefault(); cancelCollegeTabPick(); } else handleContextMenuKeydown(event); }}
    onresize={closeContextMenu}
    onscroll={closeContextMenu}
/>

<div class="editor-shell w-full h-full overflow-y-auto relative" class:focus-mode={focusMode}>
    <div
        class="focus-chrome sticky top-4 z-50 flex flex-col items-center gap-2 pointer-events-none"
        class:focus-chrome-visible={focusControlsVisible || pickingCollegeTab}
    >
        <div class="pointer-events-auto">
            <DocumentTitleBar bind:this={titleBar} />
        </div>
    </div>

    <div class="focus-chrome" class:focus-chrome-visible={focusControlsVisible || pickingCollegeTab}>
        {#if pickingCollegeTab}
            <div class="mx-auto mb-3 max-w-2xl rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" aria-label="Choose a tab for this prompt">
                <div class="flex items-center justify-between gap-3">
                    <p role="status">{collegeWorkspace.saving ? "Applying prompt…" : `Click a tab below for ${collegeWorkspace.setup?.prompts[0].label || "this prompt"}.`}</p>
                    <button class="underline disabled:opacity-40" disabled={collegeWorkspace.saving} onclick={cancelCollegeTabPick}>Cancel</button>
                </div>
                <p class="mt-1 text-xs">Your writing stays. This replaces any College prompt on the tab you choose.</p>
                {#if collegeWorkspace.error}<p role="alert" class="mt-2 text-red-700">{collegeWorkspace.error}</p>{/if}
            </div>
        {/if}
        <DocumentTabs
            tabs={drafts.tabs}
            readOnly={pickingCollegeTab}
            selectingTarget={pickingCollegeTab}
            activeTabId={$currentTabId}
            ontabselect={(id) => { void selectWorkspaceTab(id).catch(error => toast.error(String(error))); }}
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
            class:focus-chrome-visible={focusControlsVisible || pickingCollegeTab}
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


    <div class="focus-chrome" class:focus-chrome-visible={focusControlsVisible || pickingCollegeTab}>
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

{#if nameVersionTarget}
    <NameVersionPrompt
        save={nameVersionTarget.save}
        onclose={async () => {
            nameVersionTarget = undefined;
            await tick();
            view?.focus();
        }}
    />
{/if}
