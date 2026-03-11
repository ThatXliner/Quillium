<script lang="ts">
/**
 * Revision.svelte — Displays a single revision annotation card
 * with multiple named versions, a nested CodeMirror editor for
 * editing version content, and actions to create/delete versions
 * or expand into a full-screen modal.
 *
 * Props:
 *   - revision: Annotation<"revision"> — the annotation data
 *   - isActive: boolean — whether this card is currently selected
 *   - view: EditorView — the parent CodeMirror editor
 *   - remove: () => void — callback to delete this annotation
 *   - updateThread: (thread: ThreadType) => void — callback to
 *     replace the thread array
 *
 * Events emitted: none (delegates via callbacks and CodeMirror
 *   dispatch for version state updates)
 * Stores:
 *   - annotationUiEvent (read): receives one-shot events
 *     (boundary nudge, nested-open command, focus request,
 *     pending selection) emitted by annotation commands/plugins
 *   - modalStack (write): pushes a revision modal entry
 *
 * Parent: Annotations.svelte
 * Children: Thread.svelte (for user replies below the revision)
 *
 * Local state:
 *   - isEditorOpen: whether the inline nested editor is visible
 *   - recursiveEditor: a secondary CodeMirror instance editing
 *     the active version's content; syncs back to the annotation
 *     state on every keystroke via upsertVersionState()
 *   - showBoundaryHint: transient hint shown when the user tries
 *     to delete at the revision boundary in the main editor
 */
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { ChevronDown, ChevronUp, Maximize2, PlusIcon, Trash2, X } from "lucide-svelte";
import { onDestroy, tick } from "svelte";
import { slide } from "svelte/transition";
import { cubicOut } from "svelte/easing";
import {
    createNewRevision,
    deleteRevisionVersion,
    setActiveRevisionVersion,
    type Annotation,
    type Thread as ThreadType,
} from ".";
import { versionText, type VersionState } from "./models";
import { createVersionState, makeParentUndoKeymap, syncVersionToParent, previewVersionText } from "./nestedEditor";
import { getActiveAnnotation } from "./utils";
import { annotationUiEvent, modalStack } from "$lib/stores";
import { appSettings } from "$lib/settings.svelte";
import Thread from "./Thread.svelte";
import posthog from "$lib/posthog";

const {
    revision,
    isActive,
    view,
    remove,
    updateThread,
}: {
    revision: Annotation<"revision">;
    isActive: boolean;
    view: EditorView;
    remove: () => void;
    updateThread: (thread: ThreadType) => void;
} = $props();

// Derive thread, active version object, and its text content
const thread = $derived(revision.thread);
const activeVersion = $derived(revision.versions[revision.currentlySelected]);
const activeText = $derived(activeVersion ? versionText(activeVersion) : "");
let isEditorOpen = $state(false);
let userClosedEditor = false; // plain var — not reactive, just a gate

// Auto-open the nested editor when this revision becomes active,
// unless the user explicitly closed it or the setting is disabled.
// Reset the gate when the card loses focus.
$effect(() => {
    if (isActive) {
        if (!userClosedEditor && appSettings.showNestedEditor)
            isEditorOpen = true;
    } else {
        isEditorOpen = false;
        userClosedEditor = false;
    }
});

function openEditor() {
    userClosedEditor = false;
    isEditorOpen = true;
}
let recursiveEditorHost = $state<HTMLDivElement>();
let recursiveEditor = $state<EditorView | undefined>(undefined);
let nestedEditorHasActiveAnnotation = $state(false);
let isSyncingFromAnnotation = false;
let previousVersionId = revision.currentlySelected;
let previousVersionCount = revision.versions.length;
// Track the last text we pushed INTO the nested editor so we can
// detect when the parent annotation was changed externally (e.g.
// via undo) even when the new text equals what was there before.
let lastSyncedText: string | undefined = undefined;
let lastBoundaryNudgeToken = 0;
let lastOpenNestedEditorToken = 0;
let lastFocusRequestToken = 0;
let lastNestedSelectionToken = 0;
let lastAddVersionToken = 0;
let cursorArriving = $state(false);
let cursorArrivingTimeout: ReturnType<typeof setTimeout> | undefined;

// Boundary nudge: show a hint when the user presses delete at the edge
// of this revision's content in the main document.
let showBoundaryHint = $state(false);
let boundaryHintTimeout: ReturnType<typeof setTimeout> | undefined;

