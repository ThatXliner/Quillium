import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    MIN_SPACING,
    TOP_CLAMP,
    balanceColumns,
    canFloatAnnotationColumn,
    columnInnerHeight,
    layoutColumnPositions,
} from "../src/layout/annotationLayout";

describe("layoutColumnPositions", () => {
    it("makes compact columns scrollable by their full overhead", () => {
        expect(columnInnerHeight(400, 720, 108)).toBe(828);
        expect(columnInnerHeight(900, 720, 108)).toBe(924);
    });

    it("supports serialized string IDs", () => {
        const layout = layoutColumnPositions(
            [
                { id: "comment-1", viewportY: 100, height: 80 },
                { id: "revision-2", viewportY: 110, height: 100 },
            ],
            "revision-2",
        );

        expect(layout.adjustedY["comment-1"]).toBeDefined();
        expect(layout.adjustedY["revision-2"]).toBeDefined();
    });

    it("preserves desktop numeric ordering when anchors are equal", () => {
        const layout = layoutColumnPositions(
            [
                { id: 10, viewportY: 100, height: 20 },
                { id: 2, viewportY: 100, height: 20 },
            ],
            null,
        );

        expect(layout.adjustedY[2]).toBe(TOP_CLAMP + 36);
        expect(layout.adjustedY[10]).toBe(TOP_CLAMP + 36 + 20 + MIN_SPACING);
    });

    it("clamps an inactive column and preserves minimum spacing", () => {
        const layout = layoutColumnPositions(
            [
                { id: 1, viewportY: 10, height: 100 },
                { id: 2, viewportY: 20, height: 100 },
            ],
            null,
        );

        expect(layout.adjustedY[1]).toBe(TOP_CLAMP);
        expect(layout.adjustedY[2]).toBe(TOP_CLAMP + 100 + MIN_SPACING);
    });

    it("keeps the active card visibly anchored after overhead scrolling", () => {
        const activeY = 50;
        const layout = layoutColumnPositions(
            [
                { id: "above", viewportY: 30, height: 100 },
                { id: "active", viewportY: activeY, height: 100 },
            ],
            "active",
        );

        expect((layout.adjustedY.active ?? 0) - layout.overhead).toBe(activeY);
    });

    it("never overlaps cards and always contains them for arbitrary columns", () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        viewportY: fc.integer({ min: -200, max: 2_000 }),
                        height: fc.integer({ min: 1, max: 500 }),
                    }),
                    { minLength: 1, maxLength: 30 },
                ),
                fc.nat(),
                (values, activeSeed) => {
                    const cards = values.map((value, id) => ({ id, ...value }));
                    const activeId = activeSeed % (cards.length + 1);
                    const active = activeId === cards.length ? null : activeId;
                    const layout = layoutColumnPositions(cards, active);
                    const sorted = [...cards].sort((a, b) => a.viewportY - b.viewportY);

                    for (let index = 1; index < sorted.length; index++) {
                        const previous = sorted[index - 1];
                        const current = sorted[index];
                        expect(layout.adjustedY[current.id] ?? 0).toBeGreaterThanOrEqual(
                            (layout.adjustedY[previous.id] ?? 0) + previous.height + MIN_SPACING,
                        );
                    }
                    for (const card of cards) {
                        expect(layout.maxBottom).toBeGreaterThanOrEqual(
                            (layout.adjustedY[card.id] ?? 0) + card.height,
                        );
                    }
                    if (active !== null) {
                        expect((layout.adjustedY[active] ?? 0) - layout.overhead).toBe(
                            cards[active].viewportY,
                        );
                    }
                },
            ),
            { numRuns: 500 },
        );
    });
});

describe("balanceColumns", () => {
    it("is deterministic and supports string IDs", () => {
        const items = [
            { id: "a", viewportY: 50, height: 300, viewportX: 100 },
            { id: "b", viewportY: 60, height: 40, viewportX: 100 },
            { id: "c", viewportY: 70, height: 40, viewportX: 100 },
        ];

        expect(balanceColumns(items, 500)).toEqual(balanceColumns(items, 500));
        expect(balanceColumns(items, 500)).toEqual({ a: "left", b: "right", c: "right" });
    });

    it("uses numeric ID order for desktop cards with equal anchors", () => {
        expect(
            balanceColumns(
                [
                    { id: 10, viewportY: 100, height: 80, viewportX: 100 },
                    { id: 2, viewportY: 100, height: 80, viewportX: 100 },
                ],
                500,
            ),
        ).toEqual({ 2: "left", 10: "right" });
    });
});

describe("canFloatAnnotationColumn", () => {
    it("uses the desktop minimum against measured space", () => {
        expect(canFloatAnnotationColumn({ width: 149.99 })).toBe(false);
        expect(canFloatAnnotationColumn({ width: 150 })).toBe(true);
    });
});
