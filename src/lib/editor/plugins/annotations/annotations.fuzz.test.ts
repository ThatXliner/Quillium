/**
 * Property-based fuzz tests for the annotation subsystem.
 * Uses fast-check to generate arbitrary inputs and verify invariants.
 *
 * Targets:
 *   - models.ts: getNewId, getLastId, createNewAnnotation, clone
 *   - utils.ts: cleanRangesOf, positionIntersects, mapRange, canCreateNewComment
 *   - Serialization: RawAnnotationsSchema round-trip
 */
import { EditorSelection } from "@codemirror/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    RawAnnotationSchema,
    RawAnnotationsSchema,
    clone,
    createNewAnnotation,
    getLastId,
    getNewId,
    isAnnotationOfType,
    type Annotations,
    type GenericAnnotation,
} from "./models";
import { canCreateNewComment, cleanRangesOf, positionIntersects } from "./utils";

// ── Arbitraries ─────────────────────────────────────────────────────────────

const arbNonNegInt = fc.integer({ min: 0, max: 10_000 });

/** A valid EditorSelection with at least one non-collapsed range */
const arbSelection = fc
    .tuple(
        fc.array(
            fc.tuple(arbNonNegInt, arbNonNegInt).map(([a, b]) => {
                const lo = Math.min(a, b);
                const hi = Math.max(a, b) + 1; // ensure non-collapsed
                return EditorSelection.range(lo, hi);
            }),
            { minLength: 1, maxLength: 4 },
        ),
        fc.integer({ min: 0, max: 3 }),
    )
    .map(([ranges, mainIdx]) =>
        EditorSelection.create(ranges, Math.min(mainIdx, ranges.length - 1)),
    );

/** A selection that may contain collapsed (zero-width) ranges */
const arbMaybeCollapsedSelection = fc
    .array(
        fc.tuple(arbNonNegInt, arbNonNegInt).map(([a, b]) =>
            EditorSelection.range(Math.min(a, b), Math.max(a, b)),
        ),
        { minLength: 1, maxLength: 4 },
    )
    .map((ranges) => EditorSelection.create(ranges, 0));

const arbAnnotationType = fc.constantFrom(
    "comment" as const,
    "suggestion" as const,
    "revision" as const,
);

/** Build a minimal valid GenericAnnotation (no type-specific extras needed for model tests) */
function makeAnnotation(
    id: number,
    selection: EditorSelection,
    type: GenericAnnotation["_type"],
): GenericAnnotation {
    const base = { id, selection, thread: [] };
    if (type === "comment") return { ...base, _type: "comment" };
    if (type === "suggestion") return { ...base, _type: "suggestion", replacements: [] };
    return {
        ...base,
        _type: "revision",
        activeVersionIndex: 0,
        versions: [{ doc: "v0" }],
    };
}

/** Arbitrary Annotations map (numeric keys → GenericAnnotation) */
const arbAnnotations = fc
    .uniqueArray(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 10 })
    .chain((ids) =>
        fc
            .tuple(
                fc.array(arbSelection, { minLength: ids.length, maxLength: ids.length }),
                fc.array(arbAnnotationType, { minLength: ids.length, maxLength: ids.length }),
            )
            .map(([selections, types]) => {
                const ann: Annotations = {};
                ids.forEach((id, i) => {
                    ann[id] = makeAnnotation(id, selections[i], types[i]);
                });
                return ann;
            }),
    );

// ── getNewId / getLastId ─────────────────────────────────────────────────────

