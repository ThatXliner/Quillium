<script lang="ts">
/**
 * Revision.svelte — Displays a single revision annotation card
 * with multiple named versions, a textarea for quick inline editing,
 * and actions to create/delete versions or expand into a full-screen
 * modal for deep editing (nested annotations, rich undo history).
 *
 * Props:
 *   - revision: Annotation<"revision"> — the annotation data
 *   - isActive: boolean — whether this card is currently selected
 *   - view: EditorView — the parent CodeMirror editor
 *   - remove: () => void — callback to delete this annotation
 *   - updateThread: (thread: ThreadType) => void — callback to
 *     replace the thread array
 *
 * Inline editor surface:
 *   A full CodeMirror EditorView mounted inside a host <div>.
 *   history: false — undo/redo are delegated to the parent view
 *   via makeParentUndoKeymap (Mod-z flushes then undoes in parent).
 *   Version switches destroy and recreate the nested EditorView.
 *   outward-only sync: every docChanged or annotation-changed transaction
 *   calls syncVersionToParent; the nested view never reads back from the
 *   parent annotation field reactively (only reloads on external undo/redo).
 *
 *   See ARCHITECTURE.md §Nested Editors for the full rationale.
 *
 * Modal surface:
 *   Full CodeMirror EditorView pushed onto modalStack. Handles deep
 *   editing, nested annotations, and infinite nesting.
 *
 * Stores:
 *   - annotationUiEvent (read): boundary nudge, nested-open command,
 *     focus request, pending selection
 *   - modalStack (write): pushes a revision modal entry
 *
 * Parent: Annotations.svelte
 * Children: Thread.svelte
 */
import { EditorView } from "@codemirror/view";
import { ChevronDown, ChevronUp, Maximize2, PlusIcon, Trash2, X } from "lucide-svelte";
import { onDestroy, tick } from "svelte";
import { slide } from "svelte/transition";
import { cubicOut } from "svelte/easing";
import {
    annotationsChanged,
    createNewRevision,
    deleteRevisionVersion,
    setActiveRevisionVersion,
    updateRevisionVersionLabel,
    type Annotation,
    type Thread as ThreadType,
} from ".";
import { versionText } from "./models";
import {
    createInlineVersionState,
    previewVersionText,
    syncVersionToParent,
} from "./nestedEditor";
import Kbd from "$lib/ui/Kbd.svelte";

import { annotationUiEvent, modalStack } from "$lib/stores";
import { appSettings } from "$lib/settings.svelte";
import Thread from "./Thread.svelte";
import posthog from "$lib/posthog";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

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

const thread = $derived(revision.thread);
const activeVersion = $derived(revision.versions[revision.currentlySelected]);

let isEditorOpen = $state(false);
let userClosedEditor = false;
let nestedEditorHost = $state<HTMLDivElement | undefined>(undefined);
// Plain (non-reactive) variables — must NOT be $state to avoid feedback loops.
let nestedView: EditorView | undefined;
let loadedRevisionId = -1;
let loadedVersionIndex = -1;
let loadedVersionText = "";
// Set to true while we're pushing text outward so the reactive text dep
// doesn't spuriously recreate the inline editor on our own syncs.
let isSyncingToParent = false;
const nestedViewRef: { current: EditorView | undefined } = { current: undefined };

// Auto-open the inline editor when this revision becomes active,
// unless the user explicitly closed it or the setting is disabled.
$effect(() => {
    if (isActive) {
        if (!userClosedEditor && appSettings.showNestedEditor) isEditorOpen = true;
    } else {
        isEditorOpen = false;
        userClosedEditor = false;
    }
});

