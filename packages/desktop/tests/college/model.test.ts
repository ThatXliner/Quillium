import {
    type CollegeSetup,
    cloneCollegeSetup,
    collegeSetupSchema,
    parseCollegeSetup,
} from "$lib/college/model";
import {
    collegeResearchPromptKey,
    collegeResearchSetupKey,
    isCollegeReferenceCurrent,
} from "$lib/college/researchModel";
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

    it("round-trips optional section mode, prompt archive, and prompt-scoped research keys", () => {
        const original = setup();
        original.sectionMode = true;
        original.promptArchive = [
            {
                ...original.prompts[0],
                id: "archived-prompt",
                text: "An archived prompt",
            },
        ];
        original.references = [
            {
                id: "reference-1",
                publisher: "Example University",
                url: "https://example.edu/requirements",
                checkedDate: "2026-09-07",
                cycle: "2026",
                kind: "requirement",
                summary: "A requirement",
                research: {
                    setupKey: "legacy-key",
                    snapshotId: "snapshot-1",
                    promptIds: ["prompt-1"],
                    promptKeys: { "prompt-1": "prompt-key" },
                    school: "Example University",
                    program: "History",
                    targetCycle: "2026",
                    evidence: "A requirement",
                },
            },
        ];

        const parsed = parseCollegeSetup(JSON.stringify(original));

        expect(parsed.sectionMode).toBe(true);
        expect(parsed.promptArchive?.[0]?.id).toBe("archived-prompt");
        expect(parsed.references[0]?.research?.promptKeys).toEqual({ "prompt-1": "prompt-key" });
    });

    it("allows an empty active prompt list only for section mode", () => {
        const original = setup();
        expect(() => parseCollegeSetup({ ...original, prompts: [] })).toThrow();
        expect(parseCollegeSetup({ ...original, sectionMode: true, prompts: [] }).prompts).toEqual(
            [],
        );
    });

    it("preserves more than twelve prompts through serialization", () => {
        const original = setup();
        original.prompts = Array.from({ length: 14 }, (_, index) => ({
            ...original.prompts[0],
            id: `prompt-${index + 1}`,
            label: `Prompt ${index + 1}`,
            text: `Prompt ${index + 1}`,
        }));

        const parsed = parseCollegeSetup(JSON.stringify(original));

        expect(parsed.prompts).toHaveLength(14);
        expect(parsed.prompts.at(-1)?.id).toBe("prompt-14");
    });

    it("matches prompt-scoped research independently of unrelated prompt changes", () => {
        const original = setup();
        const other = { ...original.prompts[0], id: "prompt-2", text: "Another prompt" };
        original.prompts.push(other);
        const promptKey = collegeResearchPromptKey(original, original.prompts[0]);
        const reference = {
            research: {
                setupKey: collegeResearchSetupKey(original),
                snapshotId: "snapshot-1",
                promptIds: ["prompt-1"],
                promptKeys: { "prompt-1": promptKey },
                school: original.school,
                program: original.program,
                targetCycle: original.cycle,
                evidence: "Evidence",
            },
        };

        const unrelatedChange = {
            ...original,
            prompts: [original.prompts[0], { ...other, text: "Changed" }],
        };
        expect(isCollegeReferenceCurrent(reference, unrelatedChange)).toBe(true);
        expect(
            isCollegeReferenceCurrent(reference, {
                ...original,
                prompts: [{ ...original.prompts[0], text: "Changed" }, other],
            }),
        ).toBe(false);
        expect(isCollegeReferenceCurrent(reference, { ...original, prompts: [other] })).toBe(false);
    });

    it("keeps legacy research on the full setup key", () => {
        const original = setup();
        const reference = {
            research: {
                setupKey: collegeResearchSetupKey(original),
                snapshotId: "snapshot-1",
                promptIds: ["prompt-1"],
                school: original.school,
                program: original.program,
                targetCycle: original.cycle,
                evidence: "Evidence",
            },
        };

        expect(isCollegeReferenceCurrent(reference, original)).toBe(true);
        expect(
            isCollegeReferenceCurrent(reference, {
                ...original,
                prompts: [{ ...original.prompts[0], text: "Changed" }],
            }),
        ).toBe(false);
    });
});
