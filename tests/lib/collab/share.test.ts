import { buildReadonlyShareUrl, buildSharePreviewText } from "$lib/collab/share";
import { describe, expect, it } from "vitest";

describe("buildReadonlyShareUrl", () => {
    it("builds the public share URL", () => {
        expect(buildReadonlyShareUrl("abc-123")).toBe("https://quillium.bryanhu.com/share/abc-123");
    });
});

describe("buildSharePreviewText", () => {
    it("collapses repeated whitespace", () => {
        expect(buildSharePreviewText("Hello\n\nworld   again", 40)).toBe("Hello world again");
    });

    it("truncates long previews with an ellipsis", () => {
        expect(buildSharePreviewText("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
    });
});
