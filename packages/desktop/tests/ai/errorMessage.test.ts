import { aiErrorMessage } from "$lib/ai/errorMessage";
import { describe, expect, it } from "vitest";

describe("aiErrorMessage", () => {
    it.each([
        ["token expired", new Error("access token expired")],
        ["session expired", new Error("The session expired")],
        ["invalid grant", new Error("invalid_grant")],
        ["refresh token reused", new Error("refresh_token_reused")],
        ["refresh token expired", new Error("refresh_token_expired")],
        ["missing OAuth session", new Error("OpenAI OAuth session not found.")],
        [
            "OAuth HTTP 400",
            new Error("OpenAI OAuth token request failed with HTTP 400. invalid_grant"),
        ],
        ["OAuth HTTP 401", new Error("OpenAI OAuth token request failed with HTTP 401.")],
    ])("recognizes %s through the OAuth provider", (_name, error) => {
        expect(aiErrorMessage(error, "openai-oauth")).toBe(
            "Your ChatGPT connection has expired or is no longer valid. Open AI Settings and sign in to ChatGPT again.",
        );
    });

    it("recognizes OAuth failures through a bounded cause chain", () => {
        const root = Object.assign(new Error("request failed"), { statusCode: 401 });
        let current: Error = root;
        for (let index = 0; index < 5; index += 1) {
            const cause = new Error(`wrapper ${index}`);
            current = Object.assign(cause, { cause: current });
        }

        expect(aiErrorMessage(current, "openai-oauth")).toBe(
            "Your ChatGPT connection has expired or is no longer valid. Open AI Settings and sign in to ChatGPT again.",
        );
    });

    it("handles cyclic causes without mutating the original error", () => {
        const error = new Error("invalid_grant");
        Object.assign(error, { cause: error });

        expect(aiErrorMessage(error, "openai-oauth")).toContain("ChatGPT connection");
        expect(error.cause).toBe(error);
    });

    it("uses an API-key message for a non-OAuth 401", () => {
        const error = Object.assign(new Error("unauthorized"), { statusCode: 401 });

        expect(aiErrorMessage(error, "openai")).toBe(
            "Your AI provider rejected the API key. Open AI Settings and check your key.",
        );
    });

    it("does not misclassify a non-authentication server error", () => {
        const error = Object.assign(new Error("invalid_grant while processing a request"), {
            statusCode: 500,
        });

        expect(aiErrorMessage(error, "openai")).toBe(
            "The AI provider is temporarily unavailable. Try again in a moment.",
        );
    });

    it.each([
        [403, "The AI provider denied this request. Check your account permissions."],
        [429, "The AI provider is rate limiting requests. Wait a moment and try again."],
        [500, "The AI provider is temporarily unavailable. Try again in a moment."],
    ])("classifies HTTP %s without echoing provider details", (statusCode, expected) => {
        const error = Object.assign(new Error("provider secret response"), { statusCode });

        expect(aiErrorMessage(error, "anthropic")).toBe(expected);
        expect(aiErrorMessage(error, "anthropic")).not.toContain("provider secret response");
    });

    it("recognizes network TypeErrors", () => {
        expect(aiErrorMessage(new TypeError("Failed to fetch"), "google")).toBe(
            "Could not connect to the AI provider. Check your connection and try again.",
        );
    });

    it("keeps unknown errors generic and never echoes secrets", () => {
        const error = new Error("request failed with api_key=secret-value");

        expect(aiErrorMessage(error, "deepseek")).toBe(
            "The AI request failed. Try again. If it keeps failing, open Help → App Logs for details.",
        );
    });

    it("returns existing safe messages unchanged", () => {
        const known =
            "The AI request failed. Try again. If it keeps failing, open Help → App Logs for details.";

        expect(aiErrorMessage(known, "openai")).toBe(known);
    });
});
