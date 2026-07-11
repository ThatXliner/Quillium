import { describe, expect, it } from "vitest";
import { avatarColor, initials } from "../src/cards/avatar";

describe("shared annotation avatars", () => {
    it("normalizes names before deriving initials", () => {
        expect(initials("  Ur   mother ")).toBe("UM");
        expect(initials("Editor")).toBe("E");
        expect(initials("   ")).toBe("?");
    });

    it("assigns the same deterministic color for equivalent display names", () => {
        expect(avatarColor("Ur mother")).toBe(avatarColor("  Ur   mother "));
        expect(avatarColor("Editor")).toMatch(/^#[0-9A-F]{6}$/);
    });
});
