/** mcpContext.ts — Resolve visible modal context independently of keyboard focus. */
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { isAnnotationOfType, versionText } from "$lib/editor/plugins/annotations/models";
import type { ModalEntry } from "$lib/stores";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getActiveEditorialView, getEditorialBranchPath } from "./editorialTarget";

// A modal and an inline card can show the same branch at once. Never choose
// one by branch ID alone, or by the last editor that happened to get focus.
const modalViews = new WeakMap<EditorView, Map<number, EditorView>>();
export function registerMcpModalView(
    parent: EditorView,
    revisionId: number,
    view: EditorView,
): () => void {
    let children = modalViews.get(parent);
    if (!children) {
        children = new Map();
        modalViews.set(parent, children);
    }
    children.set(revisionId, view);
    return () => {
        if (children.get(revisionId) === view) children.delete(revisionId);
    };
}

export function resolveMcpSurface(root: EditorView, modals: readonly ModalEntry[]) {
    const top = modals.at(-1);
    const view = !top
        ? getActiveEditorialView(root)
        : top.type === "revision"
          ? modalViews.get(top.parentView)?.get(top.revisionId)
          : top.parentView;
    const modalContext = modals.map((entry, depth) => {
        const id =
            entry.type === "revision"
                ? entry.revisionId
                : entry.type === "comment"
                  ? entry.commentId
                  : entry.suggestionId;
        const annotation = entry.parentView.state.field(annotationField)[id];
        return {
            depth,
            type: entry.type,
            label: entry.label,
            annotationId: id,
            parentBranchPath: getEditorialBranchPath(entry.parentView),
            annotation:
                entry.parentView.state.toJSON({ annotations: annotationField }).annotations[id] ??
                null,
            anchoredText: annotation
                ? entry.parentView.state.sliceDoc(
                      annotation.selection.main.from,
                      annotation.selection.main.to,
                  )
                : null,
        };
    });
    const signature = JSON.stringify(
        modals.map((entry) => ({
            type: entry.type,
            id:
                entry.type === "revision"
                    ? entry.revisionId
                    : entry.type === "comment"
                      ? entry.commentId
                      : entry.suggestionId,
            path: getEditorialBranchPath(entry.parentView),
        })),
    );
    const target =
        top && top.type !== "revision"
            ? top.parentView.state.field(annotationField)[
                  top.type === "comment" ? top.commentId : top.suggestionId
              ]?.selection.main
            : undefined;
    return {
        view,
        signature,
        target,
        context: {
            kind: top ? `${top.type}-modal` : view === root ? "root-editor" : "inline-revision",
            openModals: modalContext,
            activeModalDepth: top ? modals.length - 1 : null,
        },
    };
}

/** Include each ancestor's alternatives, thread and surrounding prose, not opaque IDs alone. */
export function describeMcpRevisionPath(root: EditorView, view: EditorView) {
    let state = root.state;
    return getEditorialBranchPath(view).map((segment) => {
        const revision = state.field(annotationField)[segment.revisionId];
        if (!revision || !isAnnotationOfType(revision, "revision"))
            throw new Error("Revision context changed. Retry.");
        const version = revision.versions.find((candidate) => candidate.id === segment.versionId);
        if (!version || revision.activeVersionId !== version.id)
            throw new Error("Revision version changed. Retry.");
        const range = revision.selection.main;
        const result = {
            ...segment,
            range: { from: range.from, to: range.to },
            thread: revision.thread,
            surroundingText: state.sliceDoc(
                Math.max(0, range.from - 500),
                Math.min(state.doc.length, range.to + 500),
            ),
            versions: revision.versions.map((candidate) => ({
                id: candidate.id,
                label: candidate.label ?? "",
                active: candidate.id === revision.activeVersionId,
                text:
                    candidate.id === revision.activeVersionId
                        ? state.sliceDoc(range.from, range.to)
                        : versionText(candidate),
            })),
        };
        state = EditorState.fromJSON(
            {
                doc: versionText(version),
                selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
                annotationField: (version as { annotationField?: unknown }).annotationField ?? {},
            },
            { extensions: [annotationField] },
            { annotationField },
        );
        return result;
    });
}
