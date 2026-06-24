import { type TabRect, computeReorder } from "$lib/editor/tabReorder";
import { describe, expect, it } from "vitest";

// Three 100px-wide tabs laid out edge to edge: a[0..100] b[100..200] c[200..300].
// Centres: a=50, b=150, c=250.
const RECTS: Record<string, TabRect> = {
    a: { left: 0, width: 100 },
    b: { left: 100, width: 100 },
    c: { left: 200, width: 100 },
};
const ORDER = ["a", "b", "c"];

describe("computeReorder", () => {
    it("keeps order when the dragged centre is over its own slot", () => {
        // Dragging 'a', centre still ~50 (left of b's centre 150) → stays first.
        expect(computeReorder(50, RECTS, ORDER, "a")).toEqual(["a", "b", "c"]);
    });

    it("moves the dragged tab right past one neighbour", () => {
        // Drag 'a' so its centre (160) passes b's centre (150) but not c's (250).
        expect(computeReorder(160, RECTS, ORDER, "a")).toEqual(["b", "a", "c"]);
    });

    it("moves the dragged tab to the end", () => {
        // Drag 'a' past both b and c centres.
        expect(computeReorder(260, RECTS, ORDER, "a")).toEqual(["b", "c", "a"]);
    });

    it("moves the dragged tab left to the front", () => {
        // Drag 'c' so its centre (40) is left of a's centre (50).
        expect(computeReorder(40, RECTS, ORDER, "c")).toEqual(["c", "a", "b"]);
    });

    it("clamps insertion within bounds for far-right drags", () => {
        expect(computeReorder(99999, RECTS, ORDER, "b")).toEqual(["a", "c", "b"]);
    });

    it("returns a copy, never mutating the input order", () => {
        const input = [...ORDER];
        const out = computeReorder(160, RECTS, input, "a");
        expect(input).toEqual(["a", "b", "c"]);
        expect(out).not.toBe(input);
    });

    it("returns order unchanged when the dragged tab has no geometry", () => {
        expect(computeReorder(160, { a: RECTS.a, b: RECTS.b }, ORDER, "c")).toEqual([
            "a",
            "b",
            "c",
        ]);
    });
});
