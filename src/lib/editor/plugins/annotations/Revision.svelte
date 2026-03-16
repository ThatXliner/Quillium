<script lang="ts">
/**
 * Revision.svelte — Displays a single revision annotation card
 * with multiple named versions, a textarea for quick inline editing,
 * and actions to create/delete versions or expand into a full-screen
 * modal for deep editing (nested annotations, rich undo history).
 *
 * Architecture: the nested editor is a direct viewport onto the
 * parent document's revision range. Edits in the nested editor
 * are translated to parent coordinates via translateAndDispatch()
 * and dispatched to the parent EditorView.
 *
 * External changes to the revision range (e.g. undo or non-atomic
 * typing in the parent editor) are reflected back into the nested
 * editor via Svelte reactivity: when the active revision/version
 * changes, reactive effects update the nested editor's state and
 * document buffer directly to keep it in sync.
 *
 * The nested editor is only destroyed/recreated on version switch.
 * All other changes (typing, undo) are applied as incremental
 * updates/deltas to the existing nested editor instance.
 */
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import { ChevronDown, ChevronUp, Maximize2, PlusIcon, Trash2, X } from "lucide-svelte";
import { onDestroy, tick } from "svelte";
import { slide } from "svelte/transition";
import { cubicOut } from "svelte/easing";
import {
    annotationField,
    annotationsChanged,
    createNewRevision,
    deleteRevisionVersion,
    isAnnotationOfType,
    setActiveRevisionVersion,
    updateRevisionVersionLabel,
    type Annotation,
    type GenericAnnotation,
    type Thread as ThreadType,
} from ".";
import { versionText, type VersionState } from "./models";
import { createNestedEditorState, translateAndDispatch, previewVersionText } from "./nestedEditor";
import { getActiveAnnotation } from "./utils";
import { annotationUiEvent, modalStack, consumePendingNestedEditorSelection } from "$lib/stores";
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
const activeVersion = $derived(revision.versions[revision.activeVersionIndex]);
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

let nestedEditorHost = $state<HTMLDivElement>();
let nestedEditor = $state<EditorView | undefined>(undefined);
let activeAnnotation = $state<GenericAnnotation | undefined>(undefined);

// Track which version the nested editor was built for, so we know
// when to destroy/recreate (version switch).
let mountedVersionId = -1;
// Track the annotationField blob the inline editor was built with, so
// we can detect when a modal flush writes new nested annotations into
// the version and trigger a rebuild.
let mountedAnnotationFieldBlob: unknown = undefined;

