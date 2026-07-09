import {
    BALANCED_REVIEW_FOCUS,
    REVIEW_TEMPLATES,
    getReviewTemplate,
} from "$lib/ai/editor";
import { describe, expect, it } from "vitest";

describe("Quillium review templates", () => {
    it("provides distinct editorial jobs instead of stage labels", () => {
        expect(REVIEW_TEMPLATES.map((template) => template.label)).toEqual([
            "Balanced review",
            "Develop ideas",
            "Structure & flow",
            "Voice & clarity",
            "Line edit",
            "Proofread",
        ]);
    });

    it("keeps proofreading grammar-only", () => {
        expect(getReviewTemplate("proofread")).toMatchObject({
            stage: "proofing",
            focus: ["grammar_only"],
        });
    });

    it("uses the shared balanced focus for saved templates", () => {
        expect(BALANCED_REVIEW_FOCUS).toEqual([
            "reader_view",
            "voice_guard",
            "specificity",
            "clarity",
        ]);
    });
});
