/**
 * commentFocus.ts — Captures and restores the editor position around comment composers.
 *
 * Comment inputs live outside CodeMirror, so browser focus changes alone do not guarantee
 * that the originating selection remains valid or visible. These helpers keep restoration
 * consistent for main, nested, inline, and modal editors.
 */
import type { EditorView } from "@codemirror/view";

export type CommentEditorPosition = {
    anchor: number;
    head: number;
};

export function captureCommentEditorPosition(view: EditorView): CommentEditorPosition {
    const { anchor, head } = view.state.selection.main;
    return { anchor, head };
}

export function restoreCommentEditorPosition(
    view: EditorView,
    position: CommentEditorPosition,
): void {
    const docLength = view.state.doc.length;

    view.dispatch({
        selection: {
            anchor: Math.min(position.anchor, docLength),
            head: Math.min(position.head, docLength),
        },
        scrollIntoView: true,
    });
    view.focus();
}
