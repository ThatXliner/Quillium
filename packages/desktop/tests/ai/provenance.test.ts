import { createAiGenerationProvenance } from "$lib/ai/provenance";
import {
    AiGenerationProvenanceSchema,
    RawAnnotationSchema,
    VersionStateSchema,
} from "$lib/editor/plugins/annotations/models";
import { describe, expect, it } from "vitest";

describe("AI generation provenance", () => {
    it("records a stable request identity and generation settings", () => {
        const provenance = createAiGenerationProvenance({
            task: "local-rewrite",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            persona: "Skeptical editor",
            requestId: "request-7",
            createdAt: 1234,
        });

        expect(provenance).toEqual({
            requestId: "request-7",
            task: "local-rewrite",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            persona: "Skeptical editor",
            createdAt: 1234,
        });
        expect(AiGenerationProvenanceSchema.safeParse(provenance).success).toBe(true);
    });

    it("omits an empty persona", () => {
        const provenance = createAiGenerationProvenance({
            task: "background-review",
            provider: "openai",
            model: "gpt-5.6-sol",
            persona: "",
            requestId: "request-8",
            createdAt: 5678,
        });

        expect(provenance).not.toHaveProperty("persona");
    });

    it("survives persisted annotation and revision-version schemas", () => {
        const provenance = createAiGenerationProvenance({
            task: "global-review",
            provider: "google",
            model: "gemini-3.5-flash",
            requestId: "request-9",
            createdAt: 9012,
        });
        const annotation = RawAnnotationSchema.parse({
            id: 1,
            _type: "comment",
            status: "active",
            selection: { ranges: [{ anchor: 0, head: 4 }], main: 0 },
            thread: [{ message: "Tighten this.", author: "AI", time: 9012 }],
            aiProvenance: provenance,
        });
        const version = VersionStateSchema.parse({
            id: "version-1",
            doc: "Rewritten text",
            provenance: "ai",
            aiProvenance: provenance,
        });

        expect(annotation.aiProvenance).toEqual(provenance);
        expect(version.aiProvenance).toEqual(provenance);
    });
});
