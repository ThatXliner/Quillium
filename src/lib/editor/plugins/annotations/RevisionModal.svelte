<script lang="ts">
/**
 * RevisionModal.svelte — Full-screen modal that hosts a nested
 * CodeMirror editor for a single revision version.
 *
 * Props:
 *   - revisionId: number
 *   - view: EditorView — the parent CodeMirror editor
 *   - stackIndex: number — position in the global modalStack
 *
 * Delegates to:
 *   - useRevisionModalEditor — FSM, editor lifecycle, nested events
 *   - useRevisionContext — context layer data derivation
 *   - RevisionModalHeader — breadcrumb/version UI (owns its own state)
 *   - RevisionModalContextPanel — context scroll panel UI
 */
import { EditorView } from "@codemirror/view";
import {
    annotationField,
    setActiveRevisionVersion,
    createNewRevision,
    updateRevisionVersionLabel,
    updateThread,
    type Annotation,
    type Thread as ThreadType,
} from ".";
import {
    modalStack,
    annotations as annotationsStore,
    modalAnnotationStores,
    annotationUiEvent,
    type ModalEntry,
} from "$lib/stores";
import { isAnnotationOfType } from "./models";
import Annotations from "./Annotations.svelte";
import Thread from "./Thread.svelte";
import TutorialGuide from "./TutorialGuide.svelte";
import RevisionModalHeader from "./RevisionModalHeader.svelte";
import RevisionModalContextPanel from "./RevisionModalContextPanel.svelte";
import { useRevisionModalEditor } from "./useRevisionModalEditor.svelte";
import { useRevisionContext } from "./useRevisionContext.svelte";
import { shouldHandleRevisionModalKeydown } from "./revisionModalKeyguard";
import type { Annotations as AnnotationsMap } from ".";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

const {
    revisionId,
    view,
    stackIndex,
}: { revisionId: number; view: EditorView; stackIndex: number } = $props();

// Capture the pending command eagerly at mount time
const initialEntry = $modalStack[stackIndex];
const initialPendingCommand =
    initialEntry?.type === "revision" ? initialEntry.pendingNestedCommand : undefined;

const crumbs = $derived($modalStack.slice(0, stackIndex + 1));

// Parent annotation store for Sensor B and thread sync (varies by stack depth)
const parentAnnotations = $derived(
    stackIndex === 0
        ? $annotationsStore
        : ($modalAnnotationStores[stackIndex - 1] as AnnotationsMap | undefined),
);

// ─── Editor lifecycle hook ────────────────────────────────────────────
const editorHook = useRevisionModalEditor({
    revisionId,
    view,
    stackIndex,
    initialPendingCommand,
    getModalEntry: () =>
        $modalStack[stackIndex] as (ModalEntry & { rebuildToken?: number }) | undefined,
    getParentAnnotations: () => parentAnnotations,
    getAnnotationUiEvent: () => $annotationUiEvent,
});

// bind:this requires plain $state variables; sync them to the hook
let wrapperEl = $state<HTMLDivElement | undefined>(undefined);
let editorHost = $state<HTMLDivElement | undefined>(undefined);
$effect(() => { editorHook.wrapperEl = wrapperEl; });
$effect(() => { editorHook.editorHost = editorHost; });

// ─── Context data hook ────────────────────────────────────────────────
const ctx = useRevisionContext(
    () => crumbs,
    () => editorHook.modalAnnotations,
);

// NOTE: $derived on view.state.field(...) is NOT reactive to CodeMirror
// transactions. Only captures initial value — downstream uses modalAnnotations.
const revision = $derived(
    view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined,
);

function selectVersion(ci: number, vi: number, crumb: ModalEntry, isCurrent: boolean) {
    if (crumb.type !== "revision") return;
    crumb.parentView.dispatch(
        setActiveRevisionVersion(crumb.parentView.state, crumb.revisionId, vi),
    );
    if (isCurrent) {
        editorHook.send({ type: "VERSION_SWITCHED" });
    } else {
        modalStack.popToAndRebuild(ci);
    }
}

function addVersion() {
    if (!revision) return;
    view.dispatch(createNewRevision(view.state, revisionId));
    editorHook.send({ type: "VERSION_SWITCHED" });
}

function navigateVersion(direction: "prev" | "next") {
    if (!revision) return;
    const count = revision.versions.length;
    if (count <= 1) return;
    const next =
        direction === "next"
            ? (revision.activeVersionIndex + 1) % count
            : (revision.activeVersionIndex - 1 + count) % count;
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

function handleCommitLabel(newLabel: string | undefined) {
    if (!revision) return;
    view.dispatch(
        updateRevisionVersionLabel(
            view.state,
            revisionId,
            revision.activeVersionIndex,
            newLabel,
        ),
    );
}

// ─── Thread state ─────────────────────────────────────────────────────
let revisionThread = $state(
    (view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined)
        ?.thread ?? [],
);

$effect(() => {
    const ann = parentAnnotations;
    if (!ann) return;
    const rev = ann[revisionId] as Annotation<"revision"> | undefined;
    if (rev && isAnnotationOfType(rev, "revision")) revisionThread = rev.thread;
});

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={wrapperEl}
  class="revision-modal-inner"
  onkeydown={onDialogKeydown}
>
    <RevisionModalHeader
        {crumbs}
        {revision}
        {stackIndex}
        {modKey}
        onSelectVersion={selectVersion}
        onAddVersion={addVersion}
        onClose={() => modalStack.pop()}
        onCommitLabel={handleCommitLabel}
    />

    <TutorialGuide />

    <!-- Body: thread + editor + right sidebar -->
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
      {#if ctx.contextLayers.length > 0 || (editorHook.editor && editorHook.modalAnnotations && Object.keys(editorHook.modalAnnotations).length > 0)}
        <div class="w-56 shrink-0 border-l border-purple-100/60 flex flex-col bg-purple-50/20">

          {#if ctx.contextLayers.length > 0}
            <RevisionModalContextPanel
              contextLayers={ctx.contextLayers}
              onLoadMoreBefore={ctx.loadMoreBefore}
              onLoadMoreAfter={ctx.loadMoreAfter}
            />
          {/if}

          {#if editorHook.editor && editorHook.modalAnnotations && Object.keys(editorHook.modalAnnotations).length > 0}
            <div class="flex-1 overflow-y-auto px-2 py-3">
              <div class="text-[9px] font-medium text-black/35 uppercase tracking-wider mb-2 px-1">
                Annotations
              </div>
              <Annotations
                view={editorHook.editor}
                annotationsData={editorHook.modalAnnotations}
                activeAnnotationData={editorHook.modalActiveAnnotation}
                layout="inline"
              />
            </div>
          {/if}

        </div>
      {/if}
    </div>
</div>

<style>
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
    font-family: var(--doc-font-family);
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
    font-family: var(--doc-font-family);
  }

  .revision-modal-editor :global(.cm-focused) {
    outline: none;
  }
</style>
