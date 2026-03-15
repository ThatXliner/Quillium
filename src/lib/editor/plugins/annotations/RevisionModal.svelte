<script lang="ts">
/**
 * RevisionModal.svelte — Full-screen modal that hosts a nested
 * CodeMirror editor for a single revision version.
 *
 * Props:
 *   - revisionId: number — ID of the revision annotation in the
 *     parent editor's annotationField
 *   - view: EditorView — the parent CodeMirror editor that owns
 *     the revision (used to read/write annotation state)
 *   - stackIndex: number — this modal's position in the global
 *     modalStack (used for breadcrumb rendering and navigation)
 *
 * Events emitted: none
 * Stores:
 *   - modalStack (read/write): breadcrumb trail, pop on close,
 *     popTo for breadcrumb nav, popToAndRebuild for cross-level
 *     version switching
 *
 * Parent: rendered by the modal layer in +page.svelte
 * Children: Annotations.svelte (sidebar for nested annotations)
 *
 * Key behaviour:
 *   - Creates a nested CodeMirror editor whose content is
 *     persisted back to the parent revision's version state on
 *     every keystroke via updateRevisionVersionState.
 *   - Supports multi-level nesting: revisions inside revisions,
 *     with breadcrumb version dropdowns at each level.
 *   - Handles a pendingNestedCommand from the modal stack entry
 *     to auto-create a comment or sub-revision on open.
 */
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { ChevronRight, ChevronDown, ChevronUp, Check, X, PlusIcon } from "lucide-svelte";
import { onDestroy, tick } from "svelte";
import { scale, slide } from "svelte/transition";
import {
    addAnnotation,
    annotationField,
    setActiveRevisionVersion,
    createNewRevision,
    updateRevisionVersionLabel,
    updateThread,
    type Annotation,
    type Annotations as AnnotationsMap,
    type GenericAnnotation,
    type Thread as ThreadType,
} from ".";

import { canCreateNewComment, getActiveAnnotation } from "./utils";
import { createNewAnnotation, versionText, type VersionState } from "./models";
import { EditorSelection, Transaction } from "@codemirror/state";
import { modalStack, type ModalEntry } from "$lib/stores";
import {
    createSliceEditor,
    destroySliceEditor,
    previewVersionText,
} from "./nestedEditor";
import Annotations from "./Annotations.svelte";
import Thread from "./Thread.svelte";
import TutorialGuide from "./TutorialGuide.svelte";
import Kbd from "$lib/ui/Kbd.svelte";
import { shouldHandleRevisionModalKeydown } from "./revisionModalKeyguard";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

const {
    revisionId,
    view,
    stackIndex,
}: { revisionId: number; view: EditorView; stackIndex: number } = $props();

const crumbs = $derived($modalStack.slice(0, stackIndex + 1));

// Context snippet: lazy-loaded chunks around the outermost revision range
const CHUNK = 300; // chars per load step
let contextBefore = $state(CHUNK); // how many chars before to show
let contextAfter = $state(CHUNK); // how many chars after to show

// Build a context layer for each crumb level: from the root doc down to
// the current revision. Each layer shows the surrounding text and
// highlights the nested revision span within it.
// Layer 0 = outermost (root doc), layer N-1 = immediate parent of current.
type ContextLayer = {
    before: string;
    revision: string;
    after: string;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
};

const contextLayers = $derived.by((): ContextLayer[] => {
    void modalAnnotations; // re-run when nested editor writes back
    const layers: ContextLayer[] = [];
    for (let ci = 0; ci < crumbs.length; ci++) {
        const crumb = crumbs[ci];
        if (crumb.type !== "revision") continue;
        const parentState = crumb.parentView.state;
        const rev = parentState.field(annotationField)[crumb.revisionId] as
            | Annotation<"revision">
            | undefined;
        if (!rev) continue;
        const doc = parentState.doc;
        const from = rev.selection.main.from;
        const to = rev.selection.main.to;
        // Only the outermost layer gets infinite lazy-loading; inner layers
        // show the full version text (it's already bounded).
        const isOuter = ci === 0;
        const beforeStart = isOuter ? Math.max(0, from - contextBefore) : 0;
        const afterEnd = isOuter ? Math.min(doc.length, to + contextAfter) : doc.length;
        layers.push({
            before: doc.sliceString(beforeStart, from),
            revision: doc.sliceString(from, to),
            after: doc.sliceString(to, afterEnd),
            hasMoreBefore: isOuter && beforeStart > 0,
            hasMoreAfter: isOuter && afterEnd < doc.length,
        });
    }
    return layers;
});

