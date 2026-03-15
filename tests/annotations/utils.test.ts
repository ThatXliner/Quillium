import { describe, it, expect } from "vitest";
import { EditorSelection, EditorState, ChangeSet } from "@codemirror/state";
import {
    cleanRangesOf,
    positionIntersects,
    canCreateNewComment,
    equalAnnotationsSignature,
} from "$lib/editor/plugins/annotations/utils";
import type { Annotations, GenericAnnotation } from "$lib/editor/plugins/annotations/models";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sel(...pairs: Array<[number, number]>) {
    return EditorSelection.create(pairs.map(([from, to]) => EditorSelection.range(from, to)));
}

function selCursor(pos: number) {
    return EditorSelection.create([EditorSelection.cursor(pos)]);
}

function makeComment(id: number, from: number, to: number, threadLength = 0): GenericAnnotation {
    return {
        id,
        _type: "comment",
        selection: sel([from, to]),
        thread: Array(threadLength).fill({ message: "x", author: "a", time: 0 }),
    };
}

function makeRevision(id: number, from: number, to: number): GenericAnnotation {
    return {
        id,
        _type: "revision",
        selection: sel([from, to]),
        thread: [],
        activeVersionIndex: 0,
        versions: [],
    };
}

// ── cleanRangesOf ─────────────────────────────────────────────────────────────

describe("cleanRangesOf", () => {
    it("returns the selection unchanged when allowEmpty=true, even for a cursor", () => {
        const cursor = selCursor(5);
        expect(cleanRangesOf(cursor, true)).toBe(cursor);
    });

    it("filters out zero-width (cursor) ranges by default", () => {
        const mixed = EditorSelection.create([
            EditorSelection.cursor(3),
            EditorSelection.range(5, 10),
        ]);
        const result = cleanRangesOf(mixed);
        expect(result).not.toBeNull();
        expect(result!.ranges).toHaveLength(1);
        expect(result!.ranges[0].from).toBe(5);
        expect(result!.ranges[0].to).toBe(10);
    });

    it("returns null when all ranges are zero-width", () => {
        const cursors = selCursor(4);
        expect(cleanRangesOf(cursors)).toBeNull();
    });

    it("preserves non-empty ranges", () => {
        const s = sel([2, 8]);
        expect(cleanRangesOf(s)).not.toBeNull();
        expect(cleanRangesOf(s)!.ranges[0].from).toBe(2);
        expect(cleanRangesOf(s)!.ranges[0].to).toBe(8);
    });
});

// ── positionIntersects ────────────────────────────────────────────────────────

describe("positionIntersects", () => {
    const range = EditorSelection.range(5, 15);

    it("returns true for a position strictly inside the range", () => {
        expect(positionIntersects(10, range)).toBe(true);
    });

    it("returns true for the start boundary", () => {
        expect(positionIntersects(5, range)).toBe(true);
    });

    it("returns true for the end boundary", () => {
        expect(positionIntersects(15, range)).toBe(true);
    });

    it("returns false for a position before the range", () => {
        expect(positionIntersects(4, range)).toBe(false);
    });

    it("returns false for a position after the range", () => {
        expect(positionIntersects(16, range)).toBe(false);
    });
});

// ── equalAnnotationsSignature ─────────────────────────────────────────────────

describe("equalAnnotationsSignature", () => {
    it("returns true for annotations with same type and selection", () => {
        const a = makeComment(0, 0, 10);
        const b = makeComment(1, 0, 10); // different id, same selection+type
        expect(equalAnnotationsSignature(a, b)).toBe(true);
    });

    it("returns false when types differ", () => {
        const a = makeComment(0, 0, 10);
        const b = makeRevision(1, 0, 10);
        expect(equalAnnotationsSignature(a, b)).toBe(false);
    });

    it("returns false when selections differ", () => {
        const a = makeComment(0, 0, 10);
        const b = makeComment(1, 5, 15);
        expect(equalAnnotationsSignature(a, b)).toBe(false);
    });
});

// ── canCreateNewComment ───────────────────────────────────────────────────────

describe("canCreateNewComment", () => {
    it("returns true for an empty annotation map", () => {
        expect(canCreateNewComment({})).toBe(true);
    });

    it("returns true when no comments have an empty thread", () => {
        const annotations: Annotations = {
            0: makeComment(0, 0, 10, 1), // thread has 1 message — not pending
        };
        expect(canCreateNewComment(annotations)).toBe(true);
    });

    it("returns false when a pending comment (empty thread) already exists", () => {
        const annotations: Annotations = {
            0: makeComment(0, 0, 10, 0), // pending — empty thread
        };
        expect(canCreateNewComment(annotations)).toBe(false);
    });

    it("returns false even when other annotations exist alongside the pending comment", () => {
        const annotations: Annotations = {
            0: makeComment(0, 0, 10, 0), // pending
            1: makeRevision(1, 20, 30),
        };
        expect(canCreateNewComment(annotations)).toBe(false);
    });

    it("returns true with only revisions (no comments at all)", () => {
        const annotations: Annotations = {
            0: makeRevision(0, 0, 10),
        };
        expect(canCreateNewComment(annotations)).toBe(true);
    });
});
