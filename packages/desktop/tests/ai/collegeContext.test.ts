import { buildAiContextPacket, contextPacketToPrompt } from "$lib/ai/context";
import type { CollegeBrief, CollegeReference } from "$lib/college/model";
import { describe, expect, it } from "vitest";

function brief(): CollegeBrief {
    return {
        school: "Example University",
        program: "History",
        cycle: "2026",
        intent: "x".repeat(2000),
        feedbackFocus: "y".repeat(2000),
        prompts: Array.from({ length: 12 }, (_, index) => ({
            id: `prompt-${index}`,
            label: `Prompt ${index}`,
            text: "z".repeat(4000),
            sourceUrl: "https://example.edu/prompt",
            constraints: [],
        })),
    };
}

function reference(index: number): CollegeReference {
    return {
        id: `reference-${index}`,
        publisher: "Example University",
        url: "https://example.edu/requirements",
        checkedDate: "2026-09-07",
        cycle: "2026",
        kind: "requirement",
        summary: "r".repeat(2000),
    };
}

describe("College context packet", () => {
    it("keeps the tab brief and source guidance in separate bounded fields", () => {
        const packet = buildAiContextPacket({
            mode: "chat",
            documentContent: "",
            documentContext: {
                freeform: "Shared notes",
                decisions: ["Keep the ending open."],
                collegeBrief: brief(),
                collegeReferences: Array.from({ length: 12 }, (_, index) => reference(index)),
            },
        });

        expect(packet.scope).toBe("empty");
        expect(packet.collegeBriefText.length).toBeLessThanOrEqual(8000);
        expect(JSON.stringify(packet.collegeReferences).length).toBeLessThanOrEqual(6000);
        expect(packet.omittedCollegeBriefChars).toBeGreaterThan(0);
        expect(packet.omittedCollegeReferenceCount).toBeGreaterThan(0);
        expect(packet.sources.map((source) => source.id)).toContain("tab-brief");
        expect(packet.sources.map((source) => source.id)).toContain("college-references");

        const prompt = contextPacketToPrompt(packet);
        expect(prompt).toContain('"source": "tab-writing-brief"');
        expect(prompt).toContain('"source": "college-guidance"');
        expect(prompt).toContain("omittedCharacters");
        expect(prompt).toContain("omittedReferences");
    });

    it("does not drop a tab brief when the draft is empty", () => {
        const packet = buildAiContextPacket({
            mode: "chat",
            documentContent: "",
            documentContext: {
                collegeBrief: {
                    ...brief(),
                    intent: "Plan before drafting.",
                    feedbackFocus: "",
                    prompts: [brief().prompts[0]],
                },
            },
        });
        expect(packet.scope).toBe("empty");
        expect(contextPacketToPrompt(packet)).toContain("tab-writing-brief");
    });
});
