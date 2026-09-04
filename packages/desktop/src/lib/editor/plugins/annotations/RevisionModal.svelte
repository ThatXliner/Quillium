<script lang="ts">
import { isolateHistory } from "@codemirror/commands";
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
 *   - Creates a nested CodeMirror editor that dispatches doc
 *     changes directly to the parent via translateAndDispatch.
 *     State is flushed to the parent version blob on destroy.
 *   - Supports multi-level nesting: revisions inside revisions,
 *     with breadcrumb version dropdowns at each level.
 *   - Handles a pendingNestedCommand from the modal stack entry
 *     to auto-create a comment or sub-revision on open.
 */
import { EditorView } from "@codemirror/view";
import {
    AnnotationModalFrame,
    AnnotationModalHeader,
    AnnotationPanel,
    hasIdenticalPreviousVersion,
} from "@quillium/share";
import { PlusIcon, Trash2 } from "lucide-svelte";
import { onDestroy } from "svelte";
import {
    type Annotation,
    type Annotations as AnnotationsMap,
    type GenericAnnotation,
    type Thread as ThreadType,
    addAnnotation,
    annotationField,
    collapseRevision,
    createNewRevision,
    deleteRevisionVersion,
    makeVersionFromSelection,
    removeAnnotation,
    revisionInternalEdit,
    revisionProvenance,
    setActiveRevisionVersion,
    updateRevisionVersionLabel,
    updateRevisionVersionState,
    updateThread,
} from ".";

import { annotationEventBus } from "$lib/events/annotationEventBus";
import posthog from "$lib/posthog";
import { appSettings, persistSettings } from "$lib/settings.svelte";
import {
    type ModalEntry,
    annotations as annotationsStore,
    modalAnnotationStores,
    modalStack,
} from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
import { EditorSelection, Transaction } from "@codemirror/state";
import Annotations from "./Annotations.svelte";
import DuplicateDraftWarning from "./DuplicateDraftWarning.svelte";
import { NestedEditorController } from "./NestedEditorController";
import RevisionBreadcrumbs from "./RevisionBreadcrumbs.svelte";
import RevisionContextPanel from "./RevisionContextPanel.svelte";
import Thread from "./Thread.svelte";
import TutorialGuide from "./TutorialGuide.svelte";
import {
    duplicateDraftWarningIsEnabled,
    duplicateDraftWarningSnoozeUntil,
} from "./duplicateDraftWarning";
import {
    type VersionState,
    activeVersion,
    activeVersionIndex,
    createNewAnnotation,
    getLastId,
    isAnnotationOfType,
    makeVersion,
    versionById,
    versionText,
} from "./models";
import { previewVersionText } from "./nestedEditor";
import { shouldHandleRevisionModalKeydown } from "./revisionModalKeyguard";
import { canCreateNewComment, canCreateRevision, getActiveAnnotation } from "./utils";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";
const opt = isMac ? "⌥" : "Alt";

let duplicateDraftWarningOpen = $state(false);

const {
    revisionId,
    view,
    stackIndex,
}: { revisionId: number; view: EditorView; stackIndex: number } = $props();

// Single active modal: true when this entry is on top of the stack.
const isTop = $derived(stackIndex === $modalStack.length - 1);

// Capture and consume any pending nested command once on mount.
const initialPendingCommand = modalStack.consumePendingCommand(stackIndex);

const crumbs = $derived($modalStack.slice(0, stackIndex + 1));

