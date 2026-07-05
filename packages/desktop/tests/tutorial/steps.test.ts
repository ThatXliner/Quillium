import { type Step, steps } from "$lib/tutorial/steps";
import { describe, expect, it } from "vitest";

// ── steps array ──────────────────────────────────────────────────────────────

describe("steps", () => {
    it("is a non-empty array", () => {
        expect(Array.isArray(steps)).toBe(true);
        expect(steps.length).toBeGreaterThan(0);
    });

    it("every step has a non-empty title string", () => {
        for (const step of steps) {
            expect(typeof step.title).toBe("string");
            expect(step.title.length).toBeGreaterThan(0);
        }
    });

    it("every step has a non-empty body string", () => {
        for (const step of steps) {
            expect(typeof step.body).toBe("string");
            expect(step.body.length).toBeGreaterThan(0);
        }
    });

    it("every step position is a valid direction", () => {
        const valid = ["right", "left", "top", "bottom", "center"];
        for (const step of steps) {
            expect(valid).toContain(step.position);
        }
    });

    it("every step selector is either null or a non-empty string", () => {
        for (const step of steps) {
            if (step.selector !== null) {
                expect(typeof step.selector).toBe("string");
                expect(step.selector.length).toBeGreaterThan(0);
            }
        }
    });

    it("first step has selector null (welcome screen)", () => {
        expect(steps[0].selector).toBeNull();
    });

    it("last step has selector null (completion screen)", () => {
        expect(steps[steps.length - 1].selector).toBeNull();
    });

    it("steps with non-null selectors are valid CSS selectors", () => {
        for (const step of steps) {
            if (step.selector !== null) {
                expect(() => document.querySelector(step.selector!)).not.toThrow();
            }
        }
    });

    it("has no duplicate titles", () => {
        const titles = steps.map((s) => s.title);
        expect(new Set(titles).size).toBe(titles.length);
    });

    it("every step has all required fields defined", () => {
        const requiredKeys: Array<keyof Step> = ["selector", "title", "body", "position"];
        for (const step of steps) {
            for (const key of requiredKeys) {
                expect(step).toHaveProperty(key);
                expect(step[key]).toBeDefined();
            }
        }
    });
});
