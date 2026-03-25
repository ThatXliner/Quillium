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
import { aiSettings, hasApiKey } from "$lib/ai/settings.svelte";
import { createModel } from "$lib/ai/provider";
import { generateText } from "ai";
import { Pencil, SparklesIcon, GitBranch, Lock, LockOpen } from "lucide-svelte";
import Kbd from "$lib/ui/Kbd.svelte";
import DraftStack from "./DraftStack.svelte";
import { forkDocument, getDocumentMeta, getDocumentChildren } from "$lib/db";
import { computeForkStateJson } from "./forkState";

// ── Local UI state ──────────────────────────────────────────────
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

let element = $state<HTMLDivElement>();
let titleEditing = $state(false);
let titleInputEl = $state<HTMLInputElement | undefined>();
let titleDraft = $state("");
let titleSuggesting = $state(false);
let forking = $state(false);
// Whether the current doc has a parent (it's a branch) — used to show DraftStack.
let hasParent = $state(false);
// Whether the current doc has children (non-leaf) — locked by default.
let hasChildren = $state(false);
// Temporarily unlocked for in-place editing; resets when navigating away.
let tempUnlocked = $state(false);

const isLocked = $derived(hasChildren && !tempUnlocked);

// Most recent leaf document in this draft tree — used as the "home" card.
let latestLeafDocId = $state<string | null>(null);
let latestLeafTitle = $state<string>("Latest draft");

async function findLatestLeaf(docId: string): Promise<string> {
    const children = await getDocumentChildren(docId);
    if (children.length === 0) return docId;
    // Follow the most recently created child recursively.
    const latest = children[children.length - 1];
    return findLatestLeaf(latest.id);
}

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
/**
 * Creates a new draft document branched from the current document,
 * seeded according to the user's draftForkMode setting, then navigates to it.
 */
async function forkDraft() {
    const docId = get(currentDocumentId);
    const view = $editorView;
    if (!docId || !view || forking) return;
    forking = true;

    try {
        const snapshotStateJson = computeForkStateJson(
            view.state,
            savedFields,
            getExtensions(getExtensionOptions),
            appSettings.draftForkMode,
        );

        const title = get(currentDocumentTitle);
        const result = await forkDocument(docId, null, title, snapshotStateJson);

        posthog.capture("draft_fork_created", { fork_mode: appSettings.draftForkMode });

        currentDocumentId.set(result.docId);
        currentDraftId.set(result.draftId);
        currentDocumentTitle.set(title);
        hasParent = true;
        hasChildren = false;
        tempUnlocked = false;
        await loadDocument(result.docId);
    } catch (e) {
        console.error("[forkDraft] failed:", e);
    } finally {
        forking = false;
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

        stats = computeWritingStats(doc, selText);
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

    // Clear stale pending selections from the previous document so they
    // can't be consumed by a new document whose annotations share the same IDs.
    annotationEventBus.clearPendingSelections();

    const draftId = await resolveActiveDraft(id);
    currentDraftId.set(draftId);
    lastPersistedEventId.set(-1);
    lastSavedAt.set(null);

    if (!draftId) {
        const state = EditorState.create({ extensions: getExtensions(getExtensionOptions) });
        $editorView.setState(state);
        return;
    }

    const loaded = await loadDocumentState(id, draftId);
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

    // Watch for document switches (e.g. navigating from library to a new/different doc).
    // fromSave only runs once at init, so we need to reload when currentDocumentId changes.
    async function refreshDocState(id: string) {
        const [meta, children] = await Promise.all([
            getDocumentMeta(id),
            getDocumentChildren(id),
        ]);
        hasParent = !!meta?.parentDocumentId;
        hasChildren = children.length > 0;
        if (children.length > 0) {
            // Find the tip (latest leaf) descending from this doc.
            const leaf = await findLatestLeaf(id).catch(() => id);
            if (leaf !== id) {
                latestLeafDocId = leaf;
                const leafMeta = await getDocumentMeta(leaf).catch(() => null);
                latestLeafTitle = leafMeta?.title ?? "Latest draft";
            } else {
                latestLeafDocId = null;
            }
        } else {
            latestLeafDocId = null;
        }
    }

    let initialised = false;
    const unsubscribe = currentDocumentId.subscribe((id) => {
        if (!initialised) {
            initialised = true;
            if (id) refreshDocState(id).catch(() => {});
            return;
        }
        if (id) {
            tempUnlocked = false;
            fromSave.then(() => setTimeout(() => loadDocument(id)));
            refreshDocState(id).catch(() => {});
        }
    });

    return () => {
        unsubscribe();
    };
});
</script>

