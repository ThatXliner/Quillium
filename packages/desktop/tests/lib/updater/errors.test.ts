import { isGithubRateLimitUpdateError } from "$lib/updater/errors";
import { describe, expect, it } from "vitest";

describe("isGithubRateLimitUpdateError", () => {
    it("matches GitHub update endpoint 403 failures", () => {
        expect(
            isGithubRateLimitUpdateError(
                "failed to fetch https://github.com/ThatXliner/quillium-releases/releases/latest/download/latest.json: 403 Forbidden",
            ),
        ).toBe(true);
    });

    it("matches explicit rate limit messages", () => {
        expect(isGithubRateLimitUpdateError(new Error("API rate limit exceeded"))).toBe(true);
        expect(isGithubRateLimitUpdateError({ message: "Too Many Requests", status: 429 })).toBe(
            true,
        );
    });

    it("does not match unrelated update check failures", () => {
        expect(isGithubRateLimitUpdateError("DNS lookup failed for github.com")).toBe(false);
        expect(isGithubRateLimitUpdateError(new Error("signature verification failed"))).toBe(
            false,
        );
    });
});