// Breadcrumb revisions, read reactively. crumb.parentView.state is a plain
// (non-reactive) read, so deriving from it directly would snapshot the
// revision at mount time — the breadcrumb title would not update when the
// active version's text changes (e.g. pasting into a freshly created
// revision). Instead read each level from the synced annotation stores
// (main editor → annotationsStore, nested levels → modalAnnotationStores),
// falling back to a direct state read before the store has that level.
const crumbRevisions = $derived.by((): (Annotation<"revision"> | undefined)[] => {
    const parentLevels = $modalAnnotationStores;
    const rootAnnotations = $annotationsStore;
    return crumbs.map((crumb, ci) => {
        if (crumb.type !== "revision") return undefined;
        const synced = ci === 0 ? rootAnnotations : parentLevels[ci - 1];
        const rev =
            synced?.[crumb.revisionId] ??
            crumb.parentView.state.field(annotationField)[crumb.revisionId];
        return rev && isAnnotationOfType(rev, "revision")
            ? (rev as Annotation<"revision">)
            : undefined;
    });
});

let annotationsCollapsed = $state(false);

// Track selected version index per crumb level reactively
let crumbSelectedVersions = $state<number[]>([]);

// Sync the version-dropdown selections for each breadcrumb
// whenever the crumbs array or underlying revision state changes.
$effect(() => {
    crumbSelectedVersions = crumbRevisions.map((rev) => (rev ? activeVersionIndex(rev) : 0));
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

    posthog.capture("revision_version_switched", {
        version_index: vi,
        context: "modal",
    });
    // The dropdown yields a positional index; translate to the stable version id.
    const crumbRev = crumb.parentView.state.field(annotationField)[crumb.revisionId];
    const targetVersionId =
        crumbRev && isAnnotationOfType(crumbRev, "revision")
            ? crumbRev.versions[vi]?.id
            : undefined;
    if (targetVersionId === undefined) return;
    crumb.parentView.dispatch(
        setActiveRevisionVersion(crumb.parentView.state, crumb.revisionId, targetVersionId),
    );

    if (isCurrent) {
        // FSM handles destroyEditor + popTo + tick + createEditor
        send({ type: "VERSION_SWITCHED" });
    } else {
        modalStack.popToAndRebuild(ci);
    }
}

// ─── FSM ────────────────────────────────────────────────────────────
// States: unmounted → mounting → ready ⇄ rebuilding
// All lifecycle transitions go through `send()`.
let fsmState = $state<"unmounted" | "mounting" | "ready" | "rebuilding">("unmounted");

type FsmEvent =
    | { type: "DIALOG_BOUND" }
    | { type: "REBUILD_REQUESTED" }
    | { type: "VERSION_SWITCHED" }
    | { type: "EXTERNAL_DOC_CHANGED"; doc: string }
    | {
          type: "NESTED_ANNOTATION_EVENT";
          cmd: { type: string; selectionFrom: number; selectionTo: number; revisionId?: number };
      };

/** Read fresh revision state from the parent view. */
function readRevision(): Annotation<"revision"> | undefined {
    const ann = view.state.field(annotationField)[revisionId];
    return ann && isAnnotationOfType(ann, "revision") ? ann : undefined;
}

function send(event: FsmEvent) {
    switch (fsmState) {
        case "unmounted": {
            if (event.type === "DIALOG_BOUND") {
                fsmState = "mounting";
                if (dialogEl && isTop && !dialogEl.open) dialogEl.showModal();
            }
            break;
        }
        case "ready": {
            if (event.type === "REBUILD_REQUESTED" || event.type === "VERSION_SWITCHED") {
                fsmState = "rebuilding";
                destroyEditor();
                if (event.type === "VERSION_SWITCHED") {
                    modalStack.popTo(stackIndex);
                }
            } else if (event.type === "EXTERNAL_DOC_CHANGED") {
                controller.syncFromParent(event.doc);
            } else if (event.type === "NESTED_ANNOTATION_EVENT") {
                const editor = controller.editor;
                if (!editor) break;
                executePendingNestedCommand(editor, event.cmd);
                if (event.cmd.type === "revision" && !appSettings.showNestedEditor) {
                    const nestedAnns = editor.state.field(annotationField);
                    const newId = getLastId(nestedAnns);
                    if (newId < 0) break;
                    const newAnn = nestedAnns[newId];
                    if (newAnn && isAnnotationOfType(newAnn, "revision")) {
                        modalStack.push({
                            type: "revision",
                            revisionId: newId,
                            parentView: editor,
                            label: previewVersionText(activeVersion(newAnn)),
                        });
                    }
                }
            }
            break;
        }
        default:
            break;
    }
}

// Reactive FSM continuation: handles "mounting" and "rebuilding" states
// once the DOM has updated (editorHost is available). Because this is an
// $effect, Svelte automatically tears it down on component destruction —
// no risk of creating editors on detached DOM nodes.
$effect(() => {
    if (fsmState === "mounting" && editorHost) {
        const rev = readRevision();
        if (rev && !controller.editor) {
            createEditor(activeVersion(rev), activeVersionIndex(rev));
        }
        const activeEditor = controller.editor;
        if (activeEditor) {
            if (initialPendingCommand) {
                executePendingNestedCommand(activeEditor, initialPendingCommand);
            } else {
                moveCursorToEnd(activeEditor);
            }
        }
        fsmState = "ready";
    } else if (fsmState === "rebuilding" && editorHost) {
        const rev = readRevision();
        if (rev) {
            createEditor(activeVersion(rev), activeVersionIndex(rev));
            if (controller.editor) moveCursorToEnd(controller.editor);
        }
        fsmState = "ready";
    }
    // DEV bridge: expose each modal's nested EditorView by stack index so the
    // screenshot script can retrieve it via window.__modalEditors__[stackIndex].
    if (import.meta.env.DEV) {
        const w = window as unknown as Record<string, unknown>;
        if (!w.__modalEditors__) w.__modalEditors__ = {};
        (w.__modalEditors__ as Record<number, unknown>)[stackIndex] = controller.editor;
    }
});

// ─── Sensor Effect A: Dialog bind + rebuild token ───────────────────
let lastRebuildToken = 0;
$effect(() => {
    const el = dialogEl;
    const entry = $modalStack[stackIndex] as (ModalEntry & { rebuildToken?: number }) | undefined;
    const token = entry?.rebuildToken ?? 0;

    if (fsmState === "unmounted" && el && isTop) {
        send({ type: "DIALOG_BOUND" });
    } else if (!isTop && el?.open) {
        el.close();
    } else if (fsmState === "ready" && isTop && el && !el.open) {
        el.showModal();
    } else if (fsmState === "ready" && token && token !== lastRebuildToken) {
        lastRebuildToken = token;
        send({ type: "REBUILD_REQUESTED" });
    } else if (token) {
        // Keep the token in sync even if we're not in a state to act on it
        lastRebuildToken = token;
    }
});

// NOTE: $derived on view.state.field(...) is NOT reactive to CodeMirror
// transactions (view is a plain prop, so Svelte cannot observe mutations to
// view.state) — it would permanently capture the mount-time value. Event
// handlers that need current revision state call readRevision() instead;
// reactive code reads from modalAnnotations (see below).

let editorHost = $state<HTMLDivElement>();
let dialogEl = $state<HTMLDialogElement>();

// Manually-synced mirrors of the nested editor's CodeMirror state.
// The controller's onUpdate callback writes here on every transaction,
// making these the reactive entry-point for the Svelte template.
let modalAnnotations = $state<AnnotationsMap | undefined>(undefined);
let modalActiveAnnotation = $state<GenericAnnotation | undefined>(undefined);

// For deeply nested modals (level 2+), undo must target the root view
// that owns the history stack — not the immediate parent, which has
// history: false. The root is always the first modal entry's parent.
const historyView = stackIndex > 0 ? $modalStack[0].parentView : undefined;

const controller = new NestedEditorController(
    view,
    revisionId,
    {
        onUpdate: (annotations, activeAnnotation) => {
            modalAnnotations = annotations;
            modalActiveAnnotation = activeAnnotation;
        },
    },
    "flush",
    historyView,
);

function createEditor(version: VersionState, versionIndex?: number) {
    if (!editorHost || controller.editor) return;
    controller.create(editorHost, version, versionIndex ?? 0);
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
    controller.destroy();
    modalAnnotations = undefined;
    modalActiveAnnotation = undefined;
}

function close() {
    modalStack.pop();
}

// ─── Sensor Effect B: External sync (version switch + doc changes) ──
// Tracked by stable version id (not index) so a sibling version add/delete
// can't be misread as a version switch.
let lastSyncedVersionId: string | undefined;
$effect(() => {
    let ann: AnnotationsMap | undefined;
    if (stackIndex === 0) {
        ann = $annotationsStore;
    } else {
        const parentLevel = $modalAnnotationStores;
        ann = parentLevel[stackIndex - 1];
        if (!ann) return;
    }
    if (!ann) return;
    const rev = ann[revisionId] as Annotation<"revision"> | undefined;
    if (!rev || !isAnnotationOfType(rev, "revision")) return;
    const activeVersionState = versionById(rev, rev.activeVersionId);
    if (!activeVersionState) return;

    // Always track the latest version, even during rebuilds,
    // so the rebuild completes with the most recent version.
    if (fsmState !== "ready" || !controller.editor) {
        lastSyncedVersionId = rev.activeVersionId;
        return;
    }

    // Version switches rebuild the editor, which would destroy it while
    // a child modal depends on it. Only process when we're the top modal.
    // When not top, don't update lastSyncedVersionId — the mismatch
    // will be detected when the child modal closes and this becomes top,
    // triggering the deferred rebuild.
    if (lastSyncedVersionId !== undefined && rev.activeVersionId !== lastSyncedVersionId) {
        if (isTop) {
            lastSyncedVersionId = rev.activeVersionId;
            const entry = $modalStack[stackIndex] as
                | (ModalEntry & { rebuildToken?: number })
                | undefined;
            if (entry?.rebuildToken) lastRebuildToken = entry.rebuildToken;
            send({ type: "VERSION_SWITCHED" });
        }
        return;
    }
    lastSyncedVersionId = rev.activeVersionId;

    if (controller.needsAnnotationRebuild(activeVersionState)) {
        if (isTop) {
            send({ type: "REBUILD_REQUESTED" });
        }
        return;
    }

    const externalDoc = versionText(activeVersionState);
    send({ type: "EXTERNAL_DOC_CHANGED", doc: externalDoc });
});

// Phase 10: needsCollabModeRebuild $effect removed. Collab mode rebuild
// is no longer needed - nested editors always use local-only mode.

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
        if (
            !s2.selection.main.empty &&
            canCreateRevision(s2.field(annotationField), s2.selection)
        ) {
            const sel = s2.selection.main;
            const autoVersion = appSettings.autoVersionOnRevisionCreate;
            const { version: originalVersion, containedAnnotations } = makeVersionFromSelection(
                s2,
                s2.selection,
            );
            const versions: VersionState[] = autoVersion
                ? [originalVersion, makeVersion({ doc: "" })]
                : [originalVersion];
            const annotationSelection = autoVersion
                ? EditorSelection.single(sel.from)
                : s2.selection;
            const newAnnotation = createNewAnnotation(
                s2.field(annotationField),
                annotationSelection,
                "revision",
            );
            posthog.capture("annotation_created", {
                type: "revision",
                auto_version: autoVersion,
                nested: true,
            });
            activeEditor.dispatch(
                s2.update({
                    effects: [
                        ...containedAnnotations.map((annotation) =>
                            removeAnnotation.of(annotation),
                        ),
                        addAnnotation.of({
                            ...newAnnotation,
                            activeVersionId: (autoVersion ? versions[1] : versions[0]).id,
                            versions,
                        }),
                    ],
                    ...(autoVersion
                        ? {
                              changes: s2.changes({ from: sel.from, to: sel.to, insert: "" }),
                              selection: EditorSelection.cursor(sel.from),
                          }
                        : {}),
                    annotations: autoVersion
                        ? [
                              revisionInternalEdit.of(true),
                              revisionProvenance.of("human"),
                              Transaction.addToHistory.of(true),
                              isolateHistory.of("full"),
                          ]
                        : Transaction.addToHistory.of(true),
                }),
            );
            annotationEventBus.emit({
                type: "pending-nested-editor-selection",
                annotationId: newAnnotation.id,
                from: 0,
                to: !autoVersion && appSettings.selectTextInNestedEditor ? sel.to - sel.from : 0,
                focus: true,
            });
        }
    }
}

