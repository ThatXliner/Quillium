import { parseCollegeSetup } from "$lib/college/model";
import { newCollegeSetup } from "$lib/college/presets";
import { researchFingerprint } from "$lib/college/researchModel";
import {
    archiveCollegePrompts,
    formatCollegePromptHeading,
    resolveCollegeSections,
    resolveCollegeSetup,
} from "$lib/college/sections";
import { describe, expect, it } from "vitest";

function setup() {
    const value = newCollegeSetup("supplemental");
    value.prompts[0] = {
        id: "prompt-1",
        label: "Meaningful experience",
        text: "Describe a meaningful experience.",
        sourceUrl: "https://example.edu/prompt",
        constraints: [{ id: "length", unit: "words", min: null, max: 650, detail: "" }],
    };
    return value;
}

describe("College prompt sections", () => {
    it("keeps long Unicode headings within persisted string limits", () => {
        const resolved = resolveCollegeSetup(setup(), `# ${"😀".repeat(2100)}\n\nAnswer`);
        expect(() => parseCollegeSetup(resolved)).not.toThrow();
        expect(resolved.prompts[0].label.length).toBeLessThanOrEqual(200);
        expect(resolved.prompts[0].text.length).toBeLessThanOrEqual(4000);
        expect(resolved.prompts[0].text.endsWith("😀")).toBe(true);
    });
    it("resolves top-level H1 answers and keeps H2 content in the answer", () => {
        const value = setup();
        value.sectionMode = true;
        const prose =
            "#   Describe a meaningful   experience. (69 words)\nOne two three.\n## Context\nMore detail.\n# A second prompt\nLast answer.";

        const sections = resolveCollegeSections(value, prose);

        expect(sections).toHaveLength(2);
        expect(sections[0]?.prompt.id).toBe("prompt-1");
        expect(sections[0]?.prompt.constraints[0]?.max).toBe(69);
        expect(prose.slice(sections[0]?.from, sections[0]?.to)).toContain("## Context");
        expect(sections[0]?.wordCount).toBe(7);
        expect(sections[0]?.characterCount).toBe(
            Array.from("One two three.\n## Context\nMore detail.").length,
        );
        expect(sections[1]?.from).toBe(prose.indexOf("Last answer."));
        expect(sections[1]?.to).toBe(prose.length);
    });

    it("only treats direct document H1s as section headings", () => {
        const value = setup();
        value.sectionMode = true;
        const prose = "> # Block quote\n- # List\n```markdown\n# Fenced\n```\n# Real\nanswer";

        const sections = resolveCollegeSections(value, prose);

        expect(sections).toHaveLength(1);
        expect(sections[0]?.prompt.text).toBe("Real");
        expect(sections[0]?.wordCount).toBe(1);
    });

    it("resolves every top-level H1, including the final section beyond twelve", () => {
        const value = setup();
        value.sectionMode = true;
        const prose = Array.from(
            { length: 13 },
            (_, index) => `# Prompt ${index + 1}\nAnswer ${index + 1}`,
        ).join("\n");

        const sections = resolveCollegeSections(value, prose);

        expect(sections).toHaveLength(13);
        expect(sections.at(-1)?.prompt.text).toBe("Prompt 13");
        expect(sections.at(-1)?.to).toBe(prose.length);
        expect(sections.at(-1)?.wordCount).toBe(2);
    });

    it("gives duplicate headings fresh deterministic prompt IDs", () => {
        const value = setup();
        value.sectionMode = true;
        const prose =
            "# Describe a meaningful experience.\nFirst\n# Describe a meaningful experience.\nSecond";

        const first = resolveCollegeSections(value, prose);
        const second = resolveCollegeSections(value, prose);

        expect(first.map((section) => section.prompt.id)).toEqual(
            second.map((section) => section.prompt.id),
        );
        expect(new Set(first.map((section) => section.prompt.id)).size).toBe(2);
        expect(first.every((section) => section.prompt.id !== "prompt-1")).toBe(true);
    });

    it("clears saved numeric limits when an H1 has no limit", () => {
        const value = setup();
        value.sectionMode = true;

        const [section] = resolveCollegeSections(
            value,
            "# Describe a meaningful experience.\nAnswer",
        );

        expect(section?.prompt.constraints[0]?.max).toBeNull();
        expect(section?.prompt.constraints[0]?.id).toBe("length");
    });

    it("uses legacy full-tab prompts only when section mode is off", () => {
        const value = setup();
        const legacy = resolveCollegeSections(value, "A complete legacy answer.");
        expect(legacy).toHaveLength(1);
        expect(legacy[0]?.from).toBe(0);
        expect(legacy[0]?.to).toBe("A complete legacy answer.".length);

        value.sectionMode = true;
        expect(resolveCollegeSections(value, "A complete legacy answer.")).toEqual([]);
    });

    it("formats one-line headings with a prompt fallback and a numeric limit", () => {
        const value = setup().prompts[0];
        value.text = "  ";
        value.label = "  School supplement\n";

        expect(formatCollegePromptHeading(value)).toBe("# School supplement (650 words)");
        expect(formatCollegePromptHeading({ ...value, text: "Write this (12 words)" })).toBe(
            "# Write this (650 words)",
        );
        expect(
            formatCollegePromptHeading({
                ...value,
                text: "Write this (12 words)",
                constraints: [],
            }),
        ).toBe("# Write this (12 words)");
    });

    it("counts Unicode code points in trimmed answers", () => {
        const value = setup();
        value.sectionMode = true;
        const [section] = resolveCollegeSections(value, "# Prompt\n  café 😀  ");

        expect(section?.wordCount).toBe(2);
        expect(section?.characterCount).toBe(Array.from("café 😀").length);
    });

    it("archives detached prompts without removing caller-owned references", () => {
        const value = setup();
        const detached = { ...value.prompts[0], id: "prompt-2", text: "Second" };
        value.prompts.push(detached);
        value.promptArchive = [{ ...detached, id: "old-archive", text: "Old archive" }];
        const references = [
            {
                id: "reference",
                publisher: "Example",
                url: "https://example.edu/reference",
                checkedDate: "2026-09-07",
                cycle: "2026",
                kind: "official-advice" as const,
                summary: "Keep this reference",
            },
        ];
        const resolved = { ...value, prompts: [value.prompts[0]], references };

        const archived = archiveCollegePrompts(value, resolved);
        expect(archived.prompts.map((prompt) => prompt.id)).toEqual(["prompt-1"]);
        expect(archived.promptArchive?.map((prompt) => prompt.id)).toEqual([
            "old-archive",
            "prompt-2",
        ]);
        expect(archived.references).toEqual(references);
        expect(parseCollegeSetup(archived).promptArchive).toHaveLength(2);
    });

    it("resolves the effective setup without parsing an empty section-mode prompt list", () => {
        const value = setup();
        value.sectionMode = true;
        const resolved = resolveCollegeSetup(value, "no H1 here");

        expect(resolved.prompts).toEqual([]);
        expect(resolved.references).toEqual(value.references);
        expect(parseCollegeSetup(archiveCollegePrompts(value, resolved)).prompts).toEqual([]);
    });

    it("uses the full normalized heading text for new prompt IDs", () => {
        const value = setup();
        value.sectionMode = true;
        const [section] = resolveCollegeSections(value, "# New   prompt\nAnswer");

        expect(section?.prompt.id).toBe(researchFingerprint("New prompt"));
    });

    it("keeps prompt identity through moves and restores deleted headings from the archive", () => {
        const value = setup();
        const second = { ...value.prompts[0], id: "prompt-2", text: "A second prompt" };
        value.prompts.push(second);
        value.sectionMode = true;
        const originalText =
            "# Describe a meaningful experience.\nFirst\n# A second prompt\nSecond";
        expect(
            resolveCollegeSections(value, originalText).map((section) => section.prompt.id),
        ).toEqual(["prompt-1", "prompt-2"]);

        const movedText = "# A second prompt\nSecond\n# Describe a meaningful experience.\nFirst";
        expect(
            resolveCollegeSections(value, movedText).map((section) => section.prompt.id),
        ).toEqual(["prompt-2", "prompt-1"]);

        const remaining = resolveCollegeSections(
            value,
            "# Describe a meaningful experience.\nFirst",
        );
        const archived = archiveCollegePrompts(value, {
            ...value,
            prompts: remaining.map((section) => section.prompt),
        });
        expect(archived.promptArchive?.map((prompt) => prompt.id)).toContain("prompt-2");
        expect(resolveCollegeSections(archived, "# A second prompt\nRestored")[0]?.prompt.id).toBe(
            "prompt-2",
        );
    });

    it("does not reuse the old prompt identity when heading wording changes", () => {
        const value = setup();
        value.sectionMode = true;
        const [section] = resolveCollegeSections(value, "# Different wording\nAnswer");

        expect(section?.prompt.id).not.toBe("prompt-1");
        expect(section?.prompt.id).toBe(researchFingerprint("Different wording"));
    });
});