// Track the last doc the nested editor dispatched up to the parent.
// Used to distinguish "doc changed externally (undo/typing)" from
// "doc changed because the nested editor typed it" so we don't
// unnecessarily patch the nested editor with its own content.
let lastDispatchedDoc = "";
// Guard: set to true while we are programmatically patching the nested editor
// from an external parent change, so the updateListener skips translateAndDispatch
// and doesn't bounce the change back up to the parent.
let pullingFromParent = false;

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
    // If there's already a modal open for this revision, the modal's own
    // event handler will create the sub-annotation directly in its nested
    // editor rather than pushing a duplicate modal from the sidebar.
    const stack = $modalStack;
    const topModal = stack[stack.length - 1];
    if (topModal?.type === "revision" && topModal.revisionId === revision.id) return;
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
        event.revisionId !== revision.id ||
        event.sourceView !== view
    )
        return;
    lastFocusRequestToken = event.token;
    const relPos = event.relativePos;
    if (appSettings.showNestedEditor) {
        const placeCursor = (editor: EditorView) => {
            editor.dispatch({ selection: { anchor: relPos }, scrollIntoView: true });
            editor.focus();
            clearTimeout(cursorArrivingTimeout);
            cursorArriving = false;
            void nestedEditorHost?.offsetWidth;
            cursorArriving = true;
            cursorArrivingTimeout = setTimeout(() => {
                cursorArriving = false;
            }, 650);
        };
        if (isEditorOpen && nestedEditor) {
            placeCursor(nestedEditor);
        } else {
            userClosedEditor = false;
            isEditorOpen = true;
            tick().then(() => {
                if (nestedEditor) placeCursor(nestedEditor);
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
 */
function createNestedEditor(version: VersionState) {
    if (!nestedEditorHost || nestedEditor) return;
    const state = createNestedEditorState(
        version,
        (update: ViewUpdate) => {
            if (!nestedEditor) return;
            activeAnnotation = getActiveAnnotation(nestedEditor.state);
            // Translate doc changes to parent coordinates and dispatch.
            // Skip when we're programmatically syncing from the parent to avoid
            // bouncing the change back up and corrupting the parent document.
            if (!pullingFromParent && translateAndDispatch(update, view, revision.id)) {
                // Track what we dispatched so the external-sync $effect
                // doesn't re-patch the nested editor with its own content.
                lastDispatchedDoc = nestedEditor.state.doc.toString();
            }
        },
        view,
        revision.id,
    );
    nestedEditor = new EditorView({ state, parent: nestedEditorHost });
    mountedVersionId = revision.activeVersionIndex;
    mountedAnnotationFieldBlob = (version as { annotationField?: unknown }).annotationField;
    lastDispatchedDoc = nestedEditor.state.doc.toString();
    activeAnnotation = getActiveAnnotation(nestedEditor.state);

    // Apply pending selection if this annotation just created one.
    const event = $annotationUiEvent;
    const selectionEvent =
        consumePendingNestedEditorSelection(revision.id, lastNestedSelectionToken) ??
        (event &&
        event.token !== lastNestedSelectionToken &&
        event.type === "pending-nested-editor-selection" &&
        event.annotationId === revision.id
            ? event
            : undefined);
    if (selectionEvent) {
        lastNestedSelectionToken = selectionEvent.token;
        const docLen = nestedEditor.state.doc.length;
        const from = Math.min(selectionEvent.from, docLen);
        const to = Math.min(selectionEvent.to, docLen);
        nestedEditor.dispatch({
            selection: { anchor: from, head: to },
            scrollIntoView: true,
        });
        nestedEditor.focus();
    }
}

function destroyNestedEditor() {
    // NOTE: we intentionally do NOT flush nested annotation state here.
    // updateRevisionVersionState replaces the doc range, which creates a
    // revisionInternalEdit transaction that corrupts undo positions when
    // the user immediately presses Cmd+Z after clicking away from the
    // revision. The parent doc is the source of truth (Phase 3 keeps
    // version.doc in sync), so the doc content is already correct.
    // Nested annotation persistence is handled by the modal editor.
    nestedEditor?.destroy();
    nestedEditor = undefined;
    activeAnnotation = undefined;
    mountedVersionId = -1;
    mountedAnnotationFieldBlob = undefined;
}

// Create or destroy the nested editor when the toggle changes.
$effect(() => {
    if (!isEditorOpen) {
        destroyNestedEditor();
        return;
    }
    tick().then(() => {
        if (!isEditorOpen || !activeVersion) return;
        createNestedEditor(activeVersion);
    });
});

// When the selected version changes, destroy and recreate.
$effect(() => {
    if (!nestedEditor || !isEditorOpen) return;
    const currentVersionId = revision.activeVersionIndex;
    if (currentVersionId === mountedVersionId) return;

    // Version switched — recreate for new version.
    destroyNestedEditor();
    tick().then(() => {
        if (!isEditorOpen || !activeVersion) return;
        createNestedEditor(activeVersion);
        if (nestedEditor) {
            const end = nestedEditor.state.doc.length;
            nestedEditor.dispatch({
                selection: { anchor: end },
                scrollIntoView: true,
            });
            nestedEditor.focus();
        }
    });
});

// When the modal closes, it flushes nested annotations back into the
// version blob via _updateRevisionVersionState. The version index
// stays the same, so the version-switch effect above doesn't fire.
// But the inline nested editor was built from the old blob and still
// has the stale annotationField — decorations for nested annotations
// are missing. Detect the flush by watching for a new annotationField
// blob on activeVersion and rebuild the inline editor from it.
$effect(() => {
    if (!nestedEditor || !isEditorOpen || !activeVersion) return;
    const incomingBlob = (activeVersion as { annotationField?: unknown }).annotationField;
    if (incomingBlob === mountedAnnotationFieldBlob) return;
    // The version blob's annotationField changed — rebuild so the inline
    // editor picks up the updated nested annotation decorations.
    destroyNestedEditor();
    createNestedEditor(activeVersion);
});

// When the version doc changes externally (undo, non-atomic typing from
// the parent editor), patch the nested editor to match. Phase 3 keeps
// activeVersion.doc current, so we just watch it and apply the diff.
// We skip patching when the doc change originated from the nested editor
// itself (tracked via lastDispatchedDoc) to avoid a feedback loop.
$effect(() => {
    const externalDoc = activeVersion?.doc ?? "";
    if (!nestedEditor || externalDoc === lastDispatchedDoc) return;
    const current = nestedEditor.state.doc.toString();
    if (current !== externalDoc) {
        pullingFromParent = true;
        nestedEditor.dispatch({
            changes: { from: 0, to: current.length, insert: externalDoc },
            // Mark as a pull/non-history transaction so the nested editor
            // bridge can ignore it when translating changes back to the parent.
            annotations: Transaction.addToHistory.of(false),
        });
        pullingFromParent = false;
    }
    lastDispatchedDoc = externalDoc;
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

// When a nested revision decoration inside our inline editor is clicked,
// the revisionClickHandler fires revision-focus-request with that nested
// revision's ID. No other component matches it, so we handle it here by
// opening a modal for the nested revision.
let lastNestedRevFocusToken = 0;
$effect(() => {
    const event = $annotationUiEvent;
    if (
        !event ||
        event.token === lastNestedRevFocusToken ||
        event.type !== "revision-focus-request" ||
        !nestedEditor ||
        event.sourceView !== nestedEditor
    )
        return;
    // Only handle if the target revision exists in our inline nested editor
    const nestedAnns = nestedEditor.state.field(annotationField);
    const nestedRev = nestedAnns[event.revisionId];
    if (!nestedRev || !isAnnotationOfType(nestedRev, "revision")) return;
    lastNestedRevFocusToken = event.token;
    // Expand this parent revision as a modal first, then place the cursor
    // on the nested revision so it activates inline within that modal.
    // This ensures the full editing context (parent modal) is always
    // present before the nested revision is opened — never skipping levels.
    const nestedRevPos = nestedRev.selection.main.from;
    modalStack.push({
        type: "revision",
        revisionId: revision.id,
        parentView: view,
        label: activeVersion ? previewVersionText(activeVersion) : "Revision",
        pendingNestedCommand: {
            type: "cursor",
            selectionFrom: nestedRevPos,
            selectionTo: nestedRevPos,
        },
    });
});

onDestroy(() => {
    clearTimeout(boundaryHintTimeout);
    clearTimeout(cursorArrivingTimeout);
    destroyNestedEditor();
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
            {@const versionActive = i === revision.activeVersionIndex}
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
                    tick().then(() => nestedEditor?.focus());
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
            <div
                bind:this={nestedEditorHost}
                class="revision-inline-editor"
                class:cursor-arriving={cursorArriving}
            ></div>
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
        text-indent: 0;
        font-size: 13px;
        line-height: 1.6;
        font-family: inherit;
    }

    @keyframes focus-flash {
        0%   { background-color: rgba(254, 242, 205, 0.9); }
        70%  { background-color: rgba(254, 242, 205, 0.9); }
        100% { background-color: rgba(254, 242, 205, 0); }
    }

    .revision-inline-editor.cursor-arriving {
        animation: focus-flash 0.6s ease-out both;
    }
</style>
