/**
 * stores.ts — Global reactive state hub for Quillium.
 *
 * Because CodeMirror manages its own state internally and the
 * Svelte store for `editorView` is only set once (it holds a
 * mutable reference that never triggers reactive updates), we
 * maintain *manually-synced* mirror stores for editor-derived
 * values that Svelte components need to react to (annotations,
 * active annotation, document content, selected text). The
 * synchronization happens in Editor.svelte's `updateListener`.
 *
 * Stores defined here are consumed across all three panels of
 * the application layout:
 *   - Left panel  (AI sidebar)  reads documentContent, selectedText
 *   - Center panel (editor)     writes most stores via updateListener
 *   - Right panel  (annotations) reads annotations, activeAnnotation
 *
 * The modal stack manages nested revision/diff overlays that can
 * be arbitrarily deep (revisions inside revisions).
 */
import type { EditorView } from "@codemirror/view";
import { writable, derived } from "svelte/store";

import { getActiveAnnotation } from "./editor/plugins/annotations/utils";
import type {
  Annotation,
  Annotations,
  GenericAnnotation,
} from "./editor/plugins/annotations";

/**
 * The main CodeMirror EditorView instance. Set once when
 * Editor.svelte mounts. Read by any component that needs direct
 * imperative access to the editor (e.g., AI sidebar for applying
 * revisions, annotations panel for scrolling to a range).
 *
 * Note: this store is *not* updated on every editor transaction —
 * it holds a stable reference. For reactive data derived from the
 * editor, use the manually-synced stores below.
 */
export const editorView = writable<EditorView>();

/**
 * Mirror of the CodeMirror annotationField state.
 * Written by: Editor.svelte updateListener on every transaction.
 * Read by: Annotations.svelte (right panel) to render the list.
 *
 * We cannot derive this from `editorView` because that store
 * never re-fires; instead we manually push new values whenever
 * the annotation state field changes.
 */
export const annotations = writable<Annotations | undefined>();

/**
 * The currently focused annotation (comment or revision), if any.
 * Written by: Editor.svelte updateListener when selection changes.
 * Read by: Annotations.svelte to highlight the active annotation,
 *          Comment.svelte / Revision.svelte for active styling.
 *
 * Manually synced for the same reason as `annotations` above.
 */
export const activeAnnotation = writable<
    GenericAnnotation | undefined
>();

/**
 * Full document text, synced on every editor transaction.
 * Written by: Editor.svelte updateListener.
 * Read by: AI sidebar (Chat.svelte, Feedback.svelte, Revise.svelte)
 *          to include document context in AI prompts.
 */
export const documentContent = writable<string>("");

/**
 * Currently selected text in the editor.
 * Written by: Editor.svelte updateListener on selection change.
 * Read by: AI sidebar to scope AI operations to the selection.
 */
export const selectedText = writable<string>("");

/**
 * Boundary-nudge signal for nested revision editors.
 * Fired when the user presses a delete key at the boundary of an
 * active revision — signals that the recursive editor is available
 * for boundary edits. Value is a timestamp token; null means idle.
 */
export const revisionBoundaryNudge = writable<number | null>(null);

/**
 * Controls tutorial overlay visibility.
 * Written by: +page.svelte (on first visit), StatusBar.svelte
 *             (the "?" button), Tutorial.svelte (on complete).
 * Read by: +page.svelte to conditionally render <Tutorial>.
 */
export const tutorialActive = writable(false);

/**
 * Command payload dispatched when the user triggers an annotation
 * command (comment/revision) while the cursor is inside an active
 * revision in the main document. Carries the revision ID, command
 * type, and the selection mapped to offsets within the revision
 * text so the nested editor can set its selection and run the
 * command immediately.
 */
export type NestedEditorCommand = {
    revisionId: number;
    type: "comment" | "revision";
    selectionFrom: number;
    selectionTo: number;
};
export const revisionOpenNestedEditor = writable<
    NestedEditorCommand | null
>(null);

// ── Modal stack types ────────────────────────────────────────

/** A single diff operation used in diff display. */
export type DiffOp = {
    type: "equal" | "delete" | "insert";
    text: string;
};

/** A command queued for execution inside a nested revision editor. */
export type PendingNestedCommand = {
    type: "comment" | "revision";
    selectionFrom: number;
    selectionTo: number;
};

/**
 * Discriminated union for items in the modal stack.
 * - "diff": a side-by-side diff overlay for a suggestion
 * - "revision": a nested revision editor overlay
 */
export type ModalEntry =
    | { type: "diff"; suggestionId: number; parentView: EditorView; label: string }
    | { type: "revision"; revisionId: number; parentView: EditorView; label: string; pendingNestedCommand?: PendingNestedCommand };

// ── Modal stack store ────────────────────────────────────────

/**
 * Internal writable backing the modal stack. Not exported directly;
 * consumers interact through the `modalStack` API below.
 */
const _modalStack = writable<ModalEntry[]>([]);

/**
 * Modal portal store — a stack so nested revisions can push/pop
 * modals to arbitrary depth.
 *
 * Written by: RevisionModal.svelte, DiffModal.svelte, annotation
 *             commands that open overlays.
 * Read by: +page.svelte to render the stack of modal overlays.
 *
 * Methods:
 *   push(entry)         — open a new modal on top
 *   pop()               — close the topmost modal
 *   popTo(index)        — close all modals above `index`
 *   popToAndRebuild(i)  — popTo + stamp a rebuild token so the
 *                          target modal recreates its editor
 *   clear()             — close all modals
 */
/**
 * Fired when the user attempts to create a new comment while one
 * is already pending. Triggers a shake + red-outline animation on
 * the pending comment card to draw attention to it.
 * Value is a timestamp used as a signal token (null = idle).
 */
export const pendingCommentAlert = writable<number | null>(null);

/**
 * When the user creates a revision (or comment) annotation from a
 * text selection, and the "select text in nested editor" setting is
 * enabled, this store carries the selection range (relative to the
 * revision's start) that the nested editor should apply after mount.
 * Reset to null once consumed by Revision.svelte.
 */
export const pendingNestedEditorSelection = writable<{
    annotationId: number;
    from: number;
    to: number;
} | null>(null);

export const modalStack = {
    subscribe: _modalStack.subscribe,
    push: (entry: ModalEntry) =>
        _modalStack.update((s) => [...s, entry]),
    pop: () => _modalStack.update((s) => s.slice(0, -1)),
    popTo: (index: number) =>
        _modalStack.update((s) => s.slice(0, index + 1)),
    popToAndRebuild: (index: number) => _modalStack.update((s) => {
        const trimmed = s.slice(0, index + 1);
        const target = trimmed[index];
        if (!target) return trimmed;
        trimmed[index] = { ...target, rebuildToken: Date.now() } as ModalEntry & { rebuildToken: number };
        return trimmed;
    }),
    clear: () => _modalStack.set([]),
};