// ─── Sensor Effect C-0: ⌘Enter add-version from nested editor ─────
// When the nested editor's keymap fires annotation-add-version, handle
// it here so the duplicate guard runs before the FSM transitions to
// "rebuilding" — matching the header button's requestAddVersion() path.
// Without this, Revision.svelte handles the event and the modal relies
// on Sensor Effect B to detect the version change reactively, which
// races with other Svelte effects and can read stale state.
$effect(() => {
    return annotationEventBus.on("annotation-add-version", (event) => {
        if (event.annotationId !== revisionId || !isTop) return;
        requestAddVersion();
    });
});

// ─── Sensor Effect C: Nested annotation event ──────────────────────
$effect(() => {
    return annotationEventBus.on("nested-annotation-create", (event) => {
        if (
            fsmState !== "ready" ||
            !isTop ||
            !controller.editor ||
            event.command.revisionId !== revisionId ||
            event.sourceView !== view
        )
            return;
        send({ type: "NESTED_ANNOTATION_EVENT", cmd: event.command });
    });
});

// NOTE: No Sensor Effect D for nested revision clicks here.
// Revision focus requests from this modal's editor are handled by the
// Revision.svelte cards rendered in the modal's Annotations sidebar
// (which receive view={editor}). Those cards open inline editors or
// push modals as appropriate via their own focus-request handlers.