<div class="w-full h-full overflow-y-auto relative">
    <div class="sticky top-4 z-50 flex flex-col items-center gap-2 pointer-events-none">
        <!-- New Draft button — absolutely pinned left, same height as the status bar (h-12) -->
        <div class="pointer-events-auto absolute left-4 top-0">
            <button
                onclick={forkDraft}
                disabled={forking}
                title="New Draft — branch from current document"
                aria-label="New Draft"
                class="flex items-center gap-2 px-4 h-12 rounded-lg text-sm font-medium
                       bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md
                       text-blue-600 hover:bg-blue-50/60 active:bg-blue-100/60
                       transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-white/30"
            >
                <GitBranch size={16} />
                {forking ? "Branching…" : "New Draft"}
            </button>
        </div>
        <div class="pointer-events-auto">
            <StatusBar {...stats} titleVisibility={appSettings.titleVisibility} titleForced={titleEditing}>
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
        <!--
            Outer wrapper shifts left when the home card is visible,
            making room without the editor card changing width.
        -->
        <div
            class="relative mx-auto mt-12 mb-12"
            style="
                width: 816px;
                transform: translateX({latestLeafDocId ? '-92px' : '0'});
                transition: transform 380ms cubic-bezier(0.34, 1.1, 0.64, 1);
            "
        >
            {#if $currentDocumentId}
                <DraftStack
                    currentDocId={$currentDocumentId}
                    onNavigate={(id) => { currentDocumentId.set(id); }}
                />
            {/if}

            <!-- Home card: slides in from the right when browsing an older draft -->
            <button
                onclick={() => { if (latestLeafDocId) currentDocumentId.set(latestLeafDocId); }}
                title="Return to latest draft"
                aria-label="Return to latest draft"
                class="absolute bg-white/70 rounded-lg shadow-lg cursor-pointer
                       border border-black/[0.06] backdrop-blur-sm
                       hover:bg-white/90 transition-colors"
                style="
                    top: 0; bottom: 0;
                    left: calc(100% + 16px);
                    width: 160px;
                    z-index: 0;
                    opacity: {latestLeafDocId ? 1 : 0};
                    pointer-events: {latestLeafDocId ? 'auto' : 'none'};
                    transform: translateX({latestLeafDocId ? '0' : '24px'});
                    transition: transform 380ms cubic-bezier(0.34, 1.1, 0.64, 1),
                                opacity 280ms ease;
                "
            >
                <span class="absolute top-3 left-3 text-[10px] font-medium text-black/35 select-none">
                    Latest draft
                </span>
                <span class="absolute bottom-3 left-3 right-3 text-[11px] font-medium text-black/50 truncate text-left select-none">
                    {latestLeafTitle}
                </span>
            </button>

            <div
                id="editor-document"
                class="relative z-10 min-h-[calc(100vh-4rem)] bg-white rounded-lg shadow-xl py-3 px-1"
                bind:this={element}
            ></div>

            <!-- Lock overlay: dark tint + small action bar, document stays readable -->
            <div
                class="absolute inset-0 z-20 rounded-lg pointer-events-none"
                style="
                    background: rgba(0,0,0,{isLocked ? 0.18 : 0});
                    transition: background 250ms ease;
                "
            ></div>
            {#if isLocked}
                <div class="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
                    <div class="flex items-center gap-2 px-3 py-2 rounded-full
                                bg-white/85 backdrop-blur-md border border-black/[0.08] shadow-lg">
                        <Lock size={11} class="text-black/40 shrink-0" />
                        <span class="text-[11px] text-black/50 font-medium">Older draft</span>
                        <div class="w-px h-3.5 bg-black/15 shrink-0"></div>
                        <button
                            onclick={() => { tempUnlocked = true; }}
                            class="flex items-center gap-1 text-[11px] font-medium text-black/55
                                   hover:text-black/80 transition-colors px-1"
                        >
                            <LockOpen size={11} />
                            Unlock to edit
                        </button>
                        <div class="w-px h-3.5 bg-black/15 shrink-0"></div>
                        <button
                            onclick={forkDraft}
                            disabled={forking}
                            class="flex items-center gap-1 text-[11px] font-medium text-blue-600
                                   hover:text-blue-800 transition-colors px-1 disabled:opacity-50"
                        >
                            <GitBranch size={11} />
                            {forking ? "Branching…" : "Branch from here"}
                        </button>
                    </div>
                </div>
            {/if}
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