// Lifecycle effect: create/recreate/destroy the inline CodeMirror EditorView.
//
// Reactive deps tracked by Svelte:
//   - isEditorOpen, nestedEditorHost  — visibility / mount point
//   - revision.id, revision.currentlySelected  — structural version change
//   - revision.versions[targetVersion] — content change from external edits
//     (e.g. parent undo/redo). Self-originated syncs are guarded by the
//     isSyncingToParent flag so they don't recreate the editor.
$effect(() => {
    if (!isEditorOpen || !nestedEditorHost) {
        nestedView?.destroy();
        nestedView = undefined;
        nestedViewRef.current = undefined;
        loadedRevisionId = -1;
        loadedVersionIndex = -1;
        loadedVersionText = "";
        return;
    }

    const targetVersion = revision.currentlySelected;
    const targetId = revision.id;
    const version = revision.versions[targetVersion];
    const currentText = version ? versionText(version) : "";

    const sameVersion = loadedRevisionId === targetId && loadedVersionIndex === targetVersion;
    const textChangedExternally = sameVersion && currentText !== loadedVersionText && !isSyncingToParent;

    if (sameVersion && !textChangedExternally) {
        return; // same version, no external text change — don't recreate
    }

    nestedView?.destroy();
    nestedViewRef.current = undefined;

    if (!version) return;

    const editorState = createInlineVersionState(
        version,
        (update) => {
            if (update.docChanged || annotationsChanged(update)) {
                isSyncingToParent = true;
                syncVersionToParent(update.view, view, targetId, targetVersion);
                loadedVersionText = update.view.state.doc.toString();
                isSyncingToParent = false;
            }
        },
        view,
        targetId,
        targetVersion,
        nestedViewRef,
    );

    nestedView = new EditorView({ state: editorState, parent: nestedEditorHost });
    nestedViewRef.current = nestedView;
    loadedRevisionId = targetId;
    loadedVersionIndex = targetVersion;
    loadedVersionText = currentText;
});

// Label editing state
let editingLabelIndex = $state<number | null>(null);
let labelInputValue = $state("");
let labelInputEl = $state<HTMLInputElement | undefined>(undefined);

function startLabelEdit(i: number) {
    editingLabelIndex = i;
    labelInputValue = revision.versions[i]?.label ?? "";
    tick().then(() => labelInputEl?.focus());
}

function commitLabelEdit() {
    if (editingLabelIndex === null) return;
    const trimmed = labelInputValue.trim();
    view.dispatch(
        updateRevisionVersionLabel(
            view.state,
            revision.id,
            editingLabelIndex,
            trimmed || undefined,
        ),
    );
    editingLabelIndex = null;
}

function cancelLabelEdit() {
    editingLabelIndex = null;
}

// Boundary nudge
let showBoundaryHint = $state(false);
let boundaryHintTimeout: ReturnType<typeof setTimeout> | undefined;
let lastBoundaryNudgeToken = 0;

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

// Cmd-Alt-K / Cmd-Alt-M inside the main doc while cursor is in a
// revision range → open the modal and forward the pending command.
let lastOpenNestedEditorToken = 0;

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

// Click inside revision's atomic range in the main doc → focus the
// textarea at the relative position (or open the modal if disabled).
let lastFocusRequestToken = 0;

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
    const relPos = event.relativePos;
    if (appSettings.showNestedEditor) {
        const focusEditor = () => {
            if (nestedView) {
                nestedView.focus();
                const docLen = nestedView.state.doc.length;
                const safePos = Math.min(relPos, docLen);
                nestedView.dispatch({ selection: { anchor: safePos } });
            }
        };
        if (isEditorOpen && nestedView) {
            focusEditor();
        } else {
            userClosedEditor = false;
            isEditorOpen = true;
            tick().then(focusEditor);
        }
    } else {
        modalStack.push({
            type: "revision",
            revisionId: revision.id,
            parentView: view,
            label: activeVersion ? previewVersionText(activeVersion) : "Revision",
            pendingNestedCommand: { type: "cursor", selectionFrom: relPos, selectionTo: relPos },
        });
    }
});

// Mod-Enter from anywhere on this card → create a new version.
let lastAddVersionToken = 0;

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

// Pending selection: select-all text in the textarea when a new
// revision is just created and the inline editor opens.
let lastNestedSelectionToken = 0;

$effect(() => {
    const event = $annotationUiEvent;
    if (
        !event ||
        event.token !== lastNestedSelectionToken ||
        event.type !== "pending-nested-editor-selection" ||
        event.annotationId !== revision.id ||
        !nestedView
    )
        return;
    lastNestedSelectionToken = event.token;
    const docLen = nestedView.state.doc.length;
    nestedView.dispatch({
        selection: {
            anchor: Math.min(event.from, docLen),
            head: Math.min(event.to, docLen),
        },
    });
    nestedView.focus();
});

