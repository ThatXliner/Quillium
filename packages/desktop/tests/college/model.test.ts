import {
    type CollegeSetup,
    cloneCollegeSetup,
    collegeSetupSchema,
    parseCollegeSetup,
} from "$lib/college/model";
import { describe, expect, it } from "vitest";

function setup(overrides: Partial<CollegeSetup> = {}): CollegeSetup {
    return {
        version: 1,
        presetVersion: 1,
        kind: "supplemental",
        cycle: "2026",
        school: "Example University",
        program: "History",
        intent: "Tell a concrete story.",
        feedbackFocus: "Specificity and reflection.",
        prompts: [
            {
                id: "prompt-1",
                label: "Supplement",
                text: "Describe a meaningful experience.",
                sourceUrl: "https://example.edu/prompts",
                constraints: [
                    {
                        id: "constraint-1",
                        unit: "words",
                        min: 100,
                        max: 650,
                        detail: "",
                    },
                ],
            },
        ],
        preferences: {
            stance: "author-first",
            feedbackDensity: "focused",
            voiceLatitude: "preserve",
        },
        readers: [],
        feedbackReaders: false,
        reviseReaders: false,
        active: true,
        references: [],
        ...overrides,
    };
}

describe("college setup model", () => {
    it("parses supported JSON and defaults revise readers to false", () => {
        const raw = JSON.stringify({ ...setup(), reviseReaders: undefined });
        const parsed = parseCollegeSetup(raw);
        expect(parsed.version).toBe(1);
        expect(parsed.reviseReaders).toBe(false);
    });

    it("fails closed for future and malformed versions", () => {
        expect(() => parseCollegeSetup({ ...setup(), version: 2 })).toThrow(/unsupported version/i);
        expect(() => parseCollegeSetup({ ...setup(), school: 42 })).toThrow(/invalid/i);
        expect(() => parseCollegeSetup("not json")).toThrow(/valid JSON/i);
    });

    it("rejects unsafe URLs, duplicate IDs, and inverted constraints", () => {
        expect(() =>
            collegeSetupSchema.parse({
                ...setup(),
                prompts: [{ ...setup().prompts[0], sourceUrl: "javascript:alert(1)" }],
            }),
        ).toThrow();
        expect(() =>
            collegeSetupSchema.parse({
                ...setup(),
                prompts: [setup().prompts[0], { ...setup().prompts[0] }],
            }),
        ).toThrow(/Prompt IDs must be unique/);
        expect(() =>
            collegeSetupSchema.parse({
                ...setup(),
                prompts: [
                    {
                        ...setup().prompts[0],
                        constraints: [{ ...setup().prompts[0].constraints[0], min: 700, max: 100 }],
                    },
                ],
            }),
        ).toThrow(/minimum cannot exceed/i);
    });

    it("deep clones setup values", () => {
        const original = setup();
        const cloned = cloneCollegeSetup(original);
        cloned.prompts[0].constraints[0].min = 250;
        expect(original.prompts[0].constraints[0].min).toBe(100);
    });
});