// Init is handled by FSM: unmounted → mounting → ready
// (See Sensor Effect A above which sends DIALOG_BOUND when dialogEl binds)

onDestroy(() => {
    destroyEditor();
    modalAnnotationStores.remove(stackIndex);
    // Notify Revision.svelte cards that a modal flushed annotations
    // back to the parent version blob. The inline editor needs to
    // rebuild from the flushed state. We emit this AFTER destroyEditor()
    // so the version blob is already updated when the listener fires.
    annotationEventBus.emit({
        type: "revision-modal-flushed",
        revisionId,
        sourceView: view,
    });
});

// Publish this modal's nested editor annotations to the global
// per-level store so child modals can reactively watch their parent.
$effect(() => {
    if (modalAnnotations) {
        modalAnnotationStores.set(stackIndex, modalAnnotations);
    }
});

/** Initial value for breadcrumb label editing (the active version's label). */
function getActiveVersionLabel(): string {
    const revision = readRevision();
    if (!revision) return "";
    return versionById(revision, revision.activeVersionId)?.label ?? "";
}

/** Commit a breadcrumb label rename for the active version ("" clears it). */
function commitVersionLabel(trimmed: string) {
    const revision = readRevision();
    if (!revision) return;
    view.dispatch(
        updateRevisionVersionLabel(
            view.state,
            revisionId,
            revision.activeVersionId,
            trimmed || undefined,
        ),
    );
}

