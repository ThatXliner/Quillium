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
 *   - Creates a nested CodeMirror editor that dispatches doc
 *     changes directly to the parent via translateAndDispatch.
 *     State is flushed to the parent version blob on destroy.
 *   - Supports multi-level nesting: revisions inside revisions,
 *     with breadcrumb version dropdowns at each level.
 *   - Handles a pendingNestedCommand from the modal stack entry
 *     to auto-create a comment or sub-revision on open.
 */
import { EditorView } from "@codemirror/view";
import { Check, ChevronDown, ChevronRight, ChevronUp, PlusIcon, Trash2, X } from "lucide-svelte";
import { onDestroy } from "svelte";
import { scale, slide } from "svelte/transition";
import {
    type Annotation,
    type Annotations as AnnotationsMap,
    type GenericAnnotation,
    type Thread as ThreadType,
    addAnnotation,
    annotationField,
    createNewRevision,
    deleteRevisionVersion,
    removeAnnotation,
    revisionInternalEdit,
    setActiveRevisionVersion,
    updateRevisionVersionLabel,
    updateRevisionVersionState,
    updateThread,
} from ".";

import { annotationEventBus } from "$lib/events/annotationEventBus";
import posthog from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import {
    type ModalEntry,
    annotations as annotationsStore,
    modalAnnotationStores,
    modalStack,
} from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
import { EditorSelection, Transaction } from "@codemirror/state";
import Annotations from "./Annotations.svelte";
import { NestedEditorController } from "./NestedEditorController";
import Thread from "./Thread.svelte";
import TutorialGuide from "./TutorialGuide.svelte";
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
let annotationsCollapsed = $state(false);
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
    openDropdown = -1;

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
function readRevision() {
    return view.state.field(annotationField)[revisionId] as Annotation<"revision"> | undefined;
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
        if (
            !s2.selection.main.empty &&
            canCreateRevision(s2.field(annotationField), s2.selection)
        ) {
            const sel = s2.selection.main;
            const originalText = s2.sliceDoc(sel.from, sel.to);
            const autoVersion = appSettings.autoVersionOnRevisionCreate;
            const versions: VersionState[] = autoVersion
                ? [makeVersion({ doc: originalText }), makeVersion({ doc: "" })]
                : [makeVersion({ doc: originalText })];
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
                        ? [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)]
                        : Transaction.addToHistory.of(true),
                }),
            );
            if (appSettings.selectTextInNestedEditor && !sel.empty) {
                annotationEventBus.emit({
                    type: "pending-nested-editor-selection",
                    annotationId: newAnnotation.id,
                    from: 0,
                    to: autoVersion ? 0 : sel.to - sel.from,
                });
            }
        }
    }
}

