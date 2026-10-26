import { transactionsHaveAnnotationMutationEffect } from "$lib/editor/plugins/annotations/NestedEditorController";
// annotationMutation.test.ts — Mutation classification includes private history effects.
import {
    _mergeRevisionVersionState,
    _nestedEditRevision,
    addAnnotation,
    annotationField,
    classifyAnnotationMutation,
    invertedAnnotationFieldEffects,
    previewSuggestion,
    removeAnnotation,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, makeVersion } from "$lib/editor/plugins/annotations/models";
import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";

function createState(): EditorState {
    return EditorState.create({
        doc: "hello",
        extensions: [annotationField, history(), invertedAnnotationFieldEffects],
    });
}

describe("annotation mutation classification", () => {
    it("recognizes private undo restoration and removal effects", () => {
        let state = createState();
        const dispatch = (transaction: Transaction): void => {
            expect(classifyAnnotationMutation(transaction)).toBe("annotation");
            expect(transactionsHaveAnnotationMutationEffect([transaction])).toBe(true);
            state = transaction.state;
        };
        const comment = createNewAnnotation({}, EditorSelection.single(0, 5), "comment");
        dispatch(state.update({ effects: addAnnotation.of(comment) }));
        expect(undo({ state, dispatch })).toBe(true);
        expect(Object.keys(state.field(annotationField))).toHaveLength(0);
        expect(redo({ state, dispatch })).toBe(true);
        expect(Object.keys(state.field(annotationField))).toHaveLength(1);
        dispatch(state.update({ effects: removeAnnotation.of(comment) }));
        expect(undo({ state, dispatch })).toBe(true);
        expect(Object.keys(state.field(annotationField))).toHaveLength(1);
    });

    it("gives revision replacements priority over ordinary mutations in either order", () => {
        const state = createState();
        const version = makeVersion({ doc: "hello" });
        const ordinary = updateThread.of({ annotationId: 0, newThread: [] });
        for (const replacement of [
            _nestedEditRevision.of(0),
            _mergeRevisionVersionState.of({
                annotationId: 0,
                versionId: version.id,
                from: version,
                to: { ...version, doc: "hi" },
            }),
        ]) {
            for (const effects of [
                [ordinary, replacement],
                [replacement, ordinary],
            ]) {
                const transaction = state.update({ effects });
                expect(classifyAnnotationMutation(transaction)).toBe("revision-replacement");
                expect(transactionsHaveAnnotationMutationEffect([transaction])).toBe(true);
            }
        }
    });

    it("excludes preview, selection, and plain document changes", () => {
        const state = createState();
        for (const transaction of [
            state.update({ changes: { from: 0, insert: "X" } }),
            state.update({ selection: { anchor: 1 } }),
            state.update({ effects: previewSuggestion.of(null) }),
        ]) {
            expect(classifyAnnotationMutation(transaction)).toBe("none");
            expect(transactionsHaveAnnotationMutationEffect([transaction])).toBe(false);
        }
    });
});