describe("getNewId", () => {
    it("returns 0 for empty map", () => {
        expect(getNewId({})).toBe(0);
    });

    it("always returns a value strictly greater than all existing keys", () => {
        fc.assert(
            fc.property(arbAnnotations, (annotations) => {
                const newId = getNewId(annotations);
                const keys = Object.keys(annotations).map(Number);
                if (keys.length === 0) {
                    expect(newId).toBe(0);
                } else {
                    expect(newId).toBeGreaterThan(Math.max(...keys));
                }
            }),
        );
    });

    it("never collides with existing keys", () => {
        fc.assert(
            fc.property(arbAnnotations, (annotations) => {
                const newId = getNewId(annotations);
                expect(annotations[newId]).toBeUndefined();
            }),
        );
    });

    it("consecutive calls on expanded map produce unique IDs", () => {
        fc.assert(
            fc.property(arbAnnotations, arbAnnotationType, arbSelection, (annotations, type, sel) => {
                const id1 = getNewId(annotations);
                const expanded = { ...annotations };
                expanded[id1] = makeAnnotation(id1, sel, type);
                const id2 = getNewId(expanded);
                expect(id1).not.toBe(id2);
            }),
        );
    });
});

describe("getLastId", () => {
    it("returns -1 for empty map", () => {
        expect(getLastId({})).toBe(-1);
    });

    it("returns max key", () => {
        fc.assert(
            fc.property(arbAnnotations, (annotations) => {
                const keys = Object.keys(annotations).map(Number);
                const lastId = getLastId(annotations);
                if (keys.length === 0) {
                    expect(lastId).toBe(-1);
                } else {
                    expect(lastId).toBe(Math.max(...keys));
                }
            }),
        );
    });
});

// ── createNewAnnotation ──────────────────────────────────────────────────────

describe("createNewAnnotation", () => {
    it("assigns a unique id not present in the map", () => {
        fc.assert(
            fc.property(arbAnnotations, arbSelection, arbAnnotationType, (annotations, sel, type) => {
                const annotation = createNewAnnotation(annotations, sel, type);
                expect(annotations[annotation.id]).toBeUndefined();
            }),
        );
    });

    it("carries the provided selection and type", () => {
        fc.assert(
            fc.property(arbAnnotations, arbSelection, arbAnnotationType, (annotations, sel, type) => {
                const annotation = createNewAnnotation(annotations, sel, type);
                expect(annotation._type).toBe(type);
                expect(annotation.selection.eq(sel)).toBe(true);
            }),
        );
    });

    it("starts with an empty thread", () => {
        fc.assert(
            fc.property(arbAnnotations, arbSelection, arbAnnotationType, (annotations, sel, type) => {
                const annotation = createNewAnnotation(annotations, sel, type);
                expect(annotation.thread).toHaveLength(0);
            }),
        );
    });
});

// ── clone ────────────────────────────────────────────────────────────────────

describe("clone", () => {
    it("produces a deep copy — mutating clone does not affect original", () => {
        fc.assert(
            fc.property(arbAnnotations, arbSelection, arbAnnotationType, (annotations, sel, type) => {
                const original = makeAnnotation(getNewId(annotations), sel, type);
                const copy = clone(original);
                // Mutate the clone's thread
                copy.thread.push({ message: "x", author: "a", time: 0 });
                expect(original.thread).toHaveLength(0);
            }),
        );
    });

    it("selection is equal but not the same reference", () => {
        fc.assert(
            fc.property(arbAnnotations, arbSelection, arbAnnotationType, (annotations, sel, type) => {
                const original = makeAnnotation(getNewId(annotations), sel, type);
                const copy = clone(original);
                expect(copy.selection.eq(original.selection)).toBe(true);
                expect(copy.selection).not.toBe(original.selection);
            }),
        );
    });
});

// ── isAnnotationOfType ───────────────────────────────────────────────────────

describe("isAnnotationOfType", () => {
    it("is consistent with _type field", () => {
        fc.assert(
            fc.property(arbAnnotations, arbSelection, arbAnnotationType, (annotations, sel, type) => {
                const annotation = makeAnnotation(getNewId(annotations), sel, type);
                expect(isAnnotationOfType(annotation, type)).toBe(true);
                const otherTypes = (["comment", "suggestion", "revision"] as const).filter(
                    (t) => t !== type,
                );
                for (const other of otherTypes) {
                    expect(isAnnotationOfType(annotation, other)).toBe(false);
                }
            }),
        );
    });
});

// ── cleanRangesOf ────────────────────────────────────────────────────────────

