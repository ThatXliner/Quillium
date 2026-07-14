import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { type GenericAnnotation, makeVersion } from "$lib/editor/plugins/annotations/models";
import { getActiveAnnotation } from "$lib/editor/plugins/annotations/utils";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(doc: string, cursorPos: number, annotations: GenericAnnotation[] = []) {
    const base = EditorState.create({ doc, extensions: [annotationField] });
    const tr = base.update({
        effects: annotations.map((a) => addAnnotation.of(a)),
        selection: EditorSelection.cursor(cursorPos),
    });
    return tr.state;
}

function makeStateWithSelection(
    doc: string,
    anchor: number,
    head: number,
    annotations: GenericAnnotation[] = [],
) {
    const base = EditorState.create({ doc, extensions: [annotationField] });
    const tr = base.update({
        effects: annotations.map((a) => addAnnotation.of(a)),
        selection: EditorSelection.single(anchor, head),
    });
    return tr.state;
}

function makeComment(
    id: number,
    from: number,
    to: number,
    threadLength = 1,
    status: GenericAnnotation["status"] = "active",
): GenericAnnotation {
    return {
        id,
        _type: "comment",
        status,
        selection: EditorSelection.single(from, to),
        thread: Array(threadLength).fill({
            message: "x",
            author: "a",
            time: 0,
        }),
    };
}

function makeRevision(id: number, from: number, to: number): GenericAnnotation {
    const v0 = makeVersion({ doc: "v1" });
    return {
        id,
        _type: "revision",
        status: "active" as const,
        selection: EditorSelection.single(from, to),
        thread: [],
        activeVersionId: v0.id,
        versions: [v0],
    } as GenericAnnotation;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getActiveAnnotation", () => {
    it("returns undefined when there are no annotations", () => {
        const state = makeState("hello world", 5);
        expect(getActiveAnnotation(state)).toBeUndefined();
    });

    it("returns the annotation when cursor is strictly inside its range", () => {
        const comment = makeComment(0, 5, 15);
        const state = makeState("hello world, this is text", 10, [comment]);
        const result = getActiveAnnotation(state);
        expect(result).toBeDefined();
        expect(result!.id).toBe(0);
    });

    it("returns undefined when cursor is before the annotation", () => {
        const comment = makeComment(0, 10, 20);
        const state = makeState("hello world, this is text", 5, [comment]);
        expect(getActiveAnnotation(state)).toBeUndefined();
    });

    it("returns undefined when cursor is after the annotation", () => {
        const comment = makeComment(0, 5, 10);
        const state = makeState("hello world, this is text", 15, [comment]);
        expect(getActiveAnnotation(state)).toBeUndefined();
    });

    it("returns annotation when cursor is at the start boundary (from)", () => {
        const comment = makeComment(0, 5, 15);
        const state = makeState("hello world, this is text", 5, [comment]);
        const result = getActiveAnnotation(state);
        expect(result).toBeDefined();
        expect(result!.id).toBe(0);
    });

    it("returns annotation when cursor is at the end boundary (to)", () => {
        const comment = makeComment(0, 5, 15);
        const state = makeState("hello world, this is text", 15, [comment]);
        const result = getActiveAnnotation(state);
        expect(result).toBeDefined();
        expect(result!.id).toBe(0);
    });

    it("when filtered by type 'comment', returns undefined for a revision annotation at same range", () => {
        const revision = makeRevision(0, 5, 15);
        const state = makeState("hello world, this is text", 10, [revision]);
        expect(getActiveAnnotation(state, "comment")).toBeUndefined();
    });

    it("when filtered by type 'revision', returns the revision annotation", () => {
        const revision = makeRevision(0, 5, 15);
        const state = makeState("hello world, this is text", 10, [revision]);
        const result = getActiveAnnotation(state, "revision");
        expect(result).toBeDefined();
        expect(result!.id).toBe(0);
    });

    it("with two overlapping annotations, returns the narrower one when cursor is inside both", () => {
        const wide = makeComment(0, 0, 20);
        const narrow = makeComment(1, 5, 10);
        const state = makeState("hello world, this is text", 7, [wide, narrow]);
        const result = getActiveAnnotation(state);
        expect(result).toBeDefined();
        expect(result!.id).toBe(1);
    });

    it("a pending comment is returned immediately regardless of cursor position", () => {
        const pending = makeComment(0, 50, 60, 1, "pending");
        // Cursor at position 0, annotation at 50-60 — doc must be long enough
        const doc = "a".repeat(65);
        const state = makeState(doc, 0, [pending]);
        const result = getActiveAnnotation(state);
        expect(result).toBeDefined();
        expect(result!.id).toBe(0);
    });

    it("an active empty-thread comment still requires the cursor to intersect it", () => {
        const active = makeComment(0, 50, 60, 0, "active");
        const state = makeState("a".repeat(65), 0, [active]);
        expect(getActiveAnnotation(state)).toBeUndefined();
    });

    it("when cursor is a non-empty selection, only returns annotation if both anchor and head are within range", () => {
        const comment = makeComment(0, 10, 20);
        const doc = "hello world, this is some longer text";

        // Both anchor and head inside annotation range -> should return it
        const stateInside = makeStateWithSelection(doc, 12, 18, [comment]);
        const resultInside = getActiveAnnotation(stateInside);
        expect(resultInside).toBeDefined();
        expect(resultInside!.id).toBe(0);

        // Anchor inside but head outside annotation range -> should return undefined
        const statePartial = makeStateWithSelection(doc, 15, 25, [comment]);
        const resultPartial = getActiveAnnotation(statePartial);
        expect(resultPartial).toBeUndefined();

        // Both anchor and head outside annotation range -> should return undefined
        const stateOutside = makeStateWithSelection(doc, 2, 8, [comment]);
        const resultOutside = getActiveAnnotation(stateOutside);
        expect(resultOutside).toBeUndefined();
    });
});
