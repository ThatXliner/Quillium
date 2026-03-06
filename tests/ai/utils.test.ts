import { describe, it, expect } from "vitest";
import {
    buildDocumentContextPrompt,
    injectDocumentContext,
} from "$lib/ai/utils";

// ── buildDocumentContextPrompt ────────────────────────────────────────────────

describe("buildDocumentContextPrompt", () => {
    it("returns empty string for undefined context", () => {
        expect(buildDocumentContextPrompt(undefined)).toBe("");
    });

    it("returns empty string for an empty context object", () => {
        expect(buildDocumentContextPrompt({})).toBe("");
    });

    it("returns empty string when all fields are whitespace-only", () => {
        expect(buildDocumentContextPrompt({
            goal: "   ",
            tone: "\t",
            audience: "",
        })).toBe("");
    });

    it("includes only the fields that are set", () => {
        const result = buildDocumentContextPrompt({ goal: "Write a thriller", tone: "Tense" });
        expect(result).toContain("Goal: Write a thriller");
        expect(result).toContain("Tone: Tense");
        expect(result).not.toContain("Audience");
        expect(result).not.toContain("Emphasize");
    });

    it("trims whitespace from field values", () => {
        const result = buildDocumentContextPrompt({ goal: "  Be concise  " });
        expect(result).toContain("Goal: Be concise");
    });

    it("includes all six fields when all are provided", () => {
        const result = buildDocumentContextPrompt({
            goal: "G",
            tone: "T",
            audience: "A",
            emphasize: "E",
            avoid: "V",
            notes: "N",
        });
        expect(result).toContain("Goal: G");
        expect(result).toContain("Tone: T");
        expect(result).toContain("Audience: A");
        expect(result).toContain("Emphasize: E");
        expect(result).toContain("Avoid: V");
        expect(result).toContain("Notes: N");
    });

    it("starts with a newline prefix when non-empty", () => {
        const result = buildDocumentContextPrompt({ goal: "Write" });
        expect(result.startsWith("\n\nDocument context provided by the writer:")).toBe(true);
    });
});

// ── injectDocumentContext ─────────────────────────────────────────────────────

describe("injectDocumentContext", () => {
    it("produces a user-role message", () => {
        const msg = injectDocumentContext({ documentContent: "Hello world" });
        expect(msg.role).toBe("user");
    });

    it("wraps documentContent in a fenced code block", () => {
        const msg = injectDocumentContext({ documentContent: "Some text" });
        expect(msg.content).toContain("```\nSome text\n```");
    });

    it("includes selectedText section when provided", () => {
        const msg = injectDocumentContext({
            documentContent: "Full doc",
            selectedText: "A sentence.",
        });
        expect(msg.content).toContain("Currently selected text:");
        expect(msg.content).toContain("```\nA sentence.\n```");
    });

    it("omits selectedText section when not provided", () => {
        const msg = injectDocumentContext({ documentContent: "Full doc" });
        expect(msg.content).not.toContain("Currently selected text:");
    });

    it("produces an empty content string when neither field is provided", () => {
        const msg = injectDocumentContext({});
        expect(msg.content).toBe("");
    });

    it("includes only selectedText when documentContent is absent", () => {
        const msg = injectDocumentContext({ selectedText: "Picked text" });
        expect(msg.content).toContain("Currently selected text:");
        expect(msg.content).not.toContain("Current document:");
    });
});
