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
import { EditorView } from "@codemirror/view";
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
import { previewVersionText } from "./nestedEditor";
import { NestedEditorController } from "./NestedEditorController";
import { modalStack } from "$lib/stores";
import { annotationEventBus } from "./eventBus";
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
let activeAnnotation = $state<GenericAnnotation | undefined>(undefined);

const controller = new NestedEditorController(
    view,
    revision.id,
    {
        onUpdate: (_annotations, active) => {
            activeAnnotation = active;
        },
    },
    "flush-on-destroy",
);

let cursorArriving = $state(false);
let cursorArrivingTimeout: ReturnType<typeof setTimeout> | undefined;
let pendingFocusPos: number | undefined;

function placeCursorInEditor(editor: EditorView, relPos: number) {
    editor.dispatch({ selection: { anchor: relPos }, scrollIntoView: true });
    editor.focus();
    clearTimeout(cursorArrivingTimeout);
    cursorArriving = false;
    void nestedEditorHost?.offsetWidth;
    cursorArriving = true;
    cursorArrivingTimeout = setTimeout(() => {
        cursorArriving = false;
    }, 650);
}

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
    return annotationEventBus.on("revision-boundary-nudge", (event) => {
        if (event.revisionId !== revision.id) return;
        showBoundaryHint = true;
        clearTimeout(boundaryHintTimeout);
        boundaryHintTimeout = setTimeout(() => {
            showBoundaryHint = false;
        }, 4000);
    });
});

$effect(() => {
    return annotationEventBus.on("revision-request-modal", (event) => {
        if (event.command.revisionId !== revision.id) return;
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
});

$effect(() => {
    return annotationEventBus.on("nested-annotation-create", (event) => {
        if (event.command.revisionId !== revision.id) return;
        // If a modal is already open for this revision, let that modal handle the event.
        if (
            $modalStack.some(
                (entry) => entry.type === "revision" && entry.revisionId === revision.id,
            )
        )
            return;
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
});

$effect(() => {
    return annotationEventBus.on("revision-focus-request", (event) => {
        if (event.revisionId !== revision.id || event.sourceView !== view) return;
        const relPos = event.relativePos;
        if (appSettings.showNestedEditor) {
            if (isEditorOpen && controller.editor) {
                placeCursorInEditor(controller.editor, relPos);
            } else {
                // Store the pending focus position — the creation $effect
                // will apply it when the editor is ready. We can't use
                // tick() here because the event bus fires synchronously
                // before Svelte's reactive flush, so the editor doesn't
                // exist yet when the first tick() resolves.
                pendingFocusPos = relPos;
                userClosedEditor = false;
                isEditorOpen = true;
            }
        } else {
            modalStack.push({
                type: "revision",
                revisionId: revision.id,
                parentView: view,
                label: activeVersion ? previewVersionText(activeVersion) : "Revision",
                pendingNestedCommand: {
                    type: "cursor",
                    selectionFrom: relPos,
                    selectionTo: relPos,
                },
            });
        }
    });
});

/**
 * Mount a nested CodeMirror editor for the given version.
 */
function createNestedEditor(version: VersionState) {
    if (!nestedEditorHost || controller.editor) return;
    controller.create(nestedEditorHost, version, revision.activeVersionIndex);
    controller.applyPendingSelection();
    // Apply pending focus from revision-focus-request that arrived before
    // the editor was created (event bus fires synchronously before Svelte flush).
    if (pendingFocusPos !== undefined && controller.editor) {
        placeCursorInEditor(controller.editor, pendingFocusPos);
        pendingFocusPos = undefined;
    }
}

function destroyNestedEditor() {
    controller.destroy();
    activeAnnotation = undefined;
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
    if (!controller.editor || !isEditorOpen) return;
    if (!controller.needsVersionSwitch(revision.activeVersionIndex)) return;

    destroyNestedEditor();
    tick().then(() => {
        if (!isEditorOpen || !activeVersion) return;
        createNestedEditor(activeVersion);
        if (controller.editor) {
            const end = controller.editor.state.doc.length;
            controller.editor.dispatch({
                selection: { anchor: end },
                scrollIntoView: true,
            });
            controller.editor.focus();
        }
    });
});

// When the modal closes, it flushes nested annotations back into the
// version blob. Detect the flush by watching for a new annotationField
// blob on activeVersion and rebuild the inline editor from it.
$effect(() => {
    if (!controller.editor || !isEditorOpen || !activeVersion) return;
    const incomingBlob = (activeVersion as { annotationField?: unknown }).annotationField;
    if (!controller.needsAnnotationRebuild(incomingBlob)) return;
    destroyNestedEditor();
    createNestedEditor(activeVersion);
});

// When the version doc changes externally (undo, parent typing), patch
// the nested editor. The controller handles skipping self-originated changes.
$effect(() => {
    const externalDoc = activeVersion?.doc ?? "";
    if (!controller.editor) return;
    controller.syncFromParent(externalDoc);
});

// ⌘Enter when this revision is active → create a new version
$effect(() => {
    return annotationEventBus.on("annotation-add-version", (event) => {
        if (event.annotationId !== revision.id) return;
        posthog.capture("revision_version_created", { version_count: revision.versions.length });
        view.dispatch(createNewRevision(view.state, revision.id));
        tick().then(() => {
            if (appSettings.showNestedEditor) {
                userClosedEditor = false;
                isEditorOpen = true;
            }
        });
    });
});

// When a nested revision decoration inside our inline editor is clicked,
// the revisionClickHandler fires revision-focus-request with that nested
// revision's ID. No other component matches it, so we handle it here by
// opening a modal for the nested revision.
$effect(() => {
    return annotationEventBus.on("revision-focus-request", (event) => {
        const nestedEditor = controller.editor;
        if (!nestedEditor || event.sourceView !== nestedEditor) return;
        // Only handle if the target revision exists in our inline nested editor
        const nestedAnns = nestedEditor.state.field(annotationField);
        const nestedRev = nestedAnns[event.revisionId];
        if (!nestedRev || !isAnnotationOfType(nestedRev, "revision")) return;
        // Expand this parent revision as a modal first, then place the cursor
        // on the nested revision so it activates inline within that modal.
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
            <PlusIcon size={14} />
            <span>New Version</span>
            <span class="ml-0.5 opacity-50"><Kbd keys={["Cmd", "↵"]} /></span>
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
                    tick().then(() => controller.editor?.focus());
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
        font-family: var(--doc-font-family);
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
        font-family: var(--doc-font-family);
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