describe("cleanRangesOf", () => {
    it("allowEmpty=true always returns the selection unchanged", () => {
        fc.assert(
            fc.property(arbMaybeCollapsedSelection, (sel) => {
                expect(cleanRangesOf(sel, true)).toBe(sel);
            }),
        );
    });

    it("returns null when all ranges are collapsed", () => {
        fc.assert(
            fc.property(
                fc.array(arbNonNegInt, { minLength: 1, maxLength: 4 }).map((positions) =>
                    EditorSelection.create(
                        positions.map((p) => EditorSelection.cursor(p)),
                        0,
                    ),
                ),
                (sel) => {
                    expect(cleanRangesOf(sel)).toBeNull();
                },
            ),
        );
    });

    it("result contains only non-collapsed ranges", () => {
        fc.assert(
            fc.property(arbMaybeCollapsedSelection, (sel) => {
                const result = cleanRangesOf(sel);
                if (result !== null) {
                    for (const range of result.ranges) {
                        expect(range.from).not.toBe(range.to);
                    }
                }
            }),
        );
    });

    it("preserves at least one range when any non-collapsed range exists", () => {
        fc.assert(
            fc.property(arbSelection, (sel) => {
                // arbSelection only produces non-collapsed ranges
                const result = cleanRangesOf(sel);
                expect(result).not.toBeNull();
                expect(result!.ranges.length).toBeGreaterThan(0);
            }),
        );
    });
});

// ── positionIntersects ───────────────────────────────────────────────────────

describe("positionIntersects", () => {
    it("returns true for position at from boundary", () => {
        fc.assert(
            fc.property(arbNonNegInt, fc.integer({ min: 1, max: 100 }), (from, len) => {
                const range = EditorSelection.range(from, from + len);
                expect(positionIntersects(from, range)).toBe(true);
            }),
        );
    });

    it("returns true for position at to boundary", () => {
        fc.assert(
            fc.property(arbNonNegInt, fc.integer({ min: 1, max: 100 }), (from, len) => {
                const range = EditorSelection.range(from, from + len);
                expect(positionIntersects(from + len, range)).toBe(true);
            }),
        );
    });

    it("returns false for position strictly before from", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10_000 }),
                fc.integer({ min: 1, max: 100 }),
                (from, len) => {
                    const range = EditorSelection.range(from, from + len);
                    expect(positionIntersects(from - 1, range)).toBe(false);
                },
            ),
        );
    });

    it("returns false for position strictly after to", () => {
        fc.assert(
            fc.property(arbNonNegInt, fc.integer({ min: 1, max: 100 }), (from, len) => {
                const range = EditorSelection.range(from, from + len);
                expect(positionIntersects(from + len + 1, range)).toBe(false);
            }),
        );
    });

    it("is consistent: position inside [from, to] iff from <= pos <= to", () => {
        fc.assert(
            fc.property(
                arbNonNegInt,
                fc.integer({ min: 0, max: 200 }),
                fc.integer({ min: 0, max: 10_000 }),
                (from, len, pos) => {
                    const to = from + len;
                    const range = EditorSelection.range(from, to);
                    const expected = from <= pos && pos <= to;
                    expect(positionIntersects(pos, range)).toBe(expected);
                },
            ),
        );
    });
});

// ── canCreateNewComment ──────────────────────────────────────────────────────

describe("canCreateNewComment", () => {
    it("returns true for empty annotations", () => {
        expect(canCreateNewComment({})).toBe(true);
    });

    it("returns false when a pending comment (empty thread) exists", () => {
        fc.assert(
            fc.property(arbAnnotations, arbSelection, (annotations, sel) => {
                const pendingId = getNewId(annotations);
                const withPending: Annotations = {
                    ...annotations,
                    [pendingId]: makeAnnotation(pendingId, sel, "comment"),
                    // makeAnnotation gives empty thread by default → pending
                };
                expect(canCreateNewComment(withPending)).toBe(false);
            }),
        );
    });

    it("returns true when all comments have at least one message", () => {
        fc.assert(
            fc.property(arbAnnotations, arbSelection, (annotations, sel) => {
                const id = getNewId(annotations);
                const comment = makeAnnotation(id, sel, "comment") as GenericAnnotation & {
                    _type: "comment";
                };
                comment.thread = [{ message: "hi", author: "user", time: Date.now() }];
                const withFilled: Annotations = { ...annotations, [id]: comment };
                // Only valid if no other pending comment exists in arbitrary annotations
                const hasPending = Object.values(annotations).some(
                    (a) => isAnnotationOfType(a, "comment") && a.thread.length === 0,
                );
                if (!hasPending) {
                    expect(canCreateNewComment(withFilled)).toBe(true);
                }
            }),
        );
    });
});

