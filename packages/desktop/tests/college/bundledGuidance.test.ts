import { bundledReferencesFor, previewBundledGuidance } from "$lib/college/bundledGuidance";
import { cloneCollegeSetup } from "$lib/college/model";
import { UC_PROMPTS, newCollegeSetup } from "$lib/college/presets";
import { isCollegeReferenceCurrent } from "$lib/college/researchModel";
import { describe, expect, it } from "vitest";

describe("bundled College guidance", () => {
    it("matches every official prompt by wording and scopes sources to its actual ID", () => {
        for (const [index, prompt] of UC_PROMPTS.entries()) {
            const setup = newCollegeSetup("uc-piq");
            setup.prompts[0] = { ...setup.prompts[0], id: `chosen-${index}`, ...prompt };
            const references = bundledReferencesFor(setup);
            expect(references.length).toBeGreaterThan(0);
            expect(
                references.every(
                    (reference) => reference.bundle?.promptIds[0] === `chosen-${index}`,
                ),
            ).toBe(true);
            expect(
                references.every((reference) => isCollegeReferenceCurrent(reference, setup)),
            ).toBe(true);
        }
    });

    it("detaches changed or absent prompts and reconnects their accepted snapshots", () => {
        const setup = newCollegeSetup("uc-piq");
        setup.references = bundledReferencesFor(setup);
        const restored = cloneCollegeSetup(setup);
        setup.prompts[0].text = "A custom question";
        expect(bundledReferencesFor(setup)).toEqual([]);
        expect(
            setup.references.every((reference) => !isCollegeReferenceCurrent(reference, setup)),
        ).toBe(true);
        setup.prompts = [];
        expect(
            setup.references.every((reference) => !isCollegeReferenceCurrent(reference, setup)),
        ).toBe(true);
        expect(
            restored.references.every((reference) =>
                isCollegeReferenceCurrent(reference, restored),
            ),
        ).toBe(true);
    });

    it("previews updates without mutation and preserves custom and detached snapshots", () => {
        const setup = newCollegeSetup("uc-piq");
        setup.references = bundledReferencesFor(setup);
        setup.references[0].summary = "Previously accepted guidance";
        const detached = structuredClone(setup.references[0]);
        detached.id = "detached";
        detached.bundle!.promptIds = ["absent-prompt"];
        const custom = { ...setup.references[0], id: "custom", bundle: undefined };
        setup.references.push(detached, custom);
        const before = JSON.stringify(setup);
        const preview = previewBundledGuidance(setup);
        expect(preview.changed).toHaveLength(1);
        expect(preview.references).toContainEqual(detached);
        expect(preview.references).toContainEqual(JSON.parse(JSON.stringify(custom)));
        expect(JSON.stringify(setup)).toBe(before);
        expect(cloneCollegeSetup(setup).references[0].summary).toBe("Previously accepted guidance");
    });

    it("does not bundle supplemental questions", () => {
        expect(bundledReferencesFor(newCollegeSetup("supplemental"))).toEqual([]);
    });
});
