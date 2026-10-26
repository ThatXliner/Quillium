/**
 * readonlyEditorController.ts — Shared headless orchestration for read-only editors.
 *
 * Web Preview and desktop history both mount their own EditorView presentation,
 * but selection, projection, active annotation lookup, and linked revision
 * switching must behave identically.
 */
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { annotationField, setActiveRevisionVersion } from "./annotationField";
import { isAnnotationOfType } from "./models";
import { type SerializedState, serializeFromState } from "./serialize";
import { getActiveAnnotation } from "./utils";

export type ReadonlySelectionOptions = {
    focus?: boolean;
    scrollIntoView?: boolean;
};

export class ReadonlyEditorController {
    private currentView: EditorView | null = null;

    get view(): EditorView | null {
        return this.currentView;
    }

    attach(view: EditorView | null): void {
        this.currentView = view;
    }

    snapshot(): SerializedState {
        return this.currentView
            ? serializeFromState(this.currentView.state)
            : { content: "", annotations: [] };
    }

    activeAnnotationId(): string | null {
        if (!this.currentView) return null;
        const active = getActiveAnnotation(this.currentView.state);
        return active ? String(active.id) : null;
    }

    selectAnnotation(
        annotationId: string,
        { focus = false, scrollIntoView = true }: ReadonlySelectionOptions = {},
    ): boolean {
        if (!this.currentView) return false;
        const annotation = this.snapshot().annotations.find((item) => item.id === annotationId);
        if (!annotation) return false;
        this.currentView.dispatch({
            selection: EditorSelection.cursor(annotation.from),
            scrollIntoView,
        });
        if (focus) this.currentView.focus();
        return true;
    }

    switchRevisionVersion(
        annotationId: string,
        versionIndex: number,
        { moveCursor = true }: { moveCursor?: boolean } = {},
    ): boolean {
        if (!this.currentView || annotationId.includes(".v")) return false;
        const revisionId = Number(annotationId);
        if (!Number.isInteger(revisionId)) return false;
        const annotation = this.currentView.state.field(annotationField, false)?.[revisionId];
        if (!annotation || !isAnnotationOfType(annotation, "revision")) return false;
        const version = annotation.versions[versionIndex];
        if (!version) return false;
        this.currentView.dispatch(
            setActiveRevisionVersion(this.currentView.state, revisionId, version.id, {
                moveCursor,
            }),
        );
        return true;
    }
}