function neverShowDuplicateDraftWarning(): void {
    appSettings.warnBeforeDraftAfterIdenticalVersion = false;
    persistSettings();
}

function hideDuplicateDraftWarningForOneHour(): void {
    appSettings.duplicateDraftWarningHiddenUntil = duplicateDraftWarningSnoozeUntil();
    persistSettings();
}

function addVersion(): void {
    const revision = readRevision();
    if (!revision) return;
    posthog.capture("revision_version_created", { version_count: revision.versions.length });
    view.dispatch(createNewRevision(view.state, revisionId));
    // FSM handles destroyEditor + popTo + tick + createEditor
    send({ type: "VERSION_SWITCHED" });
}

function requestAddVersion(): void {
    controller.flushCurrentStateToParent(false);
    const revision = readRevision();
    if (!revision) return;
    const isDuplicate = hasIdenticalPreviousVersion(
        revision.versions.map(versionText),
        activeVersionIndex(revision),
    );
    if (
        duplicateDraftWarningIsEnabled(
            appSettings.warnBeforeDraftAfterIdenticalVersion,
            appSettings.duplicateDraftWarningHiddenUntil,
        ) &&
        isDuplicate
    ) {
        duplicateDraftWarningOpen = true;
        return;
    }
    addVersion();
}

/**
 * Collapse the revision wrapper while preserving the active version's nested
 * annotations in the parent document (parity with the inline trash action).
 */