onDestroy(() => {
    clearTimeout(boundaryHintTimeout);
    nestedView?.destroy();
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
    <div class="px-3 pb-2 flex flex-wrap items-center gap-1">
        {#each revision.versions as version, i}
            {@const versionActive = i === revision.currentlySelected}
            {@const isEditingThis = editingLabelIndex === i}
            <div class="inline-flex items-center rounded-md overflow-hidden
                {versionActive
                    ? 'bg-purple-500/80 ring-1 ring-purple-400/40'
                    : 'bg-white/60 ring-1 ring-purple-200/40'}">
                {#if isEditingThis}
                    <input
                        bind:this={labelInputEl}
                        bind:value={labelInputValue}
                        class="px-2 py-1 text-[11px] font-medium w-[100px] bg-transparent text-white outline-none placeholder-white/50"
                        placeholder="Version name…"
                        onblur={commitLabelEdit}
                        onkeydown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitLabelEdit(); }
                            else if (e.key === "Escape") { e.preventDefault(); cancelLabelEdit(); }
                        }}
                    />
                {:else}
                    <button
                        class="max-w-[120px] px-2 py-1 text-[11px] font-medium truncate transition-colors
                            {versionActive ? 'text-white' : 'text-black/65 hover:text-black/85'}"
                        disabled={versionActive}
                        title={versionActive ? "Double-click to rename" : (versionText(version) || "(empty)")}
                        onclick={() => {
                            if (!versionActive) {
                                view.dispatch(
                                    setActiveRevisionVersion(view.state, revision.id, i),
                                );
                            }
                            if (appSettings.showNestedEditor) {
                                userClosedEditor = false;
                                isEditorOpen = true;
                            }
                        }}
                        ondblclick={() => {
                            if (versionActive) startLabelEdit(i);
                        }}
                    >
                        {version.label ?? previewVersionText(version)}
                    </button>
                {/if}
                <button
                    class="pr-1.5 pl-0.5 py-1 transition-colors
                        {versionActive ? 'text-white/60 hover:text-white' : 'text-black/30 hover:text-red-500/70'}"
                    onclick={() => {
                        if (editingLabelIndex === i) cancelLabelEdit();
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
        {#if isActive && revision.versions.length > 1}
            <div class="ml-auto flex items-center gap-0.5 opacity-50">
                <Kbd keys={["Ctrl", "["]} />
                <Kbd keys={["Ctrl", "]"]} />
            </div>
        {/if}
    </div>

    <!-- Actions row -->
    <div class="px-3 pb-3 flex gap-1.5">
        <button
            class="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-purple-600/80
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
            title="Create a new version ({modKey}↵)"
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
            title={isEditorOpen ? "Hide editor" : "Open editor"}
        >
            {#if isEditorOpen}
                <ChevronUp size={10} />
            {:else}
                <ChevronDown size={10} />
            {/if}
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
                    userClosedEditor = false;
                    isEditorOpen = true;
                    tick().then(() => nestedView?.focus());
                }}
            >
                <span class="shrink-0 mt-px">↓</span>
                <span>Edit in the inline editor below.</span>
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

    <!-- Inline CodeMirror editor (collapsible) -->
    {#if isEditorOpen && appSettings.showNestedEditor}
        <div transition:slide={{ duration: 120, easing: cubicOut }} class="mx-3 mb-3 rounded-lg overflow-hidden ring-1 ring-white/40 bg-white/60">
            <div bind:this={nestedEditorHost} class="revision-inline-editor"></div>
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
    .revision-inline-editor {
        min-height: 220px;
    }
    .revision-inline-editor :global(.cm-editor) {
        height: 100%;
        min-height: 220px;
        font-size: 13px;
        font-family: inherit;
        line-height: 1.6;
        background: transparent;
    }
    .revision-inline-editor :global(.cm-scroller) {
        overflow-y: auto;
        padding: 8px 10px 12px 10px;
    }
    .revision-inline-editor :global(.cm-content) {
        padding: 0;
    }
</style>
