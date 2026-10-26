import {
    MIN_SPACING,
    TOP_CLAMP,
    balanceColumns,
    idSignature,
    layoutColumnPositions,
    sidesEqual,
} from "$lib/editor/plugins/annotations/annotationLayout";
import { describe, expect, it } from "vitest";

describe("balanceColumns", () => {
    it("returns empty for no items", () => {
        expect(balanceColumns([], 500)).toEqual({});
    });

    it("breaks the first tie toward the side the text leans toward", () => {
        const side = balanceColumns(
            [{ id: 1, viewportY: 100, height: 80, viewportX: 100 }],
            500, // center — text at x=100 leans left
        );
        expect(side[1]).toBe("left");
    });

    it("alternates when cards stack at the same Y", () => {
        const side = balanceColumns(
            [
                { id: 1, viewportY: 100, height: 80, viewportX: 100 },
                { id: 2, viewportY: 100, height: 80, viewportX: 100 },
            ],
            500,
        );
        // First goes left (tie → text side); second sees left occupied.
        expect(side[1]).toBe("left");
        expect(side[2]).toBe("right");
    });

    it("fills the more open column when heights are uneven", () => {
        const side = balanceColumns(
            [
                { id: 1, viewportY: 100, height: 300, viewportX: 100 }, // tall, left
                { id: 2, viewportY: 120, height: 40, viewportX: 100 }, // right
                { id: 3, viewportY: 140, height: 40, viewportX: 100 }, // right again (left is full)
            ],
            500,
        );
        expect(side[1]).toBe("left");
        expect(side[2]).toBe("right");
        expect(side[3]).toBe("right");
    });

    it("is deterministic for identical inputs", () => {
        const items = [
            { id: 3, viewportY: 50, height: 60, viewportX: 700 },
            { id: 1, viewportY: 50, height: 60, viewportX: 700 },
            { id: 2, viewportY: 200, height: 60, viewportX: 100 },
        ];
        expect(balanceColumns(items, 500)).toEqual(balanceColumns(items, 500));
    });
});

describe("layoutColumnPositions", () => {
    it("returns empty layout for no cards", () => {
        const { adjustedY, overhead, maxBottom } = layoutColumnPositions([], null);
        expect(adjustedY).toEqual({});
        expect(overhead).toBe(0);
        expect(maxBottom).toBe(0);
    });

    it("clamps cards to the top and stacks them without overlap (no active)", () => {
        const { adjustedY, overhead } = layoutColumnPositions(
            [
                { id: 1, viewportY: 10, height: 100 }, // above TOP_CLAMP
                { id: 2, viewportY: 20, height: 100 }, // overlaps card 1
            ],
            null,
        );
        expect(overhead).toBe(0);
        expect(adjustedY[1]).toBe(TOP_CLAMP);
        expect(adjustedY[2]).toBe(TOP_CLAMP + 100 + MIN_SPACING);
    });

    it("anchors the active card at its natural Y and pushes neighbors away", () => {
        const { adjustedY } = layoutColumnPositions(
            [
                { id: 1, viewportY: 190, height: 100 }, // would overlap active from above
                { id: 2, viewportY: 200, height: 100 }, // active
                { id: 3, viewportY: 210, height: 100 }, // would overlap active from below
            ],
            2,
        );
        expect(adjustedY[2] - adjustedY[1]).toBeGreaterThanOrEqual(100 + MIN_SPACING);
        expect(adjustedY[3] - adjustedY[2]).toBeGreaterThanOrEqual(100 + MIN_SPACING);
        // Below-card keeps stacking downward from the active card.
        expect(adjustedY[3]).toBe(adjustedY[2] + 100 + MIN_SPACING);
    });

    it("adds overhead when cards are pushed above Y=0", () => {
        const { adjustedY, overhead } = layoutColumnPositions(
            [
                { id: 1, viewportY: 30, height: 100 }, // pushed above the active card → negative
                { id: 2, viewportY: 50, height: 100 }, // active, anchored at 50
            ],
            2,
        );
        // Card 1 must fit wholly above card 2 at Y=50 → its top is negative
        // pre-shift, so the whole layout shifts down by `overhead`.
        expect(overhead).toBeGreaterThan(0);
        expect(adjustedY[1]).toBe(0);
        expect(adjustedY[2]).toBe(50 + overhead);
    });

    it("reports an inner height that contains every card", () => {
        const cards = [
            { id: 1, viewportY: 100, height: 80 },
            { id: 2, viewportY: 400, height: 120 },
        ];
        const { adjustedY, maxBottom } = layoutColumnPositions(cards, null);
        for (const c of cards) {
            expect(maxBottom).toBeGreaterThanOrEqual(adjustedY[c.id] + c.height);
        }
    });
});

describe("sidesEqual", () => {
    it("compares maps by entries", () => {
        expect(sidesEqual({ 1: "left" }, { 1: "left" })).toBe(true);
        expect(sidesEqual({ 1: "left" }, { 1: "right" })).toBe(false);
        expect(sidesEqual({ 1: "left" }, { 1: "left", 2: "right" })).toBe(false);
        expect(sidesEqual({}, {})).toBe(true);
    });
});

describe("idSignature", () => {
    it("is order-independent", () => {
        expect(idSignature([3, 1, 2])).toBe(idSignature([1, 2, 3]));
        expect(idSignature([])).toBe("");
    });
});
