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
 *   A plain <textarea> bound to the active version's text.
 *   On every input event it dispatches updateRevisionVersionState
 *   to the parent CodeMirror instance — no second EditorView, no
 *   history delegation, no sync guards. Undo/redo in the textarea
 *   context works via the parent's CM history (Mod-z / Mod-y are
 *   forwarded with keydown handlers). Version switches just update
 *   textarea.value reactively via activeText.
 *
 *   See ARCHITECTURE.md §Nested Editors for the full rationale
 *   behind choosing textarea over a second CodeMirror instance.
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
import type { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { ChevronDown, ChevronUp, Maximize2, PlusIcon, Trash2, X } from "lucide-svelte";
import { onDestroy, tick } from "svelte";
import { slide } from "svelte/transition";
import { cubicOut } from "svelte/easing";
import {
    createNewRevision,
    deleteRevisionVersion,
    setActiveRevisionVersion,
    updateRevisionVersionLabel,
    updateRevisionVersionState,
    type Annotation,
    type Thread as ThreadType,
} from ".";
import { versionText } from "./models";
import { previewVersionText } from "./nestedEditor";
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
const activeText = $derived(activeVersion ? versionText(activeVersion) : "");

let isEditorOpen = $state(false);
let userClosedEditor = false;
let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined);
let textareaFocused = $state(false);

// Auto-open the inline textarea when this revision becomes active,
// unless the user explicitly closed it or the setting is disabled.
$effect(() => {
    if (isActive) {
        if (!userClosedEditor && appSettings.showNestedEditor) isEditorOpen = true;
    } else {
        isEditorOpen = false;
        userClosedEditor = false;
    }
});

// Keep textarea value in sync with the active version text.
// This covers version switches, undo/redo in the parent, and
// main-doc edits — all without any bridging machinery.
$effect(() => {
    if (!textareaEl) return;
    // Only update from outside if the textarea doesn't currently have
    // focus. While focused, the user is typing and the value is the
    // source of truth; we push it to the parent on each input event.
    if (!textareaFocused) {
        textareaEl.value = activeText;
    }
});

function pushTextToParent(text: string) {
    const existing = revision.versions[revision.currentlySelected];
    if (!existing) return;
    const newVersion = { ...existing, doc: text };
    view.dispatch(
        updateRevisionVersionState(view.state, revision.id, revision.currentlySelected, newVersion),
    );
}

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
    const relPos = Math.min(event.relativePos, activeText.length);
    if (appSettings.showNestedEditor) {
        const placeCursor = (el: HTMLTextAreaElement) => {
            el.focus();
            el.setSelectionRange(relPos, relPos);
        };
        if (isEditorOpen && textareaEl) {
            placeCursor(textareaEl);
        } else {
            userClosedEditor = false;
            isEditorOpen = true;
            tick().then(() => {
                if (textareaEl) placeCursor(textareaEl);
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
        !textareaEl
    )
        return;
    lastNestedSelectionToken = event.token;
    const len = textareaEl.value.length;
    textareaEl.setSelectionRange(
        Math.min(event.from, len),
        Math.min(event.to, len),
    );
    textareaEl.focus();
});

onDestroy(() => {
    clearTimeout(boundaryHintTimeout);
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
            {#if textareaFocused}
                <Kbd keys={[modKey, "↵"]} />
            {/if}
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
                    tick().then(() => textareaEl?.focus());
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

    <!-- Inline textarea editor (collapsible) -->
    {#if isEditorOpen && appSettings.showNestedEditor}
        <div transition:slide={{ duration: 120, easing: cubicOut }} class="mx-3 mb-3 rounded-lg overflow-hidden ring-1 ring-white/40 bg-white/60">
            <textarea
                bind:this={textareaEl}
                class="revision-textarea"
                spellcheck="true"
                autocapitalize="on"
                {...{"autocorrect": "on"}}
                value={activeText}
                oninput={(e) => pushTextToParent(e.currentTarget.value)}
                onfocusin={() => { textareaFocused = true; }}
                onfocusout={() => {
                    textareaFocused = false;
                    // On blur, ensure the stored version text reflects what's in
                    // the textarea, in case an external update changed activeText
                    // while the user was focused.
                    if (textareaEl) pushTextToParent(textareaEl.value);
                }}
                onkeydown={(e) => {
                    // Forward undo/redo to parent CM so the single undo stack works.
                    if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
                        e.preventDefault();
                        // Flush current textarea value before undo so the history
                        // entry reflects the latest typed text.
                        if (textareaEl) pushTextToParent(textareaEl.value);
                        undo(view);
                    } else if (
                        (e.metaKey || e.ctrlKey) &&
                        (e.key === "y" || (e.shiftKey && e.key === "z"))
                    ) {
                        e.preventDefault();
                        redo(view);
                    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        // Mod-Enter: create a new version.
                        e.preventDefault();
                        posthog.capture("revision_version_created", { version_count: revision.versions.length });
                        view.dispatch(createNewRevision(view.state, revision.id));
                    } else if (e.ctrlKey && e.key === "[") {
                        // Ctrl-[: previous version.
                        e.preventDefault();
                        const count = revision.versions.length;
                        if (count > 1) {
                            const prev = (revision.currentlySelected - 1 + count) % count;
                            view.dispatch(setActiveRevisionVersion(view.state, revision.id, prev));
                        }
                    } else if (e.ctrlKey && e.key === "]") {
                        // Ctrl-]: next version.
                        e.preventDefault();
                        const count = revision.versions.length;
                        if (count > 1) {
                            const next = (revision.currentlySelected + 1) % count;
                            view.dispatch(setActiveRevisionVersion(view.state, revision.id, next));
                        }
                    } else if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === "m" || e.key === "k")) {
                        // Mod-Alt-m / Mod-Alt-k: open modal and pass the nested annotation command.
                        e.preventDefault();
                        modalStack.push({
                            type: "revision",
                            revisionId: revision.id,
                            parentView: view,
                            label: activeVersion ? previewVersionText(activeVersion) : "Revision",
                            pendingNestedCommand: {
                                type: e.key === "m" ? "comment" : "revision",
                                selectionFrom: textareaEl?.selectionStart ?? 0,
                                selectionTo: textareaEl?.selectionEnd ?? 0,
                            },
                        });
                    }
                }}
            ></textarea>
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
    .revision-textarea {
        display: block;
        width: 100%;
        height: 220px;
        resize: none;
        background: transparent;
        border: none;
        outline: none;
        padding: 8px 10px 12px 10px;
        font-size: 13px;
        font-family: inherit;
        line-height: 1.6;
        color: inherit;
        overflow-y: auto;
    }
</style>
