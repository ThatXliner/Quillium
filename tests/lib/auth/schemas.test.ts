import { displayNameSchema, loginSchema, signUpSchema } from "$lib/auth/schemas";
import { describe, expect, it } from "vitest";

describe("auth schemas", () => {
    it("accepts valid login input", () => {
        expect(
            loginSchema.safeParse({ email: "writer@example.com", password: "secret" }).success,
        ).toBe(true);
    });

    it("rejects malformed login input", () => {
        expect(loginSchema.safeParse({ email: "not-email", password: "secret" }).success).toBe(
            false,
        );
        expect(loginSchema.safeParse({ email: "writer@example.com", password: "" }).success).toBe(
            false,
        );
    });

    it("enforces signup password and display-name limits", () => {
        expect(
            signUpSchema.safeParse({
                email: "writer@example.com",
                password: "long-enough",
                displayName: "Ada",
            }).success,
        ).toBe(true);
        expect(
            signUpSchema.safeParse({
                email: "writer@example.com",
                password: "short",
                displayName: "Ada",
            }).success,
        ).toBe(false);
        expect(
            signUpSchema.safeParse({
                email: "writer@example.com",
                password: "long-enough",
                displayName: "x".repeat(51),
            }).success,
        ).toBe(false);
    });

    it("trims accepted display names", () => {
        expect(displayNameSchema.parse({ displayName: "  Ada Lovelace  " })).toEqual({
            displayName: "Ada Lovelace",
        });
    });

    it("allows expected display-name punctuation and rejects unexpected symbols", () => {
        expect(displayNameSchema.safeParse({ displayName: "Mary-Jane O'Neil" }).success).toBe(true);
        expect(displayNameSchema.safeParse({ displayName: "A" }).success).toBe(false);
        expect(displayNameSchema.safeParse({ displayName: "Ada!" }).success).toBe(false);
    });
});
