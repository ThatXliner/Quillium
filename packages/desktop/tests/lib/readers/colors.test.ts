import { lightTint, mediumTint } from "$lib/readers/colors";
import { describe, expect, it } from "vitest";

describe("reader color tint helpers", () => {
    it("mixes black toward white at the configured strengths", () => {
        expect(lightTint("#000000")).toBe("rgb(217, 217, 217)");
        expect(mediumTint("#000000")).toBe("rgb(140, 140, 140)");
    });

    it("preserves white when tinting", () => {
        expect(lightTint("#ffffff")).toBe("rgb(255, 255, 255)");
        expect(mediumTint("#ffffff")).toBe("rgb(255, 255, 255)");
    });

    it("tints each RGB channel independently", () => {
        expect(lightTint("#336699")).toBe("rgb(224, 232, 240)");
        expect(mediumTint("#336699")).toBe("rgb(163, 186, 209)");
    });
});
