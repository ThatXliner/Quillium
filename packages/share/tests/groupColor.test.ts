import { describe, expect, it } from "vitest";
import { groupColor } from "../src/groupColor";

describe("groupColor", () => {
    it("is deterministic and returns a palette color", () => {
        expect(groupColor("formal")).toBe(groupColor("formal"));
        expect(groupColor("formal")).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("distributes distinct group ids across the palette", () => {
        const colors = new Set(["a", "b", "c", "d", "e", "f"].map(groupColor));
        expect(colors.size).toBeGreaterThan(1);
    });
});
