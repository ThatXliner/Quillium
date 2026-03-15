<script lang="ts">
/**
 * Revision.svelte — Displays a single revision annotation card
 * with multiple named versions, a nested CodeMirror editor for
 * editing version content, and actions to create/delete versions
 * or expand into a full-screen modal.
 *
 * Architecture: the nested editor is a direct viewport onto the
 * parent document's revision range. Edits in the nested editor
 * are translated to parent coordinates via translateAndDispatch()
 * and dispatched to the parent EditorView. External changes to
 * the revision range (undo, non-atomic typing) are pushed back
 * to the nested editor by the nestedEditorBridge ViewPlugin via
 * the registerNestedEditor registry.
 *
 * The nested editor is only destroyed/recreated on version switch.
 * All other changes (typing, undo) are applied as deltas.
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
    updateRevisionVersionLabel,
    type Annotation,
    type Thread as ThreadType,
} from ".";
import { registerNestedEditor } from ".";
import { versionText, type VersionState } from "./models";
import {
    createNestedEditorState,
    translateAndDispatch,
    flushAnnotationsToParent,
    previewVersionText,
} from "./nestedEditor";
import { getActiveAnnotation } from "./utils";
import { annotationUiEvent, modalStack } from "$lib/stores";
import { appSettings } from "$lib/settings.svelte";
import Thread from "./Thread.svelte";
import Kbd from "$lib/ui/Kbd.svelte";
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
const activeText = $derived(activeVersion ? versionText(activeVersion) : "");

let isEditorOpen = $state(false);
let userClosedEditor = false;

$effect(() => {
    if (isActive) {
        if (!userClosedEditor && appSettings.showNestedEditor) isEditorOpen = true;
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
let activeAnnotation = $state<Annotation<any> | undefined>(undefined);

// Track which version the nested editor was built for, so we know
// when to destroy/recreate (version switch) vs. when the bridge
// will handle it (undo/external edit).
let mountedVersionId = -1;
let unregisterNestedEditor: (() => void) | undefined;

let lastBoundaryNudgeToken = 0;
let lastOpenNestedEditorToken = 0;
let lastFocusRequestToken = 0;
let lastNestedSelectionToken = 0;
let lastAddVersionToken = 0;
let cursorArriving = $state(false);
let cursorArrivingTimeout: ReturnType<typeof setTimeout> | undefined;

let showBoundaryHint = $state(false);
let boundaryHintTimeout: ReturnType<typeof setTimeout> | undefined;

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
            pendingNestedCommand: { type: "cursor", selectionFrom: relPos, selectionTo: relPos },
        });
    }
});

/**
 * Mount a nested CodeMirror editor for the given version.
 * Registers it with the nestedEditorBridge so the parent can
 * push external changes (undo, non-atomic typing) directly.
 */
function createRecursiveEditor(version: VersionState) {
    if (!recursiveEditorHost || recursiveEditor) return;
    const state = createNestedEditorState(
        version,
        (update: ViewUpdate) => {
            if (!recursiveEditor) return;
            activeAnnotation = getActiveAnnotation(recursiveEditor.state);
            // Translate doc changes to parent coordinates and dispatch.
            translateAndDispatch(update, view, revision.id);
        },
        view,
        revision.id,
    );
    recursiveEditor = new EditorView({ state, parent: recursiveEditorHost });
    mountedVersionId = revision.currentlySelected;
    unregisterNestedEditor = registerNestedEditor(revision.id, recursiveEditor);
    activeAnnotation = getActiveAnnotation(recursiveEditor.state);

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

function destroyRecursiveEditor() {
    unregisterNestedEditor?.();
    unregisterNestedEditor = undefined;
    // Flush nested annotation state to parent before destroying.
    if (recursiveEditor) {
        flushAnnotationsToParent(recursiveEditor, view, revision.id, mountedVersionId);
    }
    recursiveEditor?.destroy();
    recursiveEditor = undefined;
    activeAnnotation = undefined;
    mountedVersionId = -1;
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
    });
});

// When the selected version changes, destroy and recreate.
// This is the ONLY case where we fully rebuild the nested editor.
// External text changes (undo, non-atomic typing) are handled by
// the nestedEditorBridge ViewPlugin pushing deltas directly.
$effect(() => {
    if (!recursiveEditor || !isEditorOpen) return;
    const currentVersionId = revision.currentlySelected;
    if (currentVersionId === mountedVersionId) return;

    // Version switched — flush outgoing, recreate for new version.
    destroyRecursiveEditor();
    tick().then(() => {
        if (!isEditorOpen || !activeVersion) return;
        createRecursiveEditor(activeVersion);
        if (recursiveEditor) {
            const end = recursiveEditor.state.doc.length;
            recursiveEditor.dispatch({
                selection: { anchor: end },
                scrollIntoView: true,
            });
            recursiveEditor.focus();
        }
    });
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
    clearTimeout(boundaryHintTimeout);
    clearTimeout(cursorArrivingTimeout);
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
            <Kbd keys={[modKey, "↵"]} />
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
            {#if !!activeAnnotation}
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