// Show a temporary hint when the boundary-nudge store fires
// for this revision (user pressed delete at the edge).
$effect(() => {
    const event = $annotationUiEvent;
    if (
        !event ||
        event.token === lastBoundaryNudgeToken ||
        event.type !== "revision-boundary-nudge" ||
        event.revisionId !== revision.id
    )
        return;
    lastBoundaryNudgeToken = event.token;
    showBoundaryHint = true;
    clearTimeout(boundaryHintTimeout);
    boundaryHintTimeout = setTimeout(() => {
        showBoundaryHint = false;
    }, 4000);
});

// When the user triggers a nested annotation command from inside
// this revision in the main document, open the modal (instead of
// the inline editor) and pass the command along so the modal
// runs it once the editor is ready.
$effect(() => {
    const event = $annotationUiEvent;
    if (
        !event ||
        event.token === lastOpenNestedEditorToken ||
        event.type !== "revision-open-nested-editor" ||
        event.command.revisionId !== revision.id
    )
        return;
    lastOpenNestedEditorToken = event.token;
    const cmd = event.command;
    modalStack.push({
        type: "revision",
        revisionId: revision.id,
        parentView: view,
        label: activeVersion ? previewVersionText(activeVersion) : "Revision",
        pendingNestedCommand: {
            type: cmd.type,
            selectionFrom: cmd.selectionFrom,
            selectionTo: cmd.selectionTo,
        },
    });
});

// When the main doc is clicked inside this revision's atomic range,
// focus the nested editor (opening it if needed), placing the cursor
// at the relative position within the version text.
// Falls back to opening the modal if the nested editor is disabled.
$effect(() => {
    const event = $annotationUiEvent;
    if (
        !event ||
        event.token === lastFocusRequestToken ||
        event.type !== "revision-focus-request" ||
        event.revisionId !== revision.id
    )
        return;
    lastFocusRequestToken = event.token;
    const req = event;
    const relPos = Math.min(req.relativePos, activeText.length);
    if (appSettings.showNestedEditor) {
        const placeCursor = (editor: EditorView) => {
            editor.dispatch({ selection: { anchor: relPos }, scrollIntoView: true });
            editor.focus();
            clearTimeout(cursorArrivingTimeout);
            cursorArriving = false;
            // Force reflow so removing the class takes effect before re-adding it,
            // ensuring the animation retriggers on every click.
            void recursiveEditorHost?.offsetWidth;
            cursorArriving = true;
            cursorArrivingTimeout = setTimeout(() => {
                cursorArriving = false;
            }, 650);
        };
        if (isEditorOpen && recursiveEditor) {
            placeCursor(recursiveEditor);
        } else {
            userClosedEditor = false;
            isEditorOpen = true;
            tick().then(() => {
                if (recursiveEditor) placeCursor(recursiveEditor);
            });
        }
    } else {
        modalStack.push({
            type: "revision",
            revisionId: revision.id,
            parentView: view,
            label: activeVersion ? previewVersionText(activeVersion) : "Revision",
            // relative pos will be used by modal to place cursor
            pendingNestedCommand: { type: "cursor", selectionFrom: relPos, selectionTo: relPos },
        });
    }
});

onDestroy(() => {
    clearTimeout(boundaryHintTimeout);
    clearTimeout(cursorArrivingTimeout);
});

/**
 * Serialize the current nested editor state and write it back
 * to the revision's version slot in the CodeMirror annotation
 * field, keeping the annotation and editor in sync.
 */
function upsertVersionState(currentEditor: EditorView, versionId = revision.currentlySelected) {
    // Track what we just pushed so syncRecursiveEditorToActiveVersion
    // doesn't mistake our own update for an external mutation.
    if (versionId === revision.currentlySelected) {
        lastSyncedText = currentEditor.state.doc.toString();
    }
    syncVersionToParent(currentEditor, view, revision.id, versionId);
}

/**
 * Mount a new nested CodeMirror editor inside this card,
 * restoring full state (doc + annotations + history) from the
 * version blob when available, or creating a fresh editor with
 * just the text content.
 */
function createRecursiveEditor(version: VersionState) {
    if (!recursiveEditorHost || recursiveEditor) return;
    const state = createVersionState(version, (update: ViewUpdate) => {
        if (!recursiveEditor || isSyncingFromAnnotation) return;
        nestedEditorHasActiveAnnotation = !!getActiveAnnotation(recursiveEditor.state);
        upsertVersionState(recursiveEditor);
    }, makeParentUndoKeymap(view));
    recursiveEditor = new EditorView({ state, parent: recursiveEditorHost });
    lastSyncedText = versionText(version);
    nestedEditorHasActiveAnnotation = !!getActiveAnnotation(recursiveEditor.state);

    // Apply pending selection if this annotation just created one.
    const event = $annotationUiEvent;
    if (
        event &&
        event.token !== lastNestedSelectionToken &&
        event.type === "pending-nested-editor-selection" &&
        event.annotationId === revision.id
    ) {
        lastNestedSelectionToken = event.token;
        const docLen = recursiveEditor.state.doc.length;
        const from = Math.min(event.from, docLen);
        const to = Math.min(event.to, docLen);
        recursiveEditor.dispatch({
            selection: { anchor: from, head: to },
            scrollIntoView: true,
        });
        recursiveEditor.focus();
    }
}

