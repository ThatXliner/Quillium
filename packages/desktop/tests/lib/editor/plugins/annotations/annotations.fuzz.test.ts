import {
    type Annotations,
    type GenericAnnotation,
    RawAnnotationSchema,
    RawAnnotationsSchema,
    clone,
    createNewAnnotation,
    getLastId,
    getNewId,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import {
    canCreateNewComment,
    canCreateRevision,
    cleanRangesOf,
    positionIntersects,
} from "$lib/editor/plugins/annotations/utils";
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
        fc
            .tuple(arbNonNegInt, arbNonNegInt)
            .map(([a, b]) => EditorSelection.range(Math.min(a, b), Math.max(a, b))),
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
    const v0 = makeVersion({ doc: "v0" });
    return {
        ...base,
        _type: "revision",
        activeVersionId: v0.id,
        versions: [v0],
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
            fc.property(
                arbAnnotations,
                arbAnnotationType,
                arbSelection,
                (annotations, type, sel) => {
                    const id1 = getNewId(annotations);
                    const expanded = { ...annotations };
                    expanded[id1] = makeAnnotation(id1, sel, type);
                    const id2 = getNewId(expanded);
                    expect(id1).not.toBe(id2);
                },
            ),
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
            fc.property(
                arbAnnotations,
                arbSelection,
                arbAnnotationType,
                (annotations, sel, type) => {
                    const annotation = createNewAnnotation(annotations, sel, type);
                    expect(annotations[annotation.id]).toBeUndefined();
                },
            ),
        );
    });

    it("carries the provided selection and type", () => {
        fc.assert(
            fc.property(
                arbAnnotations,
                arbSelection,
                arbAnnotationType,
                (annotations, sel, type) => {
                    const annotation = createNewAnnotation(annotations, sel, type);
                    expect(annotation._type).toBe(type);
                    expect(annotation.selection.eq(sel)).toBe(true);
                },
            ),
        );
    });

    it("starts with an empty thread", () => {
        fc.assert(
            fc.property(
                arbAnnotations,
                arbSelection,
                arbAnnotationType,
                (annotations, sel, type) => {
                    const annotation = createNewAnnotation(annotations, sel, type);
                    expect(annotation.thread).toHaveLength(0);
                },
            ),
        );
    });
});

// ── clone ────────────────────────────────────────────────────────────────────

describe("clone", () => {
    it("produces a deep copy — mutating clone does not affect original", () => {
        fc.assert(
            fc.property(
                arbAnnotations,
                arbSelection,
                arbAnnotationType,
                (annotations, sel, type) => {
                    const original = makeAnnotation(getNewId(annotations), sel, type);
                    const copy = clone(original);
                    // Mutate the clone's thread
                    copy.thread.push({ message: "x", author: "a", time: 0 });
                    expect(original.thread).toHaveLength(0);
                },
            ),
        );
    });

    it("selection is equal but not the same reference", () => {
        fc.assert(
            fc.property(
                arbAnnotations,
                arbSelection,
                arbAnnotationType,
                (annotations, sel, type) => {
                    const original = makeAnnotation(getNewId(annotations), sel, type);
                    const copy = clone(original);
                    expect(copy.selection.eq(original.selection)).toBe(true);
                    expect(copy.selection).not.toBe(original.selection);
                },
            ),
        );
    });
});

// ── isAnnotationOfType ───────────────────────────────────────────────────────

