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
 *      selectedText, selectedTextRange.
 *   2. RevisionModal.svelte createEditor updateListener — fires on every
 *      transaction in a nested revision editor. Writes: modalAnnotations,
 *      modalActiveAnnotation (local $state in that component).
 *
 * Stores defined here are consumed across all three panels:
 *   - Left panel  (AI sidebar)  reads documentContent, selectedText,
 *      selectedTextRange
 *   - Center panel (editor)     writes most stores via updateListener
 *   - Right panel  (annotations) reads annotations, activeAnnotation
 *
 * The modal stack manages nested revision/diff overlays that can
 * be arbitrarily deep (revisions inside revisions).
 */
import type { EditorView } from "@codemirror/view";
import { writable } from "svelte/store";
import type { Annotations, GenericAnnotation, VersionGroups } from "./editor/plugins/annotations";
import posthog from "./posthog";

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
 * Mirror of the CodeMirror versionGroupField state (version groups, #268).
 * Written by: Editor.svelte updateListener on every transaction.
 * Read by: Revision.svelte to render the "link to group" affordance and the
 *          group badge on linked version pills.
 *
 * Manually synced for the same reason as `annotations` above.
 */
export const versionGroups = writable<VersionGroups | undefined>();

/**
 * Cross-card "link mode" anchor (version groups, #268). When the user starts
 * linking from a version pill, the anchor (that member + its group if any) is
 * held here; the next pill they pick on a DIFFERENT revision completes the link.
 * Shared across Revision cards because a group spans multiple revisions, so the
 * two picks happen on two different components. null = not linking.
 */
export const linkAnchor = writable<{
    member: { revisionId: number; versionId: string };
    groupId?: string;
} | null>(null);

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
 * CodeMirror offsets for the active editor selection.
 * Written alongside selectedText so AI context builders can use the
 * actual editor range instead of searching for repeated selected text.
 */
export type EditorTextRange = { from: number; to: number };
export const selectedTextRange = writable<EditorTextRange | undefined>(undefined);

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
 * The ID of the active document tab (#160).
 * Written by: Editor.svelte on load and when switching tabs.
 * Read by: Editor.svelte draft-tree handlers.
 */
export const currentTabId = writable<string | null>(null);

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
 * The DB id of the most recently persisted event for the current draft.
 * Updated by listeners.ts after each successful appendEvent.
 */
export const lastPersistedEventId = writable<number>(-1);

/**
 * Unix timestamp (ms) of the most recent successful save.
 * null until the first save in the current session.
 */
export const lastSavedAt = writable<number | null>(null);

/**
 * Real-time writing statistics, synced from Editor.svelte on every transaction.
 * Read by WordCountOverlay.svelte.
 */
export const writingStats = writable({ words: 0, chars: 0, selWords: 0, selChars: 0 });

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

// ── Modal stack types ────────────────────────────────────────

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
      }
    | { type: "comment"; commentId: number; parentView: EditorView; label: string };

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
// ── Error banner store ────────────────────────────────────────

/**
 * When set, an error banner is shown at the top of the app.
 * null = no banner. Set by hooks.client.ts on crash or by
 * listeners.ts when a suspicious change is detected.
 */
export type ErrorBannerState = {
    message: string;
    /** Whether there is a backup available for the user to restore */
    hasBackup: boolean;
    /** "auto" = suspicious-change backup, "crash" = crash backup */
    backupType: "auto" | "crash";
    /** Optional error details (stack trace, error message) for debugging */
    details?: string;
};

export const errorBanner = writable<ErrorBannerState | null>(null);

/**
 * Controls settings modal visibility globally.
 * `false` = closed, `true` = open, `string` = open and scroll to the
 * setting with that `data-setting-id`, then flash it.
 * Written by: +page.svelte (Cmd+,), StatusBar.svelte (gear button), Tauri menu.
 * Read by: StatusBar.svelte to render <SettingsModal>.
 */
export const settingsOpen = writable<false | true | string>(false);

/**
 * Controls stats modal visibility globally.
 * Written by: StatusBar.svelte (stats button).
 * Read by: +page.svelte to render <StatsModal>.
 */
export const statsOpen = writable(false);

/** Whether the feature-flagged writing prompt picker is open. */
export const writingPromptOpen = writable(false);

/**
 * Drops per-modal annotation state for stack indices [fromIndex, toIndex).
 * Every stack-shrinking operation must call this so a closed modal's
 * annotation state can't leak into a future modal at the same index.
 */
function trimModalAnnotationStores(fromIndex: number, toIndex = fromIndex + 1): void {
    if (toIndex <= fromIndex || fromIndex < 0) return;
    _modalAnnotationStores.update((m) => {
        const copy = { ...m };
        for (let i = fromIndex; i < toIndex; i++) delete copy[i];
        return copy;
    });
}

export const modalStack = {
    subscribe: _modalStack.subscribe,
    push: (entry: ModalEntry) =>
        _modalStack.update((s) => {
            // Prevent duplicate modals for the same annotation + parent view
            // anywhere in the stack, not just the top.
            const isDuplicate = s.some(
                (existing) =>
                    existing.type === entry.type &&
                    existing.parentView === entry.parentView &&
                    ((existing.type === "revision" &&
                        entry.type === "revision" &&
                        existing.revisionId === entry.revisionId) ||
                        (existing.type === "diff" &&
                            entry.type === "diff" &&
                            existing.suggestionId === entry.suggestionId) ||
                        (existing.type === "comment" &&
                            entry.type === "comment" &&
                            existing.commentId === entry.commentId)),
            );
            if (isDuplicate) {
                posthog.capture("modal_stack_duplicate_push", {
                    entry_type: entry.type,
                    revision_id: entry.type === "revision" ? entry.revisionId : undefined,
                    suggestion_id: entry.type === "diff" ? entry.suggestionId : undefined,
                    comment_id: entry.type === "comment" ? entry.commentId : undefined,
                });
                return s;
            }
            return [...s, entry];
        }),
    pop: () =>
        _modalStack.update((s) => {
            trimModalAnnotationStores(s.length - 1);
            return s.slice(0, -1);
        }),
    popTo: (index: number) =>
        _modalStack.update((s) => {
            trimModalAnnotationStores(index + 1, s.length);
            return s.slice(0, index + 1);
        }),
    popToAndRebuild: (index: number) =>
        _modalStack.update((s) => {
            trimModalAnnotationStores(index + 1, s.length);
            const trimmed = s.slice(0, index + 1);
            const target = trimmed[index];
            if (!target) return trimmed;
            trimmed[index] = { ...target, rebuildToken: Date.now() } as ModalEntry & {
                rebuildToken: number;
            };
            return trimmed;
        }),
    replace: (entries: ModalEntry[]) => {
        _modalAnnotationStores.set({});
        _modalStack.set(entries);
    },
    consumePendingCommand: (index: number) => {
        let pending: PendingNestedCommand | undefined;
        _modalStack.update((s) => {
            const entry = s[index];
            if (entry?.type !== "revision" || !entry.pendingNestedCommand) return s;
            pending = entry.pendingNestedCommand;
            const copy = [...s];
            copy[index] = { ...entry, pendingNestedCommand: undefined };
            return copy;
        });
        return pending;
    },
    clear: () => {
        _modalStack.set([]);
        _modalAnnotationStores.set({});
    },
};

// ── Per-modal annotation state ───────────────────────────────
//
// Each RevisionModal publishes its nested editor's annotation state
// into this map (keyed by stackIndex). Child modals at stackIndex N
// read from entry N-1 to find their parent's annotations — this is
// the reactive trigger that replaces $annotationsStore for deeply
// nested modals.

const _modalAnnotationStores = writable<Record<number, Annotations>>({});

export const modalAnnotationStores = {
    subscribe: _modalAnnotationStores.subscribe,
    set(index: number, annotations: Annotations) {
        _modalAnnotationStores.update((m) => ({ ...m, [index]: annotations }));
    },
    remove(index: number) {
        _modalAnnotationStores.update((m) => {
            const copy = { ...m };
            delete copy[index];
            return copy;
        });
    },
};
