/**
 * editorialTarget.ts - Request-scoped target tracking and validation for AI annotations.
 *
 * Selected passages are registered in a transient CodeMirror StateField. CodeMirror maps
 * those ranges through document changes while a request is running. This lets edits before
 * the passage move its target without making a valid response stale, while edits inside the
 * passage still fail the source-text check below.
 */

import {
    type EditorState,
    type Extension,
    StateEffect,
    StateField,
    Transaction,
} from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { writable } from "svelte/store";
import type { AiTextRange } from "./context";
import type { EditorialAction } from "./editorialPolicy";

type EditorialTargetBookmark = {
    id: string;
    range: AiTextRange;
};

export type EditorialBranchSegment = {
    revisionId: number;
    versionId: string;
};

type EditorialViewIdentity = {
    rootView: EditorView;
    parentView?: EditorView;
    branchPath: readonly EditorialBranchSegment[];
    isCurrent: () => boolean;
};

const editorialViewIdentities = new WeakMap<EditorView, EditorialViewIdentity>();
let lastActiveEditorialView: EditorView | undefined;

export type EditorialContextView = {
    rootView: EditorView;
    view: EditorView;
    state: EditorState;
    branchPath: readonly EditorialBranchSegment[];
    isCurrent: () => boolean;
};

/** The active editor snapshot used by context summaries while a tab is open. */
export const editorialContextView = writable<EditorialContextView | null>(null);

function rootIdentity(view: EditorView): EditorialViewIdentity {
    const existing = editorialViewIdentities.get(view);
    if (existing) return existing;
    const identity = { rootView: view, branchPath: [], isCurrent: () => true };
    editorialViewIdentities.set(view, identity);
    return identity;
}

export function registerNestedEditorialView({
    view,
    parentView,
    revisionId,
    versionId,
    isCurrent = () => true,
}: {
    view: EditorView;
    parentView: EditorView;
    revisionId: number;
    versionId: string;
    isCurrent?: () => boolean;
}) {
    const parent = rootIdentity(parentView);
    editorialViewIdentities.set(view, {
        rootView: parent.rootView,
        parentView,
        branchPath: [...parent.branchPath, { revisionId, versionId }],
        isCurrent: () => parent.isCurrent() && isCurrent(),
    });
}

export function unregisterEditorialView(view: EditorView) {
    const identity = editorialViewIdentities.get(view);
    editorialViewIdentities.delete(view);
    if (lastActiveEditorialView === view) {
        const fallback = identity?.parentView;
        lastActiveEditorialView = fallback;
        if (fallback) {
            activateEditorialView(fallback);
        } else {
            editorialContextView.set(null);
        }
    }
}

export function getActiveEditorialView(rootView: EditorView): EditorView {
    rootIdentity(rootView);
    if (
        lastActiveEditorialView &&
        editorialViewIdentities.get(lastActiveEditorialView)?.rootView === rootView &&
        editorialViewIdentities.get(lastActiveEditorialView)?.isCurrent()
    ) {
        return lastActiveEditorialView;
    }
    activateEditorialView(rootView);
    return rootView;
}

export function activateEditorialView(view: EditorView) {
    const identity = rootIdentity(view);
    lastActiveEditorialView = view;
    editorialContextView.set({
        rootView: identity.rootView,
        view,
        state: view.state,
        branchPath: identity.branchPath,
        isCurrent: identity.isCurrent,
    });
}

function updateEditorialContextView(update: ViewUpdate) {
    const identity = editorialViewIdentities.get(update.view);
    if (!identity) return;
    if (lastActiveEditorialView === update.view && identity.isCurrent()) {
        editorialContextView.set({
            rootView: identity.rootView,
            view: update.view,
            state: update.state,
            branchPath: identity.branchPath,
            isCurrent: identity.isCurrent,
        });
        return;
    }

    const active = lastActiveEditorialView;
    const activeIdentity = active ? editorialViewIdentities.get(active) : undefined;
    if (!active || !activeIdentity || activeIdentity.isCurrent()) return;
    const fallback = activeIdentity.parentView ?? activeIdentity.rootView;
    const fallbackIdentity = editorialViewIdentities.get(fallback);
    if (fallbackIdentity?.isCurrent()) activateEditorialView(fallback);
}

export const editorialTargetViewTracker: Extension = [
    EditorView.domEventHandlers({
        focus(_event, view) {
            activateEditorialView(view);
            return false;
        },
    }),
    EditorView.updateListener.of(updateEditorialContextView),
];

const addEditorialTargetBookmark = StateEffect.define<EditorialTargetBookmark>({
    map: (value, changes) => ({
        id: value.id,
        range: {
            from: changes.mapPos(value.range.from, 1),
            to: changes.mapPos(value.range.to, -1),
        },
    }),
});

const removeEditorialTargetBookmark = StateEffect.define<string>();

export const editorialTargetBookmarkField = StateField.define<ReadonlyMap<string, AiTextRange>>({
    create: () => new Map(),
    update(bookmarks, transaction) {
        const next = new Map<string, AiTextRange>();
        for (const [id, range] of bookmarks) {
            next.set(id, {
                from: transaction.changes.mapPos(range.from, 1),
                to: transaction.changes.mapPos(range.to, -1),
            });
        }

        for (const effect of transaction.effects) {
            if (effect.is(addEditorialTargetBookmark)) {
                next.set(effect.value.id, effect.value.range);
            } else if (effect.is(removeEditorialTargetBookmark)) {
                next.delete(effect.value);
            }
        }
        return next;
    },
});

