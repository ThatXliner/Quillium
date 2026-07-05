import { buildDocumentContextPrompt, injectDocumentContext } from "$lib/ai/utils";
import { describe, expect, it } from "vitest";

// ── buildDocumentContextPrompt ────────────────────────────────────────────────

describe("buildDocumentContextPrompt", () => {
    it("returns empty string for undefined context", () => {
        expect(buildDocumentContextPrompt(undefined)).toBe("");
    });

    it("returns empty string for an empty context object", () => {
        expect(buildDocumentContextPrompt({})).toBe("");
    });

    it("returns empty string when freeform is whitespace-only", () => {
        expect(buildDocumentContextPrompt({ freeform: "   " })).toBe("");
    });

    it("includes the freeform text when set", () => {
        const result = buildDocumentContextPrompt({
            freeform: "Goal: Write a thriller. Audience: adults.",
        });
        expect(result).toContain("Goal: Write a thriller. Audience: adults.");
    });

    it("trims whitespace from the freeform value", () => {
        const result = buildDocumentContextPrompt({ freeform: "  Be concise  " });
        expect(result).toContain("Be concise");
    });

    it("starts with a newline prefix when non-empty", () => {
        const result = buildDocumentContextPrompt({ freeform: "Some context" });
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

    it("includes annotation context when provided", () => {
        const msg = injectDocumentContext({
            documentContent: "Draft",
            annotationContext: [
                {
                    id: 3,
                    type: "suggestion",
                    targetText: "Draft",
                    replacements: [{ text: "Opening draft", rationale: "More specific" }],
                },
            ],
        });

        expect(msg.content).toContain("Existing annotations");
        expect(msg.content).toContain("[suggestion #3]");
        expect(msg.content).toContain("Opening draft");
    });
});
