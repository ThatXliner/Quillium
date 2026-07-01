import { lintKindClass } from "$lib/editor/harper/lintKindColor";
import { describe, expect, it } from "vitest";

describe("lintKindClass", () => {
    it("uses the spelling class for spelling lints", () => {
        expect(lintKindClass("Spelling")).toBe("harper-spelling");
    });

    it("uses the grammar class for every non-spelling lint kind", () => {
        expect(lintKindClass("Grammar")).toBe("harper-grammar");
        expect(lintKindClass("Style")).toBe("harper-grammar");
        expect(lintKindClass("")).toBe("harper-grammar");
    });
});