// ─── Sensor Effect C-0: ⌘Enter add-version from nested editor ─────
// When the nested editor's keymap fires annotation-add-version, handle
// it here synchronously so the FSM transitions to "rebuilding" in the
// same microtask as the dispatch — matching what addVersion() does.
// Without this, Revision.svelte handles the event and the modal relies
// on Sensor Effect B to detect the version change reactively, which
// races with other Svelte effects and can read stale state.
$effect(() => {
    return annotationEventBus.on("annotation-add-version", (event) => {
        if (event.annotationId !== revisionId || !isTop) return;
        addVersion();
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

// Label editing state for the current crumb's version dropdown
let editingVersionLabel = $state(false);
let labelInputValue = $state("");
let labelInputEl = $state<HTMLInputElement | undefined>(undefined);

function startLabelEdit() {
    const revision = readRevision();
    if (!revision) return;
    labelInputValue = versionById(revision, revision.activeVersionId)?.label ?? "";
    editingVersionLabel = true;
}

// Focus the label input once it appears in the DOM after editingVersionLabel becomes true.
$effect(() => {
    if (editingVersionLabel && labelInputEl) {
        labelInputEl.focus();
    }
});

function commitLabelEdit() {
    const revision = readRevision();
    if (!revision) {
        editingVersionLabel = false;
        return;
    }
    const trimmed = labelInputValue.trim();
    view.dispatch(
        updateRevisionVersionLabel(
            view.state,
            revisionId,
            revision.activeVersionId,
            trimmed || undefined,
        ),
    );
    editingVersionLabel = false;
}

function cancelLabelEdit() {
    editingVersionLabel = false;
}

function addVersion() {
    const revision = readRevision();
    if (!revision) return;
    posthog.capture("revision_version_created", { version_count: revision.versions.length });
    view.dispatch(createNewRevision(view.state, revisionId));
    // FSM handles destroyEditor + popTo + tick + createEditor
    send({ type: "VERSION_SWITCHED" });
}

/**
 * Delete the entire revision (parity with the inline card's trash icon).
 * The removeAnnotation dispatch makes the revision disappear from the
 * parent view; the modal then closes. destroyEditor's flush is safely
 * skipped because flushAnnotationStateToParent no-ops when the revision
 * no longer exists in the parent state.
 */
function deleteRevision() {
    const revision = readRevision();
    if (!revision) return;
    posthog.capture("annotation_deleted", {
        type: "revision",
        version_count: revision.versions.length,
        from_modal: true,
    });
    view.dispatch(view.state.update({ effects: [removeAnnotation.of(revision)] }));
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
    openDropdown = -1;
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
  <div class="revision-modal-inner">
    <!-- Header -->
    <div
      class="flex items-center justify-between px-5 py-3 border-b border-[color:var(--border)] shrink-0 gap-3 min-w-0"
    >
      <!-- Breadcrumb trail -->
      <nav class="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
        {#each crumbs as crumb, ci}
          {@const isCurrent = ci === crumbs.length - 1}
          {@const crumbRevision = crumbRevisions[ci]}
          {@const selectedVi = crumbSelectedVersions[ci] ?? 0}

          {#if ci > 0}
            <ChevronRight size={10} class="text-purple-300/60 shrink-0" />
          {/if}

          <div class="flex items-center gap-1.5">
            <!-- "Revision" label — clickable back if not current -->
            {#if isCurrent}
              <span
                class="text-[10px] font-semibold text-[color:var(--accent-purple-text)] uppercase tracking-wider shrink-0"
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
                        bg-[color:var(--chip-purple-strong)] text-[color:var(--accent-purple-text)] ring-1 ring-[color:var(--chip-purple-border)] outline-none
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
                    ? 'bg-[color:var(--chip-purple)] text-[color:var(--accent-purple-text)] hover:bg-[color:var(--chip-purple-strong)] ring-1 ring-[color:var(--chip-purple-border)]'
                    : 'bg-[color:var(--surface-2)] text-[color:var(--text-faint)] hover:bg-[color:var(--surface-3)] ring-1 ring-[color:var(--border)]'}
                                        {openDropdown === ci
                    ? 'ring-2 ' +
                      (isCurrent ? 'ring-[color:var(--chip-purple-border)]' : 'ring-[color:var(--border-strong)]')
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
                      : 'text-[color:var(--text-ghost)]'}"
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
                      <div
                        class="version-option {isSelected
                          ? 'version-option-active'
                          : ''}"
                      >
                        <button
                          class="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                          onclick={() => selectVersion(ci, vi, crumb, isCurrent)}
                        >
                          <span class="flex-1 truncate"
                            >{version.label ?? previewVersionText(version)}</span
                          >
                          {#if isSelected}
                            <Check
                              size={10}
                              class="text-purple-500/70 shrink-0"
                            />
                          {/if}
                        </button>
                        {#if isCurrent}
                          <button
                            class="shrink-0 p-0.5 rounded text-[color:var(--text-ghost)] hover:text-red-500/70 transition-colors"
                            onclick={(e) => {
                              e.stopPropagation();
                              deleteVersion(vi);
                            }}
                            title={`Delete version ${vi + 1}`}
                            aria-label={`Delete version ${vi + 1}`}
                          >
                            <X size={9} />
                          </button>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </nav>

      {#if stackIndex > 0}
        <span class="text-[10px] text-purple-400/60 italic shrink-0">
          Click outside or press <Kbd keys={["Esc"]} /> to go back to parent
        </span>
      {/if}

      <!-- Right actions -->
      <div class="flex items-center gap-2 shrink-0">
        <button
          class="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-[color:var(--accent-purple-text)]
              bg-[color:var(--chip-purple)] hover:bg-[color:var(--chip-purple-strong)] rounded-md ring-1 ring-[color:var(--chip-purple-border)] transition-colors"
          onclick={addVersion}
          title="New version ({modKey}↵)"
        >
          <PlusIcon size={10} />
          <span>New version</span>
          <Kbd keys={[modKey, "↵"]} />
        </button>
        <button
          class="p-1 rounded-md text-purple-400/50 hover:text-red-500/60 hover:bg-[color:var(--surface-2)] transition-colors"
          onclick={deleteRevision}
          title="Delete entire revision"
          aria-label="Delete entire revision"
        >
          <Trash2 size={16} />
        </button>
        <button
          class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-[color:var(--text-ghost)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)] transition-colors"
          onclick={close}
        >
          <span class="text-[9px] font-mono text-[color:var(--text-ghost)] leading-none">esc</span>
          <X size={16} />
        </button>
      </div>
    </div>

        <TutorialGuide />

    <!-- Body: thread + editor + annotations panel -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Thread sidebar (left) -->
      <div
        class="revision-modal-thread shrink-0 border-r border-[color:var(--border)] flex flex-col min-h-0 bg-[color:var(--surface-2)]"
      >
        <div class="px-4 py-3 border-b border-[color:var(--border)] shrink-0">
          <span
            class="text-[9px] font-semibold text-[color:var(--accent-purple-text)] uppercase tracking-wider"
            >Thread</span
          >
        </div>
        <div class="flex-1 overflow-y-auto px-4 py-3">
          {#if revisionThread.length === 0}
            <p class="text-[11px] text-[color:var(--text-soft)] leading-relaxed mb-3">
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
        <div class="w-72 shrink-0 border-l border-[color:var(--border)] flex flex-col min-h-0 bg-[color:var(--surface-2)] overflow-x-hidden">

          <!-- Context panel -->
          {#if contextLayers.length > 0}
            <div class="border-b border-[color:var(--border)] shrink-0">
              <button
                class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[color:var(--surface-3)] transition-colors"
                onclick={() => contextCollapsed = !contextCollapsed}
              >
                <span class="text-[9px] font-semibold text-[color:var(--accent-purple-text)] uppercase tracking-wider">Context</span>
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
          <div class="flex-1 min-h-0 flex flex-col">
            <button
              class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[color:var(--surface-3)] transition-colors shrink-0"
              onclick={() => annotationsCollapsed = !annotationsCollapsed}
            >
              <span class="text-[9px] font-semibold text-[color:var(--accent-purple-text)] uppercase tracking-wider">Annotations</span>
              {#if annotationsCollapsed}
                <ChevronDown size={10} class="text-purple-400/50" />
              {:else}
                <ChevronUp size={10} class="text-purple-400/50" />
              {/if}
            </button>
            {#if !annotationsCollapsed}
              <div transition:slide={{ duration: 180 }} class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {#if modalAnnotations && Object.keys(modalAnnotations).length > 0}
                  <Annotations
                    view={controller.editor}
                    annotationsData={modalAnnotations}
                    activeAnnotationData={modalActiveAnnotation ?? null}
                    layout="inline"
                  />
                {:else}
                  <div class="flex flex-col items-center px-2 pt-4 text-center justify-evenly space-y-8">
                    <p class="text-[11px] text-[color:var(--text-soft)] leading-relaxed">No annotations yet.</p>
                    {#if appSettings.showShortcutHints}
                      <p class="text-[11px] text-[color:var(--text-soft)] mb-3">Create one with:</p>
                      <div class="flex flex-col gap-2">
                        <div class="flex items-center gap-2 text-[color:var(--text-soft)]">
                          <Kbd keys={[modKey, opt, "M"]} />
                          <span class="text-[11px] font-medium text-[color:var(--text-soft)]">comment</span>
                        </div>
                        <div class="flex items-center gap-2 text-[color:var(--text-soft)]">
                          <Kbd keys={[modKey, opt, "K"]} />
                          <span class="text-[11px] font-medium text-[color:var(--text-soft)]">revision</span>
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>

        </div>
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

  .revision-modal-inner {
    display: flex;
    flex-direction: column;
    width: 1160px;
    height: 72vh;
    background: var(--surface);
    border-radius: 1rem;
    box-shadow: 0 25px 50px -12px rgba(var(--shadow-color), 0.25);
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

  .version-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 160px;
    max-width: 240px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow:
      0 8px 24px -4px rgba(var(--shadow-color), 0.12),
      0 2px 8px -2px rgba(var(--shadow-color), 0.08);
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
    color: var(--text-soft);
    transition:
      background 0.1s,
      color 0.1s;
    cursor: pointer;
  }

  .version-option:hover {
    background: var(--surface-2);
    color: var(--accent-purple-text);
  }

  .version-option-active {
    background: var(--surface-3);
    color: var(--accent-purple-text);
    font-weight: 500;
  }

  .context-scroll {
    height: 200px;
    overflow-y: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding: 10px 14px;
    background: var(--surface-3);
    backdrop-filter: blur(12px) saturate(1.3);
    -webkit-backdrop-filter: blur(12px) saturate(1.3);
  }

  .context-scroll::-webkit-scrollbar {
    display: none;
  }

  /* Base text layer (outermost / depth-0) */
  .context-text {
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint);
    font-family: var(--doc-font-family, system-ui, sans-serif);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .context-depth-0 {
    display: block;
  }


  /* Each nesting level: inset block with deeper purple bg + stronger text */
  .context-nest {
    display: inline;
    border-radius: 4px;
    padding: 1px 3px;
  }

  /* Depth 0: outermost revision highlight (light purple) */
  .context-nest-0 {
    background: var(--chip-purple);
    color: var(--accent-purple-text);
    box-shadow: inset 0 0 0 1px var(--chip-purple-border);
  }

  /* Depth 1: one level in (medium purple) */
  .context-nest-1 {
    background: var(--chip-purple-strong);
    color: var(--accent-purple-text);
    box-shadow: inset 0 0 0 1px var(--chip-purple-border);
  }

  /* Depth 2: two levels in (deeper purple) */
  .context-nest-2 {
    background: var(--chip-purple-strong);
    color: var(--accent-purple-text);
    box-shadow: inset 0 0 0 2px var(--chip-purple-border);
  }

  /* Depth 3+: innermost / deepest (richest purple) */
  .context-nest-3 {
    background: var(--chip-purple-strong);
    color: var(--accent-purple-text);
    font-weight: 500;
    box-shadow: inset 0 0 0 2px var(--chip-purple-border);
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
    color: var(--accent-purple-text);
    background: var(--chip-purple);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid var(--chip-purple-border);
    border-radius: 99px;
    box-shadow: 0 2px 8px rgba(var(--shadow-color), 0.12);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    z-index: 2;
  }

  .context-jump-btn:hover {
    background: var(--chip-purple-strong);
    color: var(--accent-purple-text);
  }

  .context-jump-top {
    top: 14px;
  }

  .context-jump-bottom {
    bottom: 14px;
  }
</style>