// Convenience: outermost layer for scroll/jump logic
const docContext = $derived(contextLayers[0] ?? null);

let contextCollapsed = $state(false);
let contextScrollEl = $state<HTMLDivElement | undefined>(undefined);
let contextRevisionEl = $state<HTMLSpanElement | undefined>(undefined);

// "above" | "below" | null — whether revision highlight is out of view
let revisionDirection = $state<"above" | "below" | null>(null);

// Scroll edge state for dynamic mask
let contextAtTop = $state(true);
let contextAtBottom = $state(false);

function scrollRevisionIntoCenter(behavior: ScrollBehavior = "smooth") {
    if (!contextScrollEl || !contextRevisionEl) return;
    const container = contextScrollEl;
    const containerRect = container.getBoundingClientRect();
    const revisionRect = contextRevisionEl.getBoundingClientRect();
    const currentTop = container.scrollTop;
    const targetTop =
        currentTop +
        (revisionRect.top - containerRect.top) -
        (container.clientHeight / 2 - revisionRect.height / 2);
    container.scrollTo({ top: targetTop, behavior });
}

// Keep the revision centered whenever context is shown/updated.
$effect(() => {
    if (contextCollapsed || !contextRevisionEl || !contextScrollEl) return;
    requestAnimationFrame(() => scrollRevisionIntoCenter("auto"));
    const timeoutId = window.setTimeout(() => {
        scrollRevisionIntoCenter("auto");
    }, 220);
    return () => window.clearTimeout(timeoutId);
});

// IntersectionObserver: track whether revision span is visible in scroll container
$effect(() => {
    if (!contextRevisionEl || !contextScrollEl) return;
    const observer = new IntersectionObserver(
        ([entry]) => {
            if (entry.isIntersecting) {
                revisionDirection = null;
            } else {
                const rect = entry.boundingClientRect;
                const rootRect = entry.rootBounds;
                if (rootRect) {
                    revisionDirection = rect.top < rootRect.top ? "above" : "below";
                }
            }
        },
        { root: contextScrollEl, threshold: 0.1 },
    );
    observer.observe(contextRevisionEl);
    return () => observer.disconnect();
});

// Auto-load more when scrolling near the top or bottom edge;
// also track edge state for mask
$effect(() => {
    const el = contextScrollEl;
    if (!el) return;
    function updateEdges() {
        if (!el) return;
        contextAtTop = el.scrollTop <= 0;
        contextAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 0;
    }
    // Set initial state
    updateEdges();
    function handleScroll() {
        if (!el) return;
        updateEdges();
        const THRESHOLD = 40;
        if (el.scrollTop < THRESHOLD && docContext?.hasMoreBefore) {
            const prevHeight = el.scrollHeight;
            contextBefore += CHUNK;
            // Preserve scroll position after content is prepended
            requestAnimationFrame(() => {
                el.scrollTop += el.scrollHeight - prevHeight;
            });
        }
        if (
            el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD &&
            docContext?.hasMoreAfter
        ) {
            contextAfter += CHUNK;
        }
    }
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
});

// Track selected version index per crumb level reactively
let crumbSelectedVersions = $state<number[]>([]);
// Which crumb dropdown is open (-1 = none)
let openDropdown = $state(-1);

// Sync the version-dropdown selections for each breadcrumb
// whenever the crumbs array or underlying revision state changes.
$effect(() => {
    crumbSelectedVersions = crumbs.map((crumb) => {
        if (crumb.type !== "revision") return 0;
        const rev = crumb.parentView.state.field(annotationField)[crumb.revisionId] as
            | Annotation<"revision">
            | undefined;
        return rev?.currentlySelected ?? 0;
    });
});

