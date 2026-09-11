import { collegeSetupSchema } from "$lib/college/model";
import {
    COMMON_APP_PROMPTS,
    PRESET_LABELS,
    UC_PROMPTS,
    newCollegePrompt,
    newCollegeSetup,
} from "$lib/college/presets";
import { describe, expect, it } from "vitest";

const CHECKED_DATE = "2026-09-11";
const UC_URL =
    "https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/personal-insight-questions.html";
const COMMON_CURRENT_URL =
    "https://www.commonapp.org/blog/announcing-2026-2027-common-app-essay-prompts/";
const COMMON_WORKSHEET_URL =
    "https://www.commonapp.org/static/ff69a4ea4ce044fe419826e26803aa65/Resource_FY_Essays_ENG_2025.06.25_0.pdf";

describe("College presets", () => {
    it("provides the stable user-facing preset labels", () => {
        expect(PRESET_LABELS).toEqual({
            "uc-piq": "UC PIQ",
            "common-app": "Personal statement",
            supplemental: "Supplemental",
        });
    });

    it.each(["uc-piq", "common-app", "supplemental"] as const)(
        "creates a schema-valid %s setup with reader fan-out off",
        (kind) => {
            const setup = newCollegeSetup(kind);

            expect(() => collegeSetupSchema.parse(setup)).not.toThrow();
            expect(setup.version).toBe(1);
            expect(setup.presetVersion).toBe(1);
            expect(setup.active).toBe(true);
            expect(setup.feedbackReaders).toBe(false);
            expect(setup.reviseReaders).toBe(false);
            expect(setup.readers).toHaveLength(3);
            expect(setup.readers.map((reader) => [reader.id, reader.enabled])).toEqual([
                ["college-prompt-fit", true],
                ["college-specificity", false],
                ["college-voice", false],
            ]);
            expect(setup.readers.every((reader) => reader.builtin)).toBe(true);
            expect(setup.readers.every((reader) => reader.chattiness === "quiet")).toBe(true);
            expect(setup.prompts.every((prompt) => !prompt.label.includes("summary"))).toBe(true);
        },
    );

    it("bundles verbatim UC prompts and bounds responses to 350 words", () => {
        const setup = newCollegeSetup("uc-piq");
        const prompt = setup.prompts[0];

        expect(prompt.text).toBe(
            "Describe an example of your leadership experience in which you have positively influenced others, helped resolve disputes or contributed to group efforts over time.",
        );
        expect(UC_PROMPTS[1].text).toBe(
            "Every person has a creative side, and it can be expressed in many ways: problem solving, original and innovative thinking, and artistically, to name a few. Describe how you express your creative side.",
        );
        expect(UC_PROMPTS[7].text).toBe(
            "Beyond what has already been shared in your application, what do you believe makes you a strong candidate for admissions to the University of California?",
        );
        expect(prompt.sourceUrl).toBe(UC_URL);
        expect(prompt.constraints).toEqual([
            expect.objectContaining({ unit: "words", min: null, max: 350 }),
        ]);
        expect(setup.cycle).toBe("");
        expect(setup.references).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    publisher: "University of California",
                    url: UC_URL,
                    checkedDate: CHECKED_DATE,
                    cycle: "",
                    kind: "requirement",
                    summary:
                        "First-year applicants answer four of eight questions, with at most 350 words per response. The page does not identify an application cycle.",
                }),
                expect.objectContaining({
                    url: UC_URL,
                    checkedDate: CHECKED_DATE,
                    kind: "official-advice",
                }),
            ]),
        );
    });

    it("bundles verbatim Common App prompts with their current official source", () => {
        const setup = newCollegeSetup("common-app");
        const prompt = setup.prompts[0];

        expect(setup.cycle).toBe("2026–2027");
        expect(prompt.label).toBe("Identity");
        expect(COMMON_APP_PROMPTS[4].text).toBe(
            "Discuss an accomplishment, event, or realization that sparked a period of personal growth and a new understanding of yourself or others.",
        );
        expect(COMMON_APP_PROMPTS[6].text).toBe(
            "Share an essay on any topic of your choice. It can be one you've already written, one that responds to a different prompt, or one of your own design.",
        );
        expect(prompt.sourceUrl).toBe(COMMON_CURRENT_URL);
        expect(prompt.constraints[0]).toEqual(
            expect.objectContaining({ unit: "words", min: null, max: null }),
        );
        expect(setup.references).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    publisher: "Common App",
                    url: COMMON_WORKSHEET_URL,
                    checkedDate: CHECKED_DATE,
                    cycle: "2025 worksheet; current cycle unverified",
                    kind: "official-advice",
                }),
                expect.objectContaining({
                    publisher: "Common App",
                    url: COMMON_CURRENT_URL,
                    checkedDate: CHECKED_DATE,
                    cycle: "2026–2027",
                    kind: "official-advice",
                }),
            ]),
        );
    });

    it("leaves supplemental wording and provenance to the writer", () => {
        const setup = newCollegeSetup("supplemental");
        const prompt = setup.prompts[0];

        expect(prompt.text).toBe("");
        expect(prompt.sourceUrl).toBe("");
        expect(prompt.constraints).toEqual([
            expect.objectContaining({ unit: "other", min: null, max: null }),
        ]);
        expect(setup.references).toEqual([
            expect.objectContaining({
                publisher: "Quillium",
                url: "",
                checkedDate: CHECKED_DATE,
                cycle: "",
                kind: "editorial-guidance",
            }),
        ]);
        expect(setup.references.some((reference) => reference.kind === "requirement")).toBe(false);
    });

    it("creates a blank writer-owned prompt with an independent ID", () => {
        const first = newCollegePrompt();
        const second = newCollegePrompt();

        expect(first.id).not.toBe(second.id);
        expect(first.text).toBe("");
        expect(first.sourceUrl).toBe("");
        expect(first.constraints[0]).toEqual(expect.objectContaining({ min: null, max: null }));
        expect(COMMON_APP_PROMPTS).toHaveLength(7);
        expect(UC_PROMPTS).toHaveLength(8);
    });
});
