import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import { annotationField, addAnnotation } from "$lib/editor/plugins/annotations/annotationField";
import { NestedEditorController } from "$lib/editor/plugins/annotations/NestedEditorController";
import {
    annotations as annotationExtensions,
    createNewAnnotation,
    makeVersion,
} from "$lib/editor/plugins/annotations";

function createRevisionView() {
    const state = EditorState.create({
        doc: "hello world",
        extensions: [annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });
    const version = makeVersion({ doc: "hello" });
    const revision = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 5),
            "revision",
        ),
        activeVersionId: version.id,
        versions: [version],
    };
    view.dispatch({ effects: [addAnnotation.of(revision)] });
    return { view, parent, revisionId: revision.id, version };
}

let cleanup: (() => void)[] = [];

afterEach(() => {
    annotationEventBus.clearPendingSelections();
    for (const fn of cleanup) fn();
    cleanup = [];
    vi.restoreAllMocks();
});

describe("NestedEditorController pending selection focus", () => {
    it("does not steal focus for an empty pending selection", () => {
        const { view, parent, revisionId, version } = createRevisionView();
        const host = document.createElement("div");
        document.body.appendChild(host);
        const controller = new NestedEditorController(view, revisionId, {}, "flush");
        cleanup.push(
            () => controller.destroy(),
            () => view.destroy(),
            () => parent.remove(),
            () => host.remove(),
        );
        controller.create(host, version, 0);
        const focusSpy = vi.spyOn(controller.editor!, "focus");

        annotationEventBus.emit({
            type: "pending-nested-editor-selection",
            annotationId: revisionId,
            from: 0,
            to: 0,
        });
        controller.applyPendingSelection();

        expect(focusSpy).not.toHaveBeenCalled();
        expect(controller.editor!.state.selection.main.empty).toBe(true);
    });

    it("still focuses the nested editor for a non-empty pending selection", () => {
        const { view, parent, revisionId, version } = createRevisionView();
        const host = document.createElement("div");
        document.body.appendChild(host);
        const controller = new NestedEditorController(view, revisionId, {}, "flush");
        cleanup.push(
            () => controller.destroy(),
            () => view.destroy(),
            () => parent.remove(),
            () => host.remove(),
        );
        controller.create(host, version, 0);
        const focusSpy = vi.spyOn(controller.editor!, "focus");

        annotationEventBus.emit({
            type: "pending-nested-editor-selection",
            annotationId: revisionId,
            from: 0,
            to: 5,
        });
        controller.applyPendingSelection();

        expect(focusSpy).toHaveBeenCalledOnce();
        expect(controller.editor!.state.selection.main.from).toBe(0);
        expect(controller.editor!.state.selection.main.to).toBe(5);
    });
});