/**
 * Handle selecting a version from a breadcrumb dropdown.
 * If the version belongs to the current (deepest) modal,
 * rebuild the editor in-place. Otherwise pop the stack back
 * to the target level and signal it to rebuild.
 */
function selectVersion(ci: number, vi: number, crumb: (typeof crumbs)[number], isCurrent: boolean) {
    if (crumb.type !== "revision") return;
    crumbSelectedVersions[ci] = vi;
    openDropdown = -1;
    if (isCurrent) {
        // Flush + destroy BEFORE the parent dispatch so destroyEditor reads
        // the correct currentlySelected (the outgoing version, not the new one).
        destroyEditor();
    }
    crumb.parentView.dispatch(
        setActiveRevisionVersion(crumb.parentView.state, crumb.revisionId, vi),
    );
    if (isCurrent) {
        tick().then(() => {
            const v = view.state.field(annotationField)[revisionId] as
                | Annotation<"revision">
                | undefined;
            if (v) {
                createEditor(v.versions[v.currentlySelected]);
                if (editor) moveCursorToEnd(editor);
            }
        });
    } else {
        // Pop back to that level and signal it to rebuild its editor
        modalStack.popToAndRebuild(ci);
    }
}

// Rebuild editor when our own stack entry gets a fresh rebuildToken
// (set by popToAndRebuild when a child level switches our version).
// destroyEditor() flushes annotations before rebuilding.
let lastRebuildToken = 0;
$effect(() => {
    const entry = $modalStack[stackIndex] as (ModalEntry & { rebuildToken?: number }) | undefined;
    const token = entry?.rebuildToken ?? 0;
    if (token && token !== lastRebuildToken) {
        lastRebuildToken = token;
        destroyEditor();
        tick().then(() => {
            const v = view.state.field(annotationField)[revisionId] as
                | Annotation<"revision">
                | undefined;
            if (v) {
                createEditor(v.versions[v.currentlySelected]);
                if (editor) moveCursorToEnd(editor);
            }
        });
    }
});

// NOTE: $derived on view.state.field(...) is NOT reactive to CodeMirror
// transactions. view is a plain prop (not $state), so Svelte cannot observe
// mutations to view.state. This only captures the value at the time the
// expression first runs. Downstream code that needs to react to state
// changes reads from modalAnnotations instead (see below).
const revision = $derived(
    view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined,
);

let editorHost = $state<HTMLDivElement>();
let editor = $state<EditorView | undefined>(undefined);
let dialogEl = $state<HTMLDialogElement>();
// Manually-synced mirrors of the nested editor's CodeMirror state.
// Because CodeMirror manages its own state internally (view.state is a plain
// object, not $state), Svelte has no way to react to transactions automatically.
// The nested editor's updateListener callback (inside createEditor) writes here
// on every transaction, making these the reactive entry-point for everything
// that needs to re-run when the nested editor changes.
let modalAnnotations = $state<AnnotationsMap | undefined>(undefined);
let modalActiveAnnotation = $state<GenericAnnotation | undefined>(undefined);

/**
 * Bootstrap a slice editor for a revision version. The nested editor
 * owns no state — all doc changes are forwarded to the parent view,
 * and the nested doc is kept in sync with the parent slice by
 * parentSyncPlugin inside createSliceEditor.
 */
function createEditor(version: VersionState) {
    if (!editorHost || editor) return;
    editor = createSliceEditor(
        revisionId,
        view,
        version,
        editorHost,
        (_update: ViewUpdate) => {
            if (!editor) return;
            modalAnnotations = editor.state.field(annotationField);
            modalActiveAnnotation = getActiveAnnotation(editor.state);
        },
    );
    modalAnnotations = editor.state.field(annotationField);
    modalActiveAnnotation = getActiveAnnotation(editor.state);
}

function moveCursorToEnd(activeEditor: EditorView) {
    const end = activeEditor.state.doc.length;
    activeEditor.dispatch({
        selection: { anchor: end },
        scrollIntoView: true,
    });
    activeEditor.focus();
}