/** Tear down the nested CodeMirror editor and reset state. */
function destroyRecursiveEditor() {
    recursiveEditor?.destroy();
    recursiveEditor = undefined;
    nestedEditorHasActiveAnnotation = false;
}

/**
 * Swap the nested editor's content to match the currently
 * selected version. Saves the outgoing version's state first
 * if switching between versions.
 *
 * Also handles the case where the parent annotation was mutated
 * externally (e.g. the user edited the main doc or pressed undo)
 * so the nested editor's text is out of sync with activeText.
 */
function syncRecursiveEditorToActiveVersion(previousVersionId?: number, versionDeleted = false) {
    if (!recursiveEditor || !activeVersion) return;
    const versionChanged =
        previousVersionId !== undefined && previousVersionId !== revision.currentlySelected;
    const currentText = recursiveEditor.state.doc.toString();
    const targetText = activeText;

    // Detect external mutation: the annotation's version text was
    // changed (by main-doc edit or undo) without the nested editor
    // being the source. We compare against lastSyncedText rather
    // than the nested editor's current text, because after an undo
    // the two may coincidentally match even though the annotation
    // state changed underneath us.
    const externallyMutated =
        !versionChanged && lastSyncedText !== undefined && lastSyncedText !== targetText;

    // Nothing to do: same version, nested editor already has the right text.
    if (!versionChanged && !externallyMutated && currentText === targetText) return;

    // Save the current editor state back to whichever version we're leaving,
    // unless a version was just deleted (the previous index is stale/gone).
    if (versionChanged && !versionDeleted) {
        upsertVersionState(recursiveEditor, previousVersionId);
    }
    isSyncingFromAnnotation = true;
    if (versionChanged && recursiveEditorHost) {
        destroyRecursiveEditor();
        createRecursiveEditor(activeVersion);
        if (recursiveEditor) {
            const end = recursiveEditor.state.doc.length;
            recursiveEditor.dispatch({
                selection: { anchor: end },
                scrollIntoView: true,
            });
            recursiveEditor.focus();
        }
        isSyncingFromAnnotation = false;
        nestedEditorHasActiveAnnotation = !!(
            recursiveEditor && getActiveAnnotation(recursiveEditor.state)
        );
        return;
    }
    // Same version but text drifted (external edit or undo): reload state
    // from the annotation blob so history/cursor are consistent too.
    const nextState = createVersionState(activeVersion, (update: ViewUpdate) => {
        if (!recursiveEditor || isSyncingFromAnnotation) return;
        upsertVersionState(recursiveEditor);
    }, makeParentUndoKeymap(view));
    recursiveEditor.setState(nextState);
    lastSyncedText = targetText;
    isSyncingFromAnnotation = false;
    nestedEditorHasActiveAnnotation = !!getActiveAnnotation(recursiveEditor.state);
}

// Create or destroy the nested editor when the toggle changes.
$effect(() => {
    if (!isEditorOpen) {
        destroyRecursiveEditor();
        return;
    }
    tick().then(() => {
        if (!isEditorOpen || !activeVersion) return;
        createRecursiveEditor(activeVersion);
        syncRecursiveEditorToActiveVersion();
    });
});

// When the selected version changes while the editor is open,
// swap the nested editor's content to the new version.
$effect(() => {
    if (!recursiveEditor || !isEditorOpen) return;
    const prev = previousVersionId;
    const prevCount = previousVersionCount;
    previousVersionId = revision.currentlySelected;
    previousVersionCount = revision.versions.length;
    const versionDeleted = revision.versions.length < prevCount;
    syncRecursiveEditorToActiveVersion(prev !== revision.currentlySelected ? prev : undefined, versionDeleted);
});