function deleteRevision() {
    const revision = readRevision();
    if (!revision) return;
    posthog.capture("annotation_deleted", {
        type: "revision",
        version_count: revision.versions.length,
        from_modal: true,
        nested_annotations_preserved: true,
    });
    controller.flushCurrentStateToParent(false);
    view.dispatch(collapseRevision(view.state, revisionId));
    close();
}

/**
 * Delete a single version from this modal's revision (parity with the
 * inline card's per-chip × button). Deleting the last remaining version
 * deletes the whole revision (annotationField handles that), so the
 * modal closes; otherwise the editor rebuilds on the new active version.
 */
function deleteVersion(vi: number) {
    const revision = readRevision();
    if (!revision) return;
    const versionId = revision.versions[vi]?.id;
    if (versionId === undefined) return;
    // Preserve any pending nested edits in the mounted version before the
    // delete (mirrors the inline card's flush-before-delete).
    controller.flushCurrentStateToParent(false);
    const wasLastVersion = revision.versions.length === 1;
    view.dispatch(deleteRevisionVersion(view.state, revisionId, versionId));
    if (wasLastVersion) {
        close();
        return;
    }
    send({ type: "VERSION_SWITCHED" });
}

function navigateVersion(direction: "prev" | "next") {
    const revision = readRevision();
    if (!revision) return;
    const count = revision.versions.length;
    if (count <= 1) return;
    const current = activeVersionIndex(revision);
    const next = direction === "next" ? (current + 1) % count : (current - 1 + count) % count;
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

function onDialogKeydownCapture(e: KeyboardEvent) {
    const target = e.target;
    if (e.key !== "Escape" || !(target instanceof Element)) return;
    if (!target.closest(".cm-editor")) return;
    e.preventDefault();
    close();
}

let revisionThread = $state(
    (view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined)?.thread ??
        [],
);

// Keep thread reactive to external changes (e.g. undo of a thread update).
// Uses the same per-level store strategy as the external-sync effect.
$effect(() => {
    let ann: AnnotationsMap | undefined;
    if (stackIndex === 0) {
        ann = $annotationsStore;
    } else {
        ann = $modalAnnotationStores[stackIndex - 1];
    }
    if (!ann) return;
    const rev = ann[revisionId] as Annotation<"revision"> | undefined;
    if (rev) revisionThread = rev.thread;
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

{#snippet annotationPanelContent()}
  {#if modalAnnotations}
    <Annotations
      view={controller.editor}
      annotationsData={modalAnnotations}
      activeAnnotationData={modalActiveAnnotation ?? null}
      nested
      layout="inline"
    />
  {/if}
{/snippet}

{#snippet annotationPanelEmpty()}
  <div class="flex flex-col items-center px-2 pt-4 text-center justify-evenly space-y-8">
    <p class="text-[11px] text-black/30 leading-relaxed">No annotations yet.</p>
    {#if appSettings.showShortcutHints}
      <p class="text-[11px] text-black/25 mb-3">Create one with:</p>
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 text-black/40">
          <Kbd keys={[modKey, "⇧", "C"]} />
          <span class="text-[11px] font-medium text-black/35">comment</span>
        </div>
        <div class="flex items-center gap-2 text-black/40">
          <Kbd keys={[modKey, opt, "K"]} />
          <span class="text-[11px] font-medium text-black/35">revision</span>
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet revisionHeaderLeading()}
  <RevisionBreadcrumbs
    {crumbs}
    {crumbRevisions}
    selectedVersions={crumbSelectedVersions}
    onselect={selectVersion}
    ondeleteversion={deleteVersion}
    getlabel={getActiveVersionLabel}
    oncommitlabel={commitVersionLabel}
  />
{/snippet}

{#snippet revisionHeaderActions()}
  {#if stackIndex > 0}
    <span class="text-[10px] text-purple-400/60 italic shrink-0">
      Click outside or press <Kbd keys={["Esc"]} /> to go back to parent
    </span>
  {/if}
  <button
    class="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-purple-600/80
        bg-purple-50/80 hover:bg-purple-100/60 rounded-md ring-1 ring-purple-200/50 transition-colors"
    onclick={requestAddVersion}
    title="New version ({modKey}↵)"
  >
    <PlusIcon size={10} />
    <span>New version</span>
    <Kbd keys={[modKey, "↵"]} />
  </button>
  <button
    class="p-1 rounded-md text-purple-400/50 hover:text-red-500/60 hover:bg-purple-50/80 transition-colors"
    onclick={deleteRevision}
    title="Collapse revision and preserve nested annotations"
    aria-label="Collapse revision and preserve nested annotations"
  >
    <Trash2 size={16} />
  </button>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  class="revision-modal"
  onclick={(e) => {
    if (e.target === dialogEl) close();
  }}
  oncancel={(e) => {
    e.preventDefault();
    close();
  }}
  onkeydowncapture={onDialogKeydownCapture}
  onkeydown={onDialogKeydown}
>
  <AnnotationModalFrame variant="revision">
    <AnnotationModalHeader
      accent="revision"
      leading={revisionHeaderLeading}
      actions={revisionHeaderActions}
      onClose={close}
      closeLabel="Close revision"
    />

    <TutorialGuide />

    <!-- Body: thread + editor + annotations panel -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Thread sidebar (left) -->
      <div
        class="revision-modal-thread shrink-0 border-r border-purple-100/60 flex flex-col min-h-0 bg-purple-50/90"
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
        <div class="w-72 shrink-0 border-l border-purple-100/60 flex flex-col min-h-0 bg-purple-50/20 overflow-x-hidden">

          <!-- Context panel -->
          <RevisionContextPanel {crumbs} refreshKey={modalAnnotations} />

          <!-- Annotations -->
          <AnnotationPanel
            bind:collapsed={annotationsCollapsed}
            hasContent={!!modalAnnotations && Object.keys(modalAnnotations).length > 0}
            content={annotationPanelContent}
            empty={annotationPanelEmpty}
          />

        </div>
    </div>
  </AnnotationModalFrame>
</dialog>

<DuplicateDraftWarning
  bind:open={duplicateDraftWarningOpen}
  onConfirm={addVersion}
  onHideForOneHour={hideDuplicateDraftWarningForOneHour}
  onNeverShowAgain={neverShowDuplicateDraftWarning}
/>

<style>
  .revision-modal {
    border: none;
    padding: 0;
    background: transparent;
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
  }

  .revision-modal[open] {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .revision-modal::backdrop {
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(4px);
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

  /* Version-dropdown styles live in RevisionBreadcrumbs.svelte; context-panel
     styles live in RevisionContextPanel.svelte. */
</style>