function destroyEditor() {
    if (editor) {
        destroySliceEditor(editor, view, revisionId);
    }
    editor = undefined;
    modalAnnotations = undefined;
    modalActiveAnnotation = undefined;
}

function close() {
    modalStack.pop();
}

// Close the version dropdown when clicking outside of it.
$effect(() => {
    if (openDropdown === -1) return;
    const handler = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest(".version-trigger, .version-popover")) {
            openDropdown = -1;
        }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
});

/**
 * Execute a pending nested annotation command (comment or
 * sub-revision) that was queued in the modal stack entry
 * when this modal was opened. Sets the selection in the
 * nested editor and dispatches the appropriate annotation.
 */
function executePendingNestedCommand(
    activeEditor: EditorView,
    cmd: { type: string; selectionFrom: number; selectionTo: number },
) {
    const s = activeEditor.state;
    const docLen = s.doc.length;
    const from = Math.max(0, Math.min(cmd.selectionFrom, docLen));
    const to = Math.max(from, Math.min(cmd.selectionTo, docLen));
    activeEditor.dispatch({
        selection: EditorSelection.range(from, to),
    });
    activeEditor.focus();
    if (cmd.type === "comment") {
        const s2 = activeEditor.state;
        if (!s2.selection.main.empty && canCreateNewComment(s2.field(annotationField))) {
            activeEditor.dispatch(
                s2.update({
                    effects: [
                        addAnnotation.of(
                            createNewAnnotation(s2.field(annotationField), s2.selection, "comment"),
                        ),
                    ],
                    annotations: Transaction.addToHistory.of(true),
                }),
            );
        }
    } else if (cmd.type === "revision") {
        const s2 = activeEditor.state;
        if (!s2.selection.main.empty) {
            const selectedText = s2.sliceDoc(s2.selection.main.from, s2.selection.main.to);
            activeEditor.dispatch(
                s2.update({
                    effects: [
                        addAnnotation.of({
                            ...createNewAnnotation(
                                s2.field(annotationField),
                                s2.selection,
                                "revision",
                            ),
                            currentlySelected: 0,
                            versions: [{ doc: selectedText }],
                        }),
                    ],
                    annotations: Transaction.addToHistory.of(true),
                }),
            );
        }
    }
}

// Open the <dialog> as a modal, bootstrap the nested editor,
// and run any pending nested annotation command.
$effect(() => {
    if (!dialogEl) return;
    if (!dialogEl.open) dialogEl.showModal();
    tick().then(() => {
        const rev = view.state.field(annotationField)[revisionId] as
            | Annotation<"revision">
            | undefined;
        if (rev && !editor) {
            createEditor(rev.versions[rev.currentlySelected]);
        }
        const activeEditor = editor;
        const entry = $modalStack[stackIndex];
        if (activeEditor && entry?.type === "revision" && entry.pendingNestedCommand) {
            executePendingNestedCommand(activeEditor, entry.pendingNestedCommand);
        } else if (activeEditor) {
            moveCursorToEnd(activeEditor);
        }
    });
});

onDestroy(() => {
    destroyEditor();
});

// Label editing state for the current crumb's version dropdown
let editingVersionLabel = $state(false);
let labelInputValue = $state("");
let labelInputEl = $state<HTMLInputElement | undefined>(undefined);

function startLabelEdit() {
    if (!revision) return;
    labelInputValue = revision.versions[revision.currentlySelected]?.label ?? "";
    editingVersionLabel = true;
    tick().then(() => labelInputEl?.focus());
}

function commitLabelEdit() {
    if (!revision) { editingVersionLabel = false; return; }
    const trimmed = labelInputValue.trim();
    view.dispatch(
        updateRevisionVersionLabel(view.state, revisionId, revision.currentlySelected, trimmed || undefined),
    );
    editingVersionLabel = false;
}

function cancelLabelEdit() {
    editingVersionLabel = false;
}

