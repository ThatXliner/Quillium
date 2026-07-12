import { describe, expect, it } from "vitest";
import { avatarColor, initials } from "../src/cards/avatar";

describe("shared annotation avatars", () => {
    it("builds up to two initials from normalized display names", () => {
        expect(initials("  Ada   Lovelace  ")).toBe("AL");
        expect(initials("Grace\tHopper")).toBe("GH");
        expect(initials("prince")).toBe("P");
        expect(initials("Mary Jane Watson Parker")).toBe("MJ");
        expect(initials("   ")).toBe("?");
    });

    it("assigns the same deterministic color for equivalent display names", () => {
        expect(avatarColor("Ada Lovelace")).toBe(avatarColor("  Ada   Lovelace "));
        expect(avatarColor("Editor")).toMatch(/^#[0-9A-F]{6}$/);
        expect(avatarColor("   ")).toBe("#3B82F6");
    });
});