describe("isAnnotationOfType", () => {
    it("is consistent with _type field", () => {
        fc.assert(
            fc.property(
                arbAnnotations,
                arbSelection,
                arbAnnotationType,
                (annotations, sel, type) => {
                    const annotation = makeAnnotation(getNewId(annotations), sel, type);
                    expect(isAnnotationOfType(annotation, type)).toBe(true);
                    const otherTypes = (["comment", "suggestion", "revision"] as const).filter(
                        (t) => t !== type,
                    );
                    for (const other of otherTypes) {
                        expect(isAnnotationOfType(annotation, other)).toBe(false);
                    }
                },
            ),
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

// ── canCreateRevision ────────────────────────────────────────────────────────

describe("canCreateRevision", () => {
    // ── baseline ─────────────────────────────────────────────────────────────

    it("returns true for empty annotations map", () => {
        fc.assert(
            fc.property(arbSelection, (sel) => {
                expect(canCreateRevision({}, sel)).toBe(true);
            }),
        );
    });

    it("returns true when annotations contain only comments and suggestions", () => {
        fc.assert(
            fc.property(arbSelection, arbSelection, arbSelection, (sel, sel2, newSel) => {
                const commentId = 0;
                const suggestionId = 1;
                const annotations: Annotations = {
                    [commentId]: makeAnnotation(commentId, sel, "comment"),
                    [suggestionId]: makeAnnotation(suggestionId, sel2, "suggestion"),
                };
                expect(canCreateRevision(annotations, newSel)).toBe(true);
            }),
        );
    });

    // ── overlap cases ─────────────────────────────────────────────────────────

    it("returns false when new selection is identical to an existing revision", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 9_000 }),
                fc.integer({ min: 1, max: 1000 }),
                (from, len) => {
                    const sel = EditorSelection.create([EditorSelection.range(from, from + len)]);
                    const annotations: Annotations = {
                        0: makeAnnotation(0, sel, "revision"),
                    };
                    expect(canCreateRevision(annotations, sel)).toBe(false);
                },
            ),
        );
    });

    it("returns false when new range is strictly inside an existing revision", () => {
        // existing: [10, 20], new: [12, 18]
        const existing = EditorSelection.create([EditorSelection.range(10, 20)]);
        const newSel = EditorSelection.create([EditorSelection.range(12, 18)]);
        const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
        expect(canCreateRevision(annotations, newSel)).toBe(false);
    });

    it("returns false when existing revision is strictly inside the new range", () => {
        // existing: [12, 18], new: [10, 20]
        const existing = EditorSelection.create([EditorSelection.range(12, 18)]);
        const newSel = EditorSelection.create([EditorSelection.range(10, 20)]);
        const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
        expect(canCreateRevision(annotations, newSel)).toBe(false);
    });

    it("returns false when new range partially overlaps from the left", () => {
        // existing: [10, 20], new: [5, 15]
        const existing = EditorSelection.create([EditorSelection.range(10, 20)]);
        const newSel = EditorSelection.create([EditorSelection.range(5, 15)]);
        const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
        expect(canCreateRevision(annotations, newSel)).toBe(false);
    });

    it("returns false when new range partially overlaps from the right", () => {
        // existing: [10, 20], new: [15, 25]
        const existing = EditorSelection.create([EditorSelection.range(10, 20)]);
        const newSel = EditorSelection.create([EditorSelection.range(15, 25)]);
        const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
        expect(canCreateRevision(annotations, newSel)).toBe(false);
    });

    // ── adjacency: touching edges are NOT overlapping ─────────────────────────

    it("returns true when new range ends exactly where existing revision starts", () => {
        // existing: [10, 20], new: [0, 10] — touching at 10 but not overlapping
        const existing = EditorSelection.create([EditorSelection.range(10, 20)]);
        const newSel = EditorSelection.create([EditorSelection.range(0, 10)]);
        const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
        expect(canCreateRevision(annotations, newSel)).toBe(true);
    });

    it("returns true when new range starts exactly where existing revision ends", () => {
        // existing: [10, 20], new: [20, 30] — touching at 20 but not overlapping
        const existing = EditorSelection.create([EditorSelection.range(10, 20)]);
        const newSel = EditorSelection.create([EditorSelection.range(20, 30)]);
        const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
        expect(canCreateRevision(annotations, newSel)).toBe(true);
    });

    it("returns true when new range is entirely before any existing revision", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 50, max: 9_000 }),
                fc.integer({ min: 1, max: 40 }),
                fc.integer({ min: 1, max: 40 }),
                (existingFrom, existingLen, newLen) => {
                    const existing = EditorSelection.create([
                        EditorSelection.range(existingFrom, existingFrom + existingLen),
                    ]);
                    // new range ends at existingFrom - 1, so strictly before
                    const newEnd = existingFrom - 1;
                    fc.pre(newEnd > 0 && newEnd - newLen >= 0);
                    const newSel = EditorSelection.create([
                        EditorSelection.range(newEnd - newLen, newEnd),
                    ]);
                    const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
                    expect(canCreateRevision(annotations, newSel)).toBe(true);
                },
            ),
        );
    });

    it("returns true when new range is entirely after any existing revision", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 5_000 }),
                fc.integer({ min: 1, max: 40 }),
                fc.integer({ min: 1, max: 40 }),
                (existingFrom, existingLen, newLen) => {
                    const existingTo = existingFrom + existingLen;
                    const existing = EditorSelection.create([
                        EditorSelection.range(existingFrom, existingTo),
                    ]);
                    // new range starts at existingTo + 1, so strictly after
                    const newStart = existingTo + 1;
                    const newSel = EditorSelection.create([
                        EditorSelection.range(newStart, newStart + newLen),
                    ]);
                    const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
                    expect(canCreateRevision(annotations, newSel)).toBe(true);
                },
            ),
        );
    });

    // ── multiple revisions ────────────────────────────────────────────────────

    it("returns false when overlapping any one of several non-overlapping revisions", () => {
        // Revisions at [0,10], [20,30], [40,50]. New overlaps the middle one.
        const annotations: Annotations = {
            0: makeAnnotation(
                0,
                EditorSelection.create([EditorSelection.range(0, 10)]),
                "revision",
            ),
            1: makeAnnotation(
                1,
                EditorSelection.create([EditorSelection.range(20, 30)]),
                "revision",
            ),
            2: makeAnnotation(
                2,
                EditorSelection.create([EditorSelection.range(40, 50)]),
                "revision",
            ),
        };
        const overlapsMiddle = EditorSelection.create([EditorSelection.range(25, 35)]);
        expect(canCreateRevision(annotations, overlapsMiddle)).toBe(false);
    });

    it("returns true when fitting in a gap between two existing revisions", () => {
        // Revisions at [0,10] and [20,30]. New range [11,19] fits in gap.
        const annotations: Annotations = {
            0: makeAnnotation(
                0,
                EditorSelection.create([EditorSelection.range(0, 10)]),
                "revision",
            ),
            1: makeAnnotation(
                1,
                EditorSelection.create([EditorSelection.range(20, 30)]),
                "revision",
            ),
        };
        const inGap = EditorSelection.create([EditorSelection.range(11, 19)]);
        expect(canCreateRevision(annotations, inGap)).toBe(true);
    });

    it("returns false when spanning across two existing revisions", () => {
        // Revisions at [0,10] and [20,30]. New range [5,25] spans both.
        const annotations: Annotations = {
            0: makeAnnotation(
                0,
                EditorSelection.create([EditorSelection.range(0, 10)]),
                "revision",
            ),
            1: makeAnnotation(
                1,
                EditorSelection.create([EditorSelection.range(20, 30)]),
                "revision",
            ),
        };
        const spanning = EditorSelection.create([EditorSelection.range(5, 25)]);
        expect(canCreateRevision(annotations, spanning)).toBe(false);
    });

    // ── comments/suggestions don't block revision creation ───────────────────

    it("returns true even when a comment or suggestion occupies the same range", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 9_000 }),
                fc.integer({ min: 1, max: 1000 }),
                (from, len) => {
                    const sel = EditorSelection.create([EditorSelection.range(from, from + len)]);
                    const annotations: Annotations = {
                        0: makeAnnotation(0, sel, "comment"),
                        1: makeAnnotation(1, sel, "suggestion"),
                    };
                    expect(canCreateRevision(annotations, sel)).toBe(true);
                },
            ),
        );
    });

    // ── property: non-overlap implies canCreateRevision ──────────────────────

    it("returns true iff no range in the new selection intersects any revision range (property)", () => {
        const arbRange = fc
            .tuple(arbNonNegInt, fc.integer({ min: 1, max: 500 }))
            .map(([from, len]) => ({ from, to: from + len }));

        fc.assert(
            fc.property(
                // one existing revision range
                arbRange,
                // the new selection's main range
                arbRange,
                ({ from: ef, to: et }, { from: nf, to: nt }) => {
                    const existing = EditorSelection.create([EditorSelection.range(ef, et)]);
                    const newSel = EditorSelection.create([EditorSelection.range(nf, nt)]);
                    const annotations: Annotations = {
                        0: makeAnnotation(0, existing, "revision"),
                    };
                    const overlaps = nf < et && nt > ef;
                    expect(canCreateRevision(annotations, newSel)).toBe(!overlaps);
                },
            ),
        );
    });

    // ── multi-range selections ────────────────────────────────────────────────

    it("returns false when a non-main range in the new selection overlaps an existing revision", () => {
        // existing revision at [20, 30]; new selection has main at [0, 5] (safe) but
        // a secondary range at [25, 35] that overlaps
        const existing = EditorSelection.create([EditorSelection.range(20, 30)]);
        const newSel = EditorSelection.create(
            [EditorSelection.range(0, 5), EditorSelection.range(25, 35)],
            0, // main is index 0 — the safe range
        );
        const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
        expect(canCreateRevision(annotations, newSel)).toBe(false);
    });

    it("returns false when all ranges in the new multi-range selection overlap an existing revision", () => {
        // existing revision at [10, 50]; new selection has two ranges both inside it
        const existing = EditorSelection.create([EditorSelection.range(10, 50)]);
        const newSel = EditorSelection.create([
            EditorSelection.range(15, 20),
            EditorSelection.range(30, 40),
        ]);
        const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
        expect(canCreateRevision(annotations, newSel)).toBe(false);
    });

    it("returns true when all ranges in the new multi-range selection avoid an existing revision", () => {
        // existing revision at [20, 30]; new selection has two ranges both outside it
        const existing = EditorSelection.create([EditorSelection.range(20, 30)]);
        const newSel = EditorSelection.create([
            EditorSelection.range(0, 10),
            EditorSelection.range(35, 45),
        ]);
        const annotations: Annotations = { 0: makeAnnotation(0, existing, "revision") };
        expect(canCreateRevision(annotations, newSel)).toBe(true);
    });

    // ── idempotency ───────────────────────────────────────────────────────────

    it("does not mutate the annotations map", () => {
        fc.assert(
            fc.property(arbAnnotations, arbSelection, (annotations, sel) => {
                const before = JSON.stringify(annotations);
                canCreateRevision(annotations, sel);
                expect(JSON.stringify(annotations)).toBe(before);
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
            fc.property(
                fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
                (val) => {
                    expect(RawAnnotationsSchema.safeParse(val).success).toBe(false);
                },
            ),
        );
    });
});
