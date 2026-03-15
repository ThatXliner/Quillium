/**
 * stores.ts — Global reactive state hub for Quillium.
 *
 * ## Why manual sync is necessary
 *
 * CodeMirror 6 manages its own immutable state tree (EditorState).
 * On every keystroke or command, CodeMirror creates a *new* EditorState
 * object and swaps it into EditorView.state — but EditorView itself is a
 * stable mutable object. Svelte's reactivity system ($derived, $effect)
 * tracks reads of $state/$props proxies. Because EditorView is a plain
 * class instance (not wrapped in $state), Svelte never observes the swap
 * of view.state, so:
 *
 *   - $derived(view.state.field(annotationField)) evaluates once at
 *     component init and is NEVER re-run when CodeMirror processes a
 *     transaction.
 *   - $effect blocks that read view.state directly are equally blind
 *     to CodeMirror transactions.
 *
 * The only correct way to bridge CodeMirror → Svelte reactivity is to
 * hook into CodeMirror's own change notification system (updateListener /
 * ViewPlugin) and manually write values into Svelte-reactive state
 * ($state variables or writable stores). Those writes then propagate
 * normally through $derived and $effect.
 *
 * ## Sync points in this codebase
 *
 *   1. Editor.svelte updateListener — fires on every transaction in the
 *      main editor. Writes: annotations, activeAnnotation, documentContent,
 *      selectedText.
 *   2. RevisionModal.svelte createEditor updateListener — fires on every
 *      transaction in a nested revision editor. Writes: modalAnnotations,
 *      modalActiveAnnotation (local $state in that component).
 *
 * Stores defined here are consumed across all three panels:
 *   - Left panel  (AI sidebar)  reads documentContent, selectedText
 *   - Center panel (editor)     writes most stores via updateListener
 *   - Right panel  (annotations) reads annotations, activeAnnotation
 *
 * The modal stack manages nested revision/diff overlays that can
 * be arbitrarily deep (revisions inside revisions).
 */
import type { EditorView } from "@codemirror/view";
import { writable } from "svelte/store";
import type { Annotations, GenericAnnotation } from "./editor/plugins/annotations";

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
export const activeAnnotation = writable<GenericAnnotation | undefined>();

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
 * The ID of the document currently open in the editor.
 * null means no document is open (e.g., on the library page).
 * Written by: Editor.svelte on load, library page on "Open".
 * Read by: listeners.ts (save branch), StatusBar, library.
 */
export const currentDocumentId = writable<string | null>(null);

/**
 * The display title of the currently open document.
 * Written by: listeners.ts on every save (derived from first line).
 * Read by: StatusBar, library page ContinuePill.
 */
export const currentDocumentTitle = writable<string>("Untitled");

/**
 * Save status for the status bar indicator.
 * Written by: listeners.ts — 'saving' on dispatch, 'saved' on success, 'error' on failure.
 * Read by: StatusBar.svelte.
 */
export const saveStatus = writable<"saved" | "saving" | "error">("saved");

/**
 * The ID of the active draft for the current document.
 * Written by: Editor.svelte on load and when switching drafts.
 * Read by: listeners.ts to route append_event calls.
 */
export const currentDraftId = writable<string | null>(null);

/**
 * Controls tutorial overlay visibility.
 * Written by: +page.svelte (on first visit), StatusBar.svelte
 *             (the "?" button), Tutorial.svelte (on complete).
 * Read by: +page.svelte to conditionally render <Tutorial>.
 */
export const tutorialActive = writable(false);

export type TutorialModalGuide = {
    visible: boolean;
    title: string;
    body: string;
    hint: string | null;
    nextDisabled: boolean;
    isLast: boolean;
    canBack: boolean;
};

export const tutorialModalGuide = writable<TutorialModalGuide>({
    visible: false,
    title: "",
    body: "",
    hint: null,
    nextDisabled: false,
    isLast: false,
    canBack: false,
});

export const tutorialNavCommand = writable<"next" | "back" | "skip" | null>(null);

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

/**
 * One-shot UI events emitted by annotation commands/plugins and
 * consumed by Svelte components. Keeps editor plugin logic decoupled
 * from component-specific stores.
 */
export type AnnotationUiEvent =
    | {
          token: number;
          type: "revision-boundary-nudge";
          revisionId: number;
      }
    | {
          token: number;
          type: "revision-open-nested-editor";
          command: NestedEditorCommand;
      }
    | {
          token: number;
          type: "revision-focus-request";
          revisionId: number;
          relativePos: number;
      }
    | {
          token: number;
          type: "pending-comment-alert";
      }
    | {
          token: number;
          type: "pending-nested-editor-selection";
          annotationId: number;
          from: number;
          to: number;
      }
    | {
          token: number;
          type: "annotation-focus-reply";
          annotationId: number;
      }
    | {
          token: number;
          type: "annotation-add-version";
          annotationId: number;
      };

type WithoutToken<T> = T extends { token: number } ? Omit<T, "token"> : never;
export type AnnotationUiEventInput = WithoutToken<AnnotationUiEvent>;

export const annotationUiEvent = writable<AnnotationUiEvent | null>(null);

let nextAnnotationUiEventToken = 1;

type PendingNestedEditorSelectionEvent = Extract<AnnotationUiEvent, { type: "pending-nested-editor-selection" }>;
const pendingNestedEditorSelections = new Map<number, PendingNestedEditorSelectionEvent>();

function storePendingNestedEditorSelection(event: PendingNestedEditorSelectionEvent) {
    pendingNestedEditorSelections.set(event.annotationId, event);
}

export function consumePendingNestedEditorSelection(
    annotationId: number,
    lastToken: number,
) {
    const selection = pendingNestedEditorSelections.get(annotationId);
    if (!selection || selection.token === lastToken) return undefined;
    pendingNestedEditorSelections.delete(annotationId);
    return selection;
}

export function publishAnnotationUiEvent(event: AnnotationUiEventInput) {
    const payload = {
        ...event,
        token: nextAnnotationUiEventToken++,
    } as AnnotationUiEvent;
    annotationUiEvent.set(payload);
    if (payload.type === "pending-nested-editor-selection") {
        storePendingNestedEditorSelection(payload);
    }
}

// ── Modal stack types ────────────────────────────────────────

/** A single diff operation used in diff display. */
export type DiffOp = {
    type: "equal" | "delete" | "insert";
    text: string;
};

/** A command queued for execution inside a nested revision editor. */
export type PendingNestedCommand = {
    type: "comment" | "revision" | "cursor";
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
    | {
          type: "revision";
          revisionId: number;
          parentView: EditorView;
          label: string;
          pendingNestedCommand?: PendingNestedCommand;
      };

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
export const modalStack = {
    subscribe: _modalStack.subscribe,
    push: (entry: ModalEntry) => _modalStack.update((s) => [...s, entry]),
    pop: () => _modalStack.update((s) => s.slice(0, -1)),
    popTo: (index: number) => _modalStack.update((s) => s.slice(0, index + 1)),
    popToAndRebuild: (index: number) =>
        _modalStack.update((s) => {
            const trimmed = s.slice(0, index + 1);
            const target = trimmed[index];
            if (!target) return trimmed;
            trimmed[index] = { ...target, rebuildToken: Date.now() } as ModalEntry & {
                rebuildToken: number;
            };
            return trimmed;
        }),
    clear: () => _modalStack.set([]),
};