function addVersion() {
    if (!revision) return;
    // Flush + destroy before the dispatch so the outgoing version is saved correctly.
    destroyEditor();
    view.dispatch(createNewRevision(view.state, revisionId));
    tick().then(() => {
        const rev = view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined;
        if (!rev) return;
        createEditor(rev.versions[rev.currentlySelected]);
        if (editor) moveCursorToEnd(editor);
    });
}

function navigateVersion(direction: "prev" | "next") {
    if (!revision) return;
    const count = revision.versions.length;
    if (count <= 1) return;
    const next = direction === "next"
        ? (revision.currentlySelected + 1) % count
        : (revision.currentlySelected - 1 + count) % count;
    selectVersion(crumbs.length - 1, next, crumbs[crumbs.length - 1], true);
}

function onDialogKeydown(e: KeyboardEvent) {
    if (!shouldHandleRevisionModalKeydown(e)) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key === "Enter") {
        e.preventDefault();
        addVersion();
    } else if (e.ctrlKey && e.key === "[") {
        e.preventDefault();
        navigateVersion("prev");
    } else if (e.ctrlKey && e.key === "]") {
        e.preventDefault();
        navigateVersion("next");
    }
}

let revisionThread = $state(
    (view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined)?.thread ??
        [],
    // modalAnnotations !== undefined ? (modalAnnotations[revisionId] as Annotation<"revision"> | undefined)?.thread ?? [] : [],
);

