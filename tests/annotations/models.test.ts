import { describe, it, expect } from "vitest";
import { EditorSelection } from "@codemirror/state";
import {
    getNewId,
    getLastId,
    createNewAnnotation,
    isAnnotationOfType,
    clone,
    versionText,
    type Annotations,
    type GenericAnnotation,
} from "$lib/editor/plugins/annotations/models";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sel(from: number, to: number) {
    return EditorSelection.create([EditorSelection.range(from, to)]);
}

function emptyAnnotations(): Annotations {
    return {};
}

function withAnnotations(...types: Array<"comment" | "suggestion" | "revision">): Annotations {
    const annotations: Annotations = {};
    types.forEach((type, i) => {
        const base = { id: i, selection: sel(0, 10), thread: [] };
        if (type === "comment") {
            annotations[i] = { ...base, _type: "comment" };
        } else if (type === "suggestion") {
            annotations[i] = { ...base, _type: "suggestion", replacements: [] };
        } else {
            annotations[i] = { ...base, _type: "revision", activeVersionIndex: 0, versions: [] };
        }
    });
    return annotations;
}

// ── getNewId ──────────────────────────────────────────────────────────────────

describe("getNewId", () => {
    it("returns 0 for an empty map", () => {
        expect(getNewId(emptyAnnotations())).toBe(0);
    });

    it("returns max + 1 with a single entry", () => {
        expect(getNewId(withAnnotations("comment"))).toBe(1);
    });

    it("returns max + 1 with multiple entries", () => {
        expect(getNewId(withAnnotations("comment", "revision", "suggestion"))).toBe(3);
    });

    it("handles non-contiguous IDs", () => {
        const annotations: Annotations = {
            5: { id: 5, _type: "comment", selection: sel(0, 1), thread: [] },
            12: { id: 12, _type: "comment", selection: sel(2, 3), thread: [] },
        };
        expect(getNewId(annotations)).toBe(13);
    });
});

// ── getLastId ─────────────────────────────────────────────────────────────────

describe("getLastId", () => {
    it("returns -1 for an empty map", () => {
        expect(getLastId(emptyAnnotations())).toBe(-1);
    });

    it("returns the single key for a one-entry map", () => {
        expect(getLastId(withAnnotations("comment"))).toBe(0);
    });

    it("returns the highest key", () => {
        expect(getLastId(withAnnotations("comment", "revision"))).toBe(1);
    });
});

// ── isAnnotationOfType ────────────────────────────────────────────────────────

describe("isAnnotationOfType", () => {
    const comment: GenericAnnotation = {
        id: 0,
        _type: "comment",
        selection: sel(0, 5),
        thread: [],
    };
    const revision: GenericAnnotation = {
        id: 1,
        _type: "revision",
        selection: sel(0, 5),
        thread: [],
        activeVersionIndex: 0,
        versions: [],
    };
    const suggestion: GenericAnnotation = {
        id: 2,
        _type: "suggestion",
        selection: sel(0, 5),
        thread: [],
        replacements: [],
    };

    it("returns true for matching type", () => {
        expect(isAnnotationOfType(comment, "comment")).toBe(true);
        expect(isAnnotationOfType(revision, "revision")).toBe(true);
        expect(isAnnotationOfType(suggestion, "suggestion")).toBe(true);
    });

    it("returns false for non-matching type", () => {
        expect(isAnnotationOfType(comment, "revision")).toBe(false);
        expect(isAnnotationOfType(revision, "suggestion")).toBe(false);
        expect(isAnnotationOfType(suggestion, "comment")).toBe(false);
    });

    it("acts as a type guard (TypeScript narrowing)", () => {
        const generic: GenericAnnotation = comment;
        if (isAnnotationOfType(generic, "comment")) {
            // thread is only accessible on CommentAnnotation
            expect(generic.thread).toBeDefined();
        }
    });
});

// ── createNewAnnotation ───────────────────────────────────────────────────────

describe("createNewAnnotation", () => {
    it("assigns id 0 to the first annotation", () => {
        const a = createNewAnnotation(emptyAnnotations(), sel(0, 5), "comment");
        expect(a.id).toBe(0);
    });

    it("assigns sequential IDs", () => {
        const existing = withAnnotations("comment", "comment");
        const a = createNewAnnotation(existing, sel(5, 10), "revision");
        expect(a.id).toBe(2);
    });

    it("sets the correct _type", () => {
        const a = createNewAnnotation(emptyAnnotations(), sel(0, 5), "suggestion");
        expect(a._type).toBe("suggestion");
    });

    it("stores the provided selection", () => {
        const selection = sel(3, 9);
        const a = createNewAnnotation(emptyAnnotations(), selection, "comment");
        expect(a.selection.eq(selection)).toBe(true);
    });

    it("initialises thread as empty", () => {
        const a = createNewAnnotation(emptyAnnotations(), sel(0, 1), "comment");
        expect(a.thread).toEqual([]);
    });
});

// ── clone ─────────────────────────────────────────────────────────────────────

describe("clone", () => {
    it("produces a deep copy — thread mutations don't affect the original", () => {
        const original: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: sel(0, 10),
            thread: [{ message: "hello", author: "alice", time: 1 }],
        };
        const copy = clone(original);
        (copy.thread as typeof original.thread).push({ message: "world", author: "bob", time: 2 });
        expect(original.thread).toHaveLength(1);
    });

    it("reconstructs EditorSelection correctly", () => {
        const original: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: sel(5, 15),
            thread: [],
        };
        const copy = clone(original);
        expect(copy.selection.eq(original.selection)).toBe(true);
    });
});

// ── versionText ───────────────────────────────────────────────────────────────

describe("versionText", () => {
    it("extracts the doc field from a VersionState", () => {
        const version = { doc: "hello world", someOtherField: 42 };
        expect(versionText(version)).toBe("hello world");
    });
});