// ── RawAnnotationSchema / Zod round-trip ─────────────────────────────────────

describe("RawAnnotationSchema", () => {
    const arbRawBase = fc.record({
        id: fc.integer({ min: 0 }),
        thread: fc.array(
            fc.record({
                message: fc.string(),
                author: fc.string(),
                time: fc.integer({ min: 0 }),
            }),
        ),
        selection: fc.record({
            ranges: fc.array(
                fc.tuple(fc.integer({ min: 0 }), fc.integer({ min: 0 })).map(([a, h]) => ({
                    anchor: a,
                    head: h,
                })),
                { minLength: 1 },
            ),
            main: fc.option(fc.integer({ min: 0 }), { nil: undefined }),
        }),
    });

    it("parses valid comment annotations", () => {
        fc.assert(
            fc.property(arbRawBase, (base) => {
                const result = RawAnnotationSchema.safeParse({ ...base, _type: "comment" });
                expect(result.success).toBe(true);
            }),
        );
    });

    it("parses valid suggestion annotations", () => {
        fc.assert(
            fc.property(
                arbRawBase,
                fc.array(
                    fc.record({
                        text: fc.string(),
                        rationale: fc.option(fc.string(), { nil: undefined }),
                    }),
                ),
                (base, replacements) => {
                    const result = RawAnnotationSchema.safeParse({
                        ...base,
                        _type: "suggestion",
                        replacements,
                    });
                    expect(result.success).toBe(true);
                },
            ),
        );
    });

    it("parses valid revision annotations", () => {
        fc.assert(
            fc.property(
                arbRawBase,
                fc.integer({ min: 0, max: 5 }),
                fc.array(
                    fc.record({
                        doc: fc.string(),
                        label: fc.option(fc.string(), { nil: undefined }),
                    }),
                    { minLength: 1 },
                ),
                (base, activeVersionIndex, versions) => {
                    const result = RawAnnotationSchema.safeParse({
                        ...base,
                        _type: "revision",
                        activeVersionIndex,
                        versions,
                    });
                    expect(result.success).toBe(true);
                },
            ),
        );
    });

    it("rejects unknown _type values", () => {
        fc.assert(
            fc.property(
                arbRawBase,
                fc.string().filter((s) => !["comment", "suggestion", "revision"].includes(s)),
                (base, badType) => {
                    const result = RawAnnotationSchema.safeParse({ ...base, _type: badType });
                    expect(result.success).toBe(false);
                },
            ),
        );
    });

    it("rejects revision with empty versions array", () => {
        fc.assert(
            fc.property(arbRawBase, (base) => {
                const result = RawAnnotationSchema.safeParse({
                    ...base,
                    _type: "revision",
                    activeVersionIndex: 0,
                    versions: [],
                });
                expect(result.success).toBe(false);
            }),
        );
    });

    it("rejects selection with empty ranges array", () => {
        fc.assert(
            fc.property(arbRawBase, (base) => {
                const result = RawAnnotationSchema.safeParse({
                    ...base,
                    _type: "comment",
                    selection: { ranges: [] },
                });
                expect(result.success).toBe(false);
            }),
        );
    });
});

describe("RawAnnotationsSchema", () => {
    it("accepts empty object", () => {
        expect(RawAnnotationsSchema.safeParse({}).success).toBe(true);
    });

    it("rejects non-object values", () => {
        fc.assert(
            fc.property(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)), (val) => {
                expect(RawAnnotationsSchema.safeParse(val).success).toBe(false);
            }),
        );
    });
});