function dispatchUpdateThread(newThreadValue: ThreadType) {
    view.dispatch(
        view.state.update({
            effects: [
                updateThread.of({
                    annotationId: revisionId,
                    newThread: newThreadValue,
                }),
            ],
        }),
    );
    revisionThread =
        (view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined)
            ?.thread ?? [];
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  class="revision-modal"
  onclick={(e) => {
    if (e.target === dialogEl) close();
  }}
  onkeydown={onDialogKeydown}
>
  <div class="revision-modal-inner">
    <!-- Header -->
    <div
      class="flex items-center justify-between px-5 py-3 border-b border-purple-100/80 shrink-0 gap-3 min-w-0"
    >
      <!-- Breadcrumb trail -->
      <nav class="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
        {#each crumbs as crumb, ci}
          {@const isCurrent = ci === crumbs.length - 1}
          {@const crumbRevision =
            crumb.type === "revision"
              ? (crumb.parentView.state.field(annotationField)[
                  crumb.revisionId
                ] as Annotation<"revision"> | undefined)
              : undefined}
          {@const selectedVi = crumbSelectedVersions[ci] ?? 0}

          {#if ci > 0}
            <ChevronRight size={10} class="text-purple-300/60 shrink-0" />
          {/if}

          <div class="flex items-center gap-1.5">
            <!-- "Revision" label — clickable back if not current -->
            {#if isCurrent}
              <span
                class="text-[10px] font-semibold text-purple-700/70 uppercase tracking-wider shrink-0"
                >Revision</span
              >
            {:else}
              <button
                class="text-[10px] text-purple-400/60 hover:text-purple-600/80 transition-colors uppercase tracking-wider shrink-0"
                onclick={() => modalStack.popTo(ci)}>Revision</button
              >
            {/if}

            <!-- Version dropdown -->
            {#if crumbRevision && crumbRevision.versions.length > 0}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="relative"
                onkeydown={(e) => {
                  if (e.key === "Escape") openDropdown = -1;
                }}
              >
                <!-- Trigger -->
                {#if isCurrent && editingVersionLabel}
                  <input
                    bind:this={labelInputEl}
                    bind:value={labelInputValue}
                    class="pl-2 pr-1.5 py-0.5 rounded-md text-[10px] font-medium w-[120px]
                        bg-purple-100/70 text-purple-700/80 ring-1 ring-purple-300/60 outline-none
                        placeholder-purple-400/50"
                    placeholder="Version name…"
                    onblur={commitLabelEdit}
                    onkeydown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitLabelEdit(); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelLabelEdit(); }
                    }}
                  />
                {:else}
                <button
                  class="version-trigger flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md text-[10px] font-medium
                                        transition-all duration-150
                                        {isCurrent
                    ? 'bg-purple-100/70 text-purple-700/80 hover:bg-purple-100 ring-1 ring-purple-200/60'
                    : 'bg-black/5 text-black/45 hover:bg-black/8 ring-1 ring-black/10'}
                                        {openDropdown === ci
                    ? 'ring-2 ' +
                      (isCurrent ? 'ring-purple-300/60' : 'ring-black/20')
                    : ''}"
                  onclick={(e) => {
                    e.stopPropagation();
                    openDropdown = openDropdown === ci ? -1 : ci;
                  }}
                  ondblclick={(e) => {
                    if (isCurrent) { e.stopPropagation(); startLabelEdit(); }
                  }}
                  title={isCurrent ? "Double-click to rename" : undefined}
                >
                  <span
                    >{crumbRevision.versions[selectedVi]?.label ??
                      previewVersionText(
                        crumbRevision.versions[selectedVi],
                      )}</span
                  >
                  <ChevronDown
                    size={9}
                    class="transition-transform duration-200 {openDropdown ===
                    ci
                      ? 'rotate-180'
                      : ''}
                                            {isCurrent
                      ? 'text-purple-400/70'
                      : 'text-black/30'}"
                  />
                </button>
                {/if}

                <!-- Popover -->
                {#if openDropdown === ci}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    class="version-popover"
                    transition:scale={{
                      start: 0.92,
                      duration: 150,
                      opacity: 0,
                    }}
                    style="transform-origin: top left;"
                  >
                    {#each crumbRevision.versions as version, vi}
                      {@const isSelected = vi === selectedVi}
                      <button
                        class="version-option {isSelected
                          ? 'version-option-active'
                          : ''}"
                        onclick={() => selectVersion(ci, vi, crumb, isCurrent)}
                      >
                        <span class="flex-1 text-left truncate"
                          >{version.label ?? previewVersionText(version)}</span
                        >
                        {#if isSelected}
                          <Check
                            size={10}
                            class="text-purple-500/70 shrink-0"
                          />
                        {/if}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </nav>

      <!-- Right actions -->
      <div class="flex items-center gap-2 shrink-0">
        {#if revision && revision.versions.length > 1}
          <div class="flex items-center gap-0.5 opacity-40">
            <Kbd keys={["Ctrl", "["]} />
            <Kbd keys={["Ctrl", "]"]} />
          </div>
        {/if}
        <button
          class="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-purple-600/80
              bg-purple-50/80 hover:bg-purple-100/60 rounded-md ring-1 ring-purple-200/50 transition-colors"
          onclick={addVersion}
          title="New version ({modKey}↵)"
        >
          <PlusIcon size={10} />
          <span>New version</span>
          <Kbd keys={[modKey, "↵"]} />
        </button>
        <button
          class="p-1 rounded-md text-black/30 hover:text-black/60 hover:bg-black/5 transition-colors"
          onclick={close}
        >
          <X size={16} />
        </button>
      </div>
    </div>

        <TutorialGuide />

    <!-- Body: thread + editor + annotations panel -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Thread sidebar (left) -->
      <div
        class="revision-modal-thread shrink-0 border-r border-purple-100/60 flex flex-col bg-purple-50/90"
      >
        <div class="px-4 py-3 border-b border-purple-100/50 shrink-0">
          <span
            class="text-[9px] font-semibold text-purple-600/60 uppercase tracking-wider"
            >Thread</span
          >
        </div>
        <div class="flex-1 overflow-y-auto px-4 py-3">
          {#if revisionThread.length === 0}
            <p class="text-[11px] text-black/30 leading-relaxed mb-3">
              No messages yet.
            </p>
          {/if}
          <Thread
            thread={revisionThread}
            updateThread={dispatchUpdateThread}
            annotationId={revisionId}
            accentClass="text-purple-600/80 hover:text-purple-700"
            focusRingClass="focus-within:ring-purple-300/50"
          />
        </div>
      </div>

      <!-- Editor -->
      <div
        bind:this={editorHost}
        class="revision-modal-editor flex-1 overflow-hidden"
      ></div>

      <!-- Right sidebar: context + annotations -->
      {#if contextLayers.length > 0 || (editor && modalAnnotations && Object.keys(modalAnnotations).length > 0)}
        <div class="w-56 shrink-0 border-l border-purple-100/60 flex flex-col bg-purple-50/20">

          <!-- Context panel -->
          {#if contextLayers.length > 0}
            <div class="border-b border-purple-100/60 shrink-0">
              <button
                class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-purple-50/60 transition-colors"
                onclick={() => contextCollapsed = !contextCollapsed}
              >
                <span class="text-[9px] font-semibold text-purple-600/60 uppercase tracking-wider">Context</span>
                {#if contextCollapsed}
                  <ChevronDown size={10} class="text-purple-400/50" />
                {:else}
                  <ChevronUp size={10} class="text-purple-400/50" />
                {/if}
              </button>
              {#if !contextCollapsed}
                <div transition:slide={{ duration: 180 }} class="relative">
                  <div
                    bind:this={contextScrollEl}
                    class="context-scroll"
                    style="mask-image: linear-gradient(to bottom, {contextAtTop ? 'black' : 'transparent'} 0%, black 22%, black 78%, {contextAtBottom ? 'black' : 'transparent'} 100%); -webkit-mask-image: linear-gradient(to bottom, {contextAtTop ? 'black' : 'transparent'} 0%, black 22%, black 78%, {contextAtBottom ? 'black' : 'transparent'} 100%);"
                  >
                    <!-- Nested context layers: outermost first, each wrapping the next -->
                    {#snippet renderLayer(depth: number)}
                      {@const layer = contextLayers[depth]}
                      {@const isDeepest = depth === contextLayers.length - 1}
                      <span class="context-text context-depth-{depth}">
                        {#if layer.before}<span class="context-surrounding">{layer.before}</span>{/if}<!--
                        -->{#if depth === 0}<span bind:this={contextRevisionEl} class="context-nest context-nest-0">{#if isDeepest}{layer.revision || "(empty)"}{:else}{@render renderLayer(1)}{/if}</span>{:else}<span class="context-nest context-nest-{Math.min(depth, 3)}">{#if isDeepest}{layer.revision || "(empty)"}{:else}{@render renderLayer(depth + 1)}{/if}</span>{/if}<!--
                        -->{#if layer.after}<span class="context-surrounding">{layer.after}</span>{/if}
                      </span>
                    {/snippet}
                    {@render renderLayer(0)}
                  </div>
                  {#if revisionDirection}
                    <button
                      class="context-jump-btn {revisionDirection === 'above' ? 'context-jump-top' : 'context-jump-bottom'}"
                      onclick={() => scrollRevisionIntoCenter()}
                      title="Jump to revision"
                      transition:scale={{ start: 0.8, duration: 120, opacity: 0 }}
                    >
                      {#if revisionDirection === "above"}
                        <ChevronUp size={14} />
                      {:else}
                        <ChevronDown size={14} />
                      {/if}
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}

          <!-- Annotations -->
          {#if editor && modalAnnotations && Object.keys(modalAnnotations).length > 0}
            <div class="flex-1 overflow-y-auto px-2 py-3">
              <div class="text-[9px] font-medium text-black/35 uppercase tracking-wider mb-2 px-1">
                Annotations
              </div>
              <Annotations
                view={editor}
                annotationsData={modalAnnotations}
                activeAnnotationData={modalActiveAnnotation}
                layout="inline"
              />
            </div>
          {/if}

        </div>
      {/if}
    </div>
  </div>
</dialog>

<style>
  .revision-modal {
    border: none;
    padding: 0;
    background: transparent;
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .revision-modal::backdrop {
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(4px);
  }

  .revision-modal-inner {
    display: flex;
    flex-direction: column;
    width: 1060px;
    height: 72vh;
    background: white;
    border-radius: 1rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    overflow: hidden;
  }

  .revision-modal-thread {
    width: 220px;
  }

  .revision-modal-editor :global(.cm-editor) {
    height: 100%;
    width: 100%;
    background: transparent;
  }

  .revision-modal-editor :global(.cm-scroller) {
    overflow: auto;
    line-height: 1.7;
    height: 100%;
  }

  .revision-modal-editor :global(.cm-content) {
    text-indent: 0;
    min-height: 100%;
    padding: 20px 32px 32px 32px;
    font-size: 15px;
  }

  .revision-modal-editor :global(.cm-focused) {
    outline: none;
  }

  .version-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 160px;
    max-width: 240px;
    background: white;
    border: 1px solid rgba(147, 112, 219, 0.15);
    border-radius: 10px;
    box-shadow:
      0 8px 24px -4px rgba(0, 0, 0, 0.12),
      0 2px 8px -2px rgba(0, 0, 0, 0.08);
    padding: 4px;
    z-index: 10;
    overflow: hidden;
  }

  .version-option {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 11px;
    color: rgba(0, 0, 0, 0.6);
    transition:
      background 0.1s,
      color 0.1s;
    cursor: pointer;
  }

  .version-option:hover {
    background: rgba(147, 112, 219, 0.08);
    color: rgba(109, 40, 217, 0.85);
  }

  .version-option-active {
    background: rgba(147, 112, 219, 0.1);
    color: rgba(109, 40, 217, 0.9);
    font-weight: 500;
  }

  .context-scroll {
    height: 200px;
    overflow-y: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding: 10px 14px;
    background: rgba(245, 240, 255, 0.45);
    backdrop-filter: blur(12px) saturate(1.3);
    -webkit-backdrop-filter: blur(12px) saturate(1.3);
  }

  .context-scroll::-webkit-scrollbar {
    display: none;
  }

  /* Base text layer (outermost / depth-0) */
  .context-text {
    display: block;
    font-size: 11px;
    line-height: 1.7;
    color: rgba(80, 40, 120, 0.35);
    font-family: var(--doc-font-family, system-ui, sans-serif);
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Surrounding text inherits parent color */
  .context-surrounding {
    /* color inherited from .context-text / .context-nest */
  }

  /* Each nesting level: inset block with deeper purple bg + stronger text */
  .context-nest {
    display: inline;
    border-radius: 4px;
    padding: 2px 4px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  /* Depth 0: outermost revision highlight (light purple) */
  .context-nest-0 {
    background: rgba(147, 112, 219, 0.10);
    color: rgba(88, 28, 135, 0.55);
    box-shadow: inset 0 0 0 1px rgba(147, 112, 219, 0.18);
  }

  /* Depth 1: one level in (medium purple) */
  .context-nest-1 {
    background: rgba(126, 87, 194, 0.16);
    color: rgba(88, 28, 135, 0.70);
    box-shadow: inset 0 0 0 1px rgba(126, 87, 194, 0.25);
  }

  /* Depth 2: two levels in (deeper purple) */
  .context-nest-2 {
    background: rgba(109, 40, 217, 0.20);
    color: rgba(88, 28, 135, 0.82);
    box-shadow: inset 0 0 0 1px rgba(109, 40, 217, 0.30);
  }

  /* Depth 3+: innermost / deepest (richest purple) */
  .context-nest-3 {
    background: rgba(88, 28, 135, 0.24);
    color: rgba(88, 28, 135, 0.92);
    font-weight: 500;
    box-shadow: inset 0 0 0 1px rgba(88, 28, 135, 0.35);
  }

  .context-jump-btn {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px 5px;
    font-size: 10px;
    font-weight: 500;
    color: rgba(109, 40, 217, 0.8);
    background: rgba(245, 240, 255, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(167, 139, 250, 0.35);
    border-radius: 99px;
    box-shadow: 0 2px 8px rgba(109, 40, 217, 0.12);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    z-index: 2;
  }

  .context-jump-btn:hover {
    background: rgba(237, 233, 254, 0.95);
    color: rgba(109, 40, 217, 1);
  }

  .context-jump-top {
    top: 14px;
  }

  .context-jump-bottom {
    bottom: 14px;
  }
</style>
