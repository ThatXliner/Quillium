import type { EditorView } from "@codemirror/view";
import { writable, derived } from "svelte/store";

import { getActiveAnnotation } from "./editor/plugins/annotations/utils";
import type {
  Annotation,
  Annotations,
  GenericAnnotation,
} from "./editor/plugins/annotations";

export const editorView = writable<EditorView>();
// We need to manually hook into when the annotations change
// (editorView never gets updated... maybe I could do that? Would
// that be premature optimization or just passing in a reference?)
// So we manually manage and sync our own version of annotations
// as opposed to derived from editorView
export const annotations = writable<Annotations | undefined>();
// For similar reasons (getActiveAnnotation relies on editor.state, which relies on editorView)
// we have to manually manage and sync our own version of activeAnnotation
export const activeAnnotation = writable<GenericAnnotation | undefined>();

// Manually synced document content and selection for AI chat context
// (similar to how we manually sync annotations)
export const documentContent = writable<string>("");
export const selectedText = writable<string>("");

// Fired when the user presses a delete key at the boundary of an active
// revision — signals that the recursive editor is available for boundary edits.
export const revisionBoundaryNudge = writable<number | null>(null);

// Controls tutorial visibility
export const tutorialActive = writable(false);

// Fired when the user triggers an annotation command (comment/revision)
// while the cursor is inside an active revision in the main document.
// Carries the revision ID, which command to run, and the selection
// mapped to offsets within the revision text so the nested editor
// can set its selection and run the command immediately.
export type NestedEditorCommand = {
    revisionId: number;
    type: "comment" | "revision";
    selectionFrom: number;
    selectionTo: number;
};
export const revisionOpenNestedEditor = writable<NestedEditorCommand | null>(null);

// Modal portal store — a stack so nested revisions can push/pop modals.
export type DiffOp = { type: "equal" | "delete" | "insert"; text: string };
export type PendingNestedCommand = {
    type: "comment" | "revision";
    selectionFrom: number;
    selectionTo: number;
};

export type ModalEntry =
    | { type: "diff"; ops: DiffOp[]; suggestionId: number; parentView: EditorView; label: string }
    | { type: "revision"; revisionId: number; parentView: EditorView; label: string; pendingNestedCommand?: PendingNestedCommand };

const _modalStack = writable<ModalEntry[]>([]);

export const modalStack = {
    subscribe: _modalStack.subscribe,
    push: (entry: ModalEntry) => _modalStack.update((s) => [...s, entry]),
    pop: () => _modalStack.update((s) => s.slice(0, -1)),
    popTo: (index: number) => _modalStack.update((s) => s.slice(0, index + 1)),
    // Pop to index and stamp a rebuild token on the target entry so the modal
    // at that level knows to destroy/recreate its editor for the new version.
    popToAndRebuild: (index: number) => _modalStack.update((s) => {
        const trimmed = s.slice(0, index + 1);
        const target = trimmed[index];
        if (!target) return trimmed;
        trimmed[index] = { ...target, rebuildToken: Date.now() } as ModalEntry & { rebuildToken: number };
        return trimmed;
    }),
    clear: () => _modalStack.set([]),
};

// In case we decide to bite the dust with updating editorView every time,
// here is some code to do that:
// export const activeComment = derived(editorView, ($editorView) => {
//   if (!$editorView) return undefined;
//   return getActiveAnnotation($editorView.state, "comment");
// });
// export const annotations = derived(editorView, ($editorView) => {
// 	if (!$editorView) return undefined;
// 	return $editorView.state.field(annotationField);
// });
