import { describe, it, expect } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { mapRange } from "$lib/editor/plugins/annotations/utils";
import { makeVersion, type GenericAnnotation } from "$lib/editor/plugins/annotations/models";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChanges(doc: string, from: number, to: number, insert: string) {
    const state = EditorState.create({ doc });
    const tr = state.update({ changes: { from, to, insert } });
    return tr.changes;
}

function makeComment(from: number, to: number): GenericAnnotation {
    return {
        id: 0,
        _type: "comment",
        selection: EditorSelection.create([EditorSelection.range(from, to)]),
        thread: [],
    };
}

function makeRevision(from: number, to: number): GenericAnnotation {
    const v0 = makeVersion({ doc: "text" });
    return {
        id: 0,
        _type: "revision",
        selection: EditorSelection.create([EditorSelection.range(from, to)]),
        thread: [],
        activeVersionId: v0.id,
        versions: [v0],
    };
}

// ── mapRange ─────────────────────────────────────────────────────────────────

describe("mapRange", () => {
    // doc = "Hello world" (11 chars), annotation covers "world" at [6, 11]

    it("shifts annotation right when text is inserted before it", () => {
        const comment = makeComment(6, 11);
        const changes = makeChanges("Hello world", 0, 0, "X");
        const result = mapRange(comment, changes);
        expect(result).toBeDefined();
        expect(result!.selection.main.from).toBe(7);
        expect(result!.selection.main.to).toBe(12);
    });

    it("leaves annotation unchanged when text is inserted after it", () => {
        const comment = makeComment(6, 11);
        const changes = makeChanges("Hello world", 11, 11, "X");
        const result = mapRange(comment, changes);
        expect(result).toBeDefined();
        expect(result!.selection.main.from).toBe(6);
        expect(result!.selection.main.to).toBe(11);
    });

    it("shifts annotation left when text is deleted before it", () => {
        const comment = makeComment(6, 11);
        // Delete "H" at position 0
        const changes = makeChanges("Hello world", 0, 1, "");
        const result = mapRange(comment, changes);
        expect(result).toBeDefined();
        expect(result!.selection.main.from).toBe(5);
        expect(result!.selection.main.to).toBe(10);
    });

    it("returns undefined when deleting a comment's entire range", () => {
        const comment = makeComment(6, 11);
        // Delete "world" entirely
        const changes = makeChanges("Hello world", 6, 11, "");
        const result = mapRange(comment, changes);
        expect(result).toBeUndefined();
    });

    it("returns a collapsed annotation when deleting a revision's entire range", () => {
        const revision = makeRevision(6, 11);
        // Delete "world" entirely
        const changes = makeChanges("Hello world", 6, 11, "");
        const result = mapRange(revision, changes);
        expect(result).toBeDefined();
        expect(result!.selection.main.from).toBe(result!.selection.main.to);
    });

    it("expands annotation range when text is inserted within it", () => {
        const comment = makeComment(6, 11);
        // Insert "XX" at position 8 (inside "world")
        const changes = makeChanges("Hello world", 8, 8, "XX");
        const result = mapRange(comment, changes);
        expect(result).toBeDefined();
        expect(result!.selection.main.from).toBe(6);
        expect(result!.selection.main.to).toBe(13);
    });

    it("shrinks annotation when partial deletion overlaps its start", () => {
        const comment = makeComment(6, 11);
        // Delete from position 4 to 8, overlapping the start of "world"
        const changes = makeChanges("Hello world", 4, 8, "");
        const result = mapRange(comment, changes);
        expect(result).toBeDefined();
        expect(result!.selection.main.from).toBe(4);
        expect(result!.selection.main.to).toBe(7);
    });
});
