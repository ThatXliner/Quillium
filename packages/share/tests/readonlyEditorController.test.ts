import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { addAnnotation, annotationField } from "../src/core/annotationField";
import { type GenericAnnotation, makeVersion } from "../src/core/models";
import { ReadonlyEditorController } from "../src/core/readonlyEditorController";
import { createVersionGroup, versionGroupField } from "../src/core/versionGroupField";

function buildLinkedView(): { view: EditorView; focus: ReturnType<typeof vi.fn> } {
    const firstOriginal = makeVersion({ doc: "quick" });
    const firstLinked = makeVersion({ doc: "swift" });
    const secondOriginal = makeVersion({ doc: "fox" });
    const secondLinked = makeVersion({ doc: "hound" });
    const revisions: GenericAnnotation[] = [
        {
            id: 1,
            _type: "revision",
            status: "active" as const,
            thread: [],
            selection: EditorSelection.single(4, 9),
            activeVersionId: firstOriginal.id,
            versions: [firstOriginal, firstLinked],
        },
        {
            id: 2,
            _type: "revision",
            status: "active" as const,
            thread: [],
            selection: EditorSelection.single(10, 13),
            activeVersionId: secondOriginal.id,
            versions: [secondOriginal, secondLinked],
        },
    ];
    let state = EditorState.create({
        doc: "The quick fox",
        extensions: [annotationField, versionGroupField],
    });
    state = state.update({
        effects: revisions.map((revision) => addAnnotation.of(revision)),
    }).state;
    const { spec } = createVersionGroup("Linked wording", [
        { revisionId: 1, versionId: firstLinked.id },
        { revisionId: 2, versionId: secondLinked.id },
    ]);
    state = state.update(spec).state;
    const focus = vi.fn();
    const view = {
        get state() {
            return state;
        },
        dispatch(spec: TransactionSpec) {
            state = state.update(spec).state;
        },
        focus,
    } as unknown as EditorView;
    return { view, focus };
}

describe("ReadonlyEditorController", () => {
    it("shares selection, projection, and linked revision switching", () => {
        const { view, focus } = buildLinkedView();
        const controller = new ReadonlyEditorController();
        controller.attach(view);

        expect(controller.snapshot().content).toBe("The quick fox");
        expect(controller.selectAnnotation("1", { focus: true })).toBe(true);
        expect(controller.activeAnnotationId()).toBe("1");
        expect(focus).toHaveBeenCalledOnce();

        expect(controller.switchRevisionVersion("1", 1)).toBe(true);
        expect(controller.snapshot().content).toBe("The swift hound");
    });

    it("keeps nested modal ids out of the root controller", () => {
        const { view } = buildLinkedView();
        const controller = new ReadonlyEditorController();
        controller.attach(view);

        expect(controller.switchRevisionVersion("1.v0.2", 1)).toBe(false);
        expect(controller.snapshot().content).toBe("The quick fox");
    });
});