// ⌘Enter when this revision is active → create a new version
$effect(() => {
    const event = $annotationUiEvent;
    if (
        !event ||
        event.token === lastAddVersionToken ||
        event.type !== "annotation-add-version" ||
        event.annotationId !== revision.id
    )
        return;
    lastAddVersionToken = event.token;
    posthog.capture("revision_version_created", { version_count: revision.versions.length });
    view.dispatch(createNewRevision(view.state, revision.id));
    tick().then(() => {
        if (appSettings.showNestedEditor) {
            userClosedEditor = false;
            isEditorOpen = true;
        }
    });
});

onDestroy(() => {
    destroyRecursiveEditor();
});
</script>

<div
    data-tutorial-role="revision-card"
    data-revision-id={revision.id}
    class="border rounded-[14px] transition-all duration-200
        {isActive
            ? 'bg-purple-50/90 border-purple-200/60 shadow-xl'
            : 'bg-purple-50/60 border-purple-200/40 shadow-lg opacity-90 hover:opacity-100'}"
    style="backdrop-filter: blur(12px); clip-path: inset(0 round 14px);"
>
    <!-- Header -->
    <div class="flex items-center justify-between px-3 pt-3 pb-2">
        <h3 class="text-[10px] font-semibold text-purple-600/70 uppercase tracking-wider">Revision</h3>
        <button
            class="p-1 rounded-md text-purple-400/50 hover:text-red-500/60 hover:bg-white/40 transition-colors"
            onclick={() => {
                posthog.capture("annotation_deleted", {
                    type: "revision",
                    version_count: revision.versions.length,
                });
                remove();
            }}
            title="Delete entire revision"
        >
            <Trash2 size={16} />
        </button>
    </div>

    <!-- Version pills -->
    <div class="px-3 pb-2 flex flex-wrap gap-1">
        {#each revision.versions as version, i}
            {@const versionActive = i === revision.currentlySelected}
            <div class="inline-flex items-center rounded-md overflow-hidden
                {versionActive
                    ? 'bg-purple-500/80 ring-1 ring-purple-400/40'
                    : 'bg-white/60 ring-1 ring-purple-200/40'}">
                <button
                    class="max-w-[120px] px-2 py-1 text-[11px] font-medium truncate transition-colors
                        {versionActive ? 'text-white' : 'text-black/65 hover:text-black/85'}"
                    disabled={versionActive}
                    title={versionText(version) || "(empty)"}
                    onclick={() => {
                        view.dispatch(
                            setActiveRevisionVersion(view.state, revision.id, i),
                        );
                    }}
                >
                    {version.label ?? previewVersionText(version)}
                </button>
                <button
                    class="pr-1.5 pl-0.5 py-1 transition-colors
                        {versionActive ? 'text-white/60 hover:text-white' : 'text-black/30 hover:text-red-500/70'}"
                    onclick={() => {
                        view.dispatch(
                            deleteRevisionVersion(view.state, revision.id, i),
                        );
                    }}
                    title={`Delete version ${i + 1}`}
                >
                    <X size={9} />
                </button>
            </div>
        {/each}
    </div>

    <!-- Actions row -->
    <div class="px-3 pb-3 flex gap-1.5">
        <button
            class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600/80
                bg-white/50 hover:bg-white/70 rounded-md ring-1 ring-purple-200/40 transition-colors"
            onclick={async () => {
                posthog.capture("revision_version_created", {
                    version_count: revision.versions.length,
                });
                view.dispatch(createNewRevision(view.state, revision.id));
                await tick();
                if (appSettings.showNestedEditor) {
                    userClosedEditor = false;
                    isEditorOpen = true;
                } else {
                    modalStack.push({
                        type: "revision",
                        revisionId: revision.id,
                        parentView: view,
                        label: activeVersion ? previewVersionText(activeVersion) : "Revision",
                    });
                }
            }}
            title="Create a new version"
        >
            <PlusIcon size={10} />
            <span>New version</span>
        </button>
        {#if appSettings.showNestedEditor}
        <button
            data-tutorial-action="toggle-nested-editor"
            data-revision-id={revision.id}
            class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md ring-1 transition-colors
                {isEditorOpen
                    ? 'text-purple-600/80 bg-purple-100/40 ring-purple-300/40 hover:bg-purple-100/60'
                    : 'text-purple-600/60 bg-white/50 ring-purple-200/40 hover:bg-white/70'}"
            onclick={() => {
                userClosedEditor = isEditorOpen;
                isEditorOpen = !isEditorOpen;
            }}
            title={isEditorOpen ? "Hide nested editor" : "Open nested editor"}
        >
            {#if isEditorOpen}
                <ChevronUp size={10} />
            {:else}
                <ChevronDown size={10} />
            {/if}
            <span>Nested editor</span>
        </button>
        {/if}
        <button
            data-tutorial-action="expand-revision-modal"
            data-revision-id={revision.id}
            class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600/60
                bg-white/50 hover:bg-white/70 rounded-md ring-1 ring-purple-200/40 transition-colors ml-auto"
            onclick={() => { modalStack.push({ type: "revision", revisionId: revision.id, parentView: view, label: activeVersion ? previewVersionText(activeVersion) : "Revision" }); }}
            title="Expand editor"
        >
            <Maximize2 size={10} />
        </button>
    </div>

    <!-- Boundary hint -->
    {#if showBoundaryHint}
        {#if appSettings.showNestedEditor}
            <button
                class="mx-3 mb-3 flex items-start gap-1.5 px-2 py-1.5 rounded-md w-[calc(100%-1.5rem)]
                    bg-purple-50/70 ring-1 ring-purple-200/50 text-[10px] text-purple-600/80 leading-snug
                    hover:bg-purple-100/60 transition-colors text-left"
                onclick={() => {
                    if (isEditorOpen && recursiveEditor) {
                        recursiveEditor.focus();
                    } else {
                        userClosedEditor = false;
                        isEditorOpen = true;
                    }
                }}
            >
                <span class="shrink-0 mt-px">↓</span>
                <span>Edit in the nested editor below.</span>
            </button>
        {:else}
            <button
                class="mx-3 mb-3 flex items-start gap-1.5 px-2 py-1.5 rounded-md w-[calc(100%-1.5rem)]
                    bg-purple-50/70 ring-1 ring-purple-200/50 text-[10px] text-purple-600/80 leading-snug
                    hover:bg-purple-100/60 transition-colors text-left"
                onclick={() => modalStack.push({ type: "revision", revisionId: revision.id, parentView: view, label: activeVersion ? previewVersionText(activeVersion) : "Revision" })}
            >
                <span class="shrink-0 mt-px">↗</span>
                <span>Open in the revision editor to edit at boundaries.</span>
            </button>
        {/if}
    {/if}

    <!-- Nested editor (collapsible) -->
    {#if isEditorOpen && appSettings.showNestedEditor}
        <div transition:slide={{ duration: 120, easing: cubicOut }} class="mx-3 mb-3 rounded-lg overflow-hidden ring-1 ring-white/40 bg-white/60">
            <div
                bind:this={recursiveEditorHost}
                class="revision-recursive-editor h-[220px] overflow-hidden"
                class:cursor-arriving={cursorArriving}
            ></div>
            {#if nestedEditorHasActiveAnnotation}
                <div transition:slide={{ duration: 100, easing: cubicOut }}
                    class="border-t border-purple-100/60 px-3 py-2 flex items-center justify-between gap-2">
                    <span class="text-[10px] text-purple-500/70">Annotation selected</span>
                    <button
                        class="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-purple-600/80
                            bg-purple-50 hover:bg-purple-100/60 rounded-md ring-1 ring-purple-200/50 transition-colors"
                        onclick={() => modalStack.push({ type: "revision", revisionId: revision.id, parentView: view, label: activeVersion ? previewVersionText(activeVersion) : "Revision" })}
                    >
                        <Maximize2 size={9} />
                        <span>View in modal</span>
                    </button>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Thread -->
    {#if thread.length > 0 || isActive}
        <div class="border-t border-black/[0.07] px-3 py-2.5">
            <Thread
                {thread}
                {updateThread}
                {view}
                annotationId={revision.id}
                previewOnly={!isActive}
                accentClass="text-purple-600/80 hover:text-purple-700"
                sendPillClass="bg-purple-500 text-white hover:bg-purple-600"
            />
        </div>
    {/if}
</div>


<style>
    .revision-recursive-editor :global(.cm-editor) {
        height: 220px;
        width: 100%;
        background: transparent;
    }

    .revision-recursive-editor :global(.cm-scroller) {
        overflow: auto;
        line-height: 1.6;
    }

    .revision-recursive-editor :global(.cm-content) {
        text-indent: 0;
        min-height: 100%;
        padding: 8px 10px 12px 10px;
        font-size: 13px;
    }

    .revision-recursive-editor :global(.cm-focused) {
        outline: none;
    }

    @keyframes focus-flash {
        0%   { background-color: rgba(254, 242, 205, 0.9); }
        70%  { background-color: rgba(254, 242, 205, 0.9); }
        100% { background-color: rgba(254, 242, 205, 0); }
    }

    .revision-recursive-editor.cursor-arriving {
        animation: focus-flash 0.6s ease-out both;
    }

</style>