export type EditorialTargetSnapshot = {
    documentId: string | null;
    tabId: string | null;
    draftId: string | null;
    selectedText: string;
    selectedTextRange?: AiTextRange;
    selectionBookmarkId?: string;
    branchPath: readonly EditorialBranchSegment[];
    ownerView?: EditorView;
};

export type EditorialTargetState = {
    documentId: string | null;
    tabId: string | null;
    draftId: string | null;
    documentText?: string;
    selectedTextRange?: AiTextRange;
    branchPath?: readonly EditorialBranchSegment[];
};

export type EditorialTargetValidation =
    | { ok: true }
    | {
          ok: false;
          reason:
              | "document-changed"
              | "tab-changed"
              | "draft-changed"
              | "branch-changed"
              | "selection-changed"
              | "outside-selection"
              | "action-forbidden";
      };

function createBookmarkId(): string {
    return (
        globalThis.crypto?.randomUUID?.() ??
        `ai-target-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
}

export function captureEditorialTarget({
    view,
    documentId,
    tabId,
    draftId,
    selectedText,
    selectedTextRange,
}: {
    view: EditorView | null;
    documentId: string | null;
    tabId: string | null;
    draftId: string | null;
    selectedText: string;
    selectedTextRange?: AiTextRange;
}): EditorialTargetSnapshot {
    const identity = view ? rootIdentity(view) : undefined;
    let selectionBookmarkId: string | undefined;
    if (
        view &&
        selectedText &&
        selectedTextRange &&
        view.state.field(editorialTargetBookmarkField, false)
    ) {
        selectionBookmarkId = createBookmarkId();
        view.dispatch({
            effects: addEditorialTargetBookmark.of({
                id: selectionBookmarkId,
                range: selectedTextRange,
            }),
            annotations: Transaction.addToHistory.of(false),
        });
    }

    return {
        documentId,
        tabId,
        draftId,
        selectedText,
        selectedTextRange,
        selectionBookmarkId,
        branchPath: identity?.branchPath ?? [],
        ownerView: view ?? undefined,
    };
}

export function resolveEditorialTargetView(
    rootView: EditorView,
    snapshot: EditorialTargetSnapshot,
): EditorView | undefined {
    const ownerView = snapshot.ownerView;
    if (!ownerView) return rootView;
    const identity = editorialViewIdentities.get(ownerView);
    if (!identity || identity.rootView !== rootView || !identity.isCurrent()) return undefined;
    return ownerView;
}

export function getEditorialBranchPath(view: EditorView): readonly EditorialBranchSegment[] {
    return rootIdentity(view).branchPath;
}

export function resolveEditorialTargetRange(
    view: EditorView,
    snapshot: EditorialTargetSnapshot,
): AiTextRange | undefined {
    if (!snapshot.selectionBookmarkId) return snapshot.selectedTextRange;
    return view.state.field(editorialTargetBookmarkField, false)?.get(snapshot.selectionBookmarkId);
}

export function releaseEditorialTarget(
    view: EditorView | null | undefined,
    snapshot: EditorialTargetSnapshot | undefined,
) {
    if (!view || !snapshot?.selectionBookmarkId) return;
    if (!view.state.field(editorialTargetBookmarkField, false)?.has(snapshot.selectionBookmarkId)) {
        return;
    }
    view.dispatch({
        effects: removeEditorialTargetBookmark.of(snapshot.selectionBookmarkId),
        annotations: Transaction.addToHistory.of(false),
    });
}

export function validateEditorialActionTarget({
    snapshot,
    current,
    targetText,
    action,
    allowedActions,
}: {
    snapshot: EditorialTargetSnapshot;
    current: EditorialTargetState;
    targetText: string;
    action: EditorialAction;
    allowedActions: readonly EditorialAction[];
}): EditorialTargetValidation {
    if (!allowedActions.includes(action)) return { ok: false, reason: "action-forbidden" };
    if (snapshot.documentId !== current.documentId)
        return { ok: false, reason: "document-changed" };
    if (snapshot.tabId !== current.tabId) return { ok: false, reason: "tab-changed" };
    if (snapshot.draftId !== current.draftId) return { ok: false, reason: "draft-changed" };
    if (
        current.branchPath &&
        (snapshot.branchPath.length !== current.branchPath.length ||
            snapshot.branchPath.some((segment, index) => {
                const currentSegment = current.branchPath?.[index];
                return (
                    segment.revisionId !== currentSegment?.revisionId ||
                    segment.versionId !== currentSegment.versionId
                );
            }))
    ) {
        return { ok: false, reason: "branch-changed" };
    }
    if (snapshot.selectedTextRange && current.documentText !== undefined) {
        if (!current.selectedTextRange) return { ok: false, reason: "selection-changed" };
        const { from, to } = current.selectedTextRange;
        if (current.documentText.slice(from, to) !== snapshot.selectedText) {
            return { ok: false, reason: "selection-changed" };
        }
    }
    if (snapshot.selectedText && !snapshot.selectedText.includes(targetText)) {
        return { ok: false, reason: "outside-selection" };
    }
    return { ok: true };
}
