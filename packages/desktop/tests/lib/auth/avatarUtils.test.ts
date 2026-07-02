import { avatarColor, initials } from "$lib/auth/avatarUtils";
import { describe, expect, it } from "vitest";

describe("avatar utilities", () => {
    it("builds up to two initials from display names", () => {
        expect(initials("Ada Lovelace")).toBe("AL");
        expect(initials("prince")).toBe("P");
        expect(initials("Mary Jane Watson Parker")).toBe("MJ");
    });

    it("normalizes whitespace before deriving initials", () => {
        expect(initials("  Ada   Lovelace  ")).toBe("AL");
        expect(initials("Grace\tHopper")).toBe("GH");
    });

    it("uses the fallback initial for missing or blank names", () => {
        expect(initials("")).toBe("?");
        expect(initials(" \t\n ")).toBe("?");
    });

    it("returns deterministic colors from the curated palette", () => {
        const color = avatarColor("Ada Lovelace");

        expect(color).toMatch(/^#[0-9A-F]{6}$/);
        expect(avatarColor("Ada Lovelace")).toBe(color);
    });

    it("normalizes whitespace before hashing colors", () => {
        expect(avatarColor("  Ada   Lovelace  ")).toBe(avatarColor("Ada Lovelace"));
    });

    it("uses the fallback color for missing or blank names", () => {
        expect(avatarColor("")).toBe("#3B82F6");
        expect(avatarColor(" \t\n ")).toBe("#3B82F6");
    });
});
