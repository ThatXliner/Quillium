import {
    buildAiContextPacket,
    contextPacketToPrompt,
    contextScopeDetail,
    contextScopeLabel,
    getContextAwareActions,
} from "$lib/ai/context";
import { describe, expect, it } from "vitest";

describe("buildAiContextPacket", () => {
    it("uses selection focus without duplicating nearby context when the full draft fits", () => {
        const documentContent = [
            "Opening paragraph sets the frame.",
            "The selected passage carries the turn in the argument.",
            "Closing paragraph resolves the thought.",
        ].join("\n\n");
        const from = documentContent.indexOf("selected passage");
        const to = from + "selected passage".length;

        const packet = buildAiContextPacket({
            mode: "feedback",
            documentContent,
            selectedText: "selected passage",
            selectedTextRange: { from, to },
        });
        const prompt = contextPacketToPrompt(packet);
        const surroundingSource = packet.sources.find((source) => source.id === "surrounding");

        expect(packet.scope).toBe("selection");
        expect(packet.selectedText).toBe("selected passage");
        expect(packet.surroundingText).toContain("selected passage");
        expect(packet.surroundingTextAddsContext).toBe(false);
        expect(surroundingSource?.label).toBe("Selection Focus");
        expect(surroundingSource?.detail).toBe("Draft already includes nearby text");
        expect(packet.sources.find((source) => source.id === "selection")?.active).toBe(true);
        expect(prompt).not.toContain('"source": "nearby-passage"');
        expect(prompt).not.toContain('"source": "nearby-paragraphs"');
        expect(contextScopeDetail(packet)).toBe(
            "The current draft and selected text will be sent.",
        );
    });

    it("uses editor offsets and paragraph boundaries for clipped selection context", () => {
        const repeated = "shared phrase";
        const documentContent = [
            `Opening paragraph has the wrong ${repeated}.`,
            "The paragraph before gives the reader a setup.",
            `The selected paragraph contains the real ${repeated} for the turn.`,
            "The paragraph after follows through on the choice.",
            `A long tail forces clipping. ${"x".repeat(12000)}`,
        ].join("\n\n");
        const from = documentContent.indexOf(
            repeated,
            documentContent.indexOf("selected paragraph"),
        );
        const to = from + repeated.length;

        const packet = buildAiContextPacket({
            mode: "feedback",
            documentContent,
            selectedText: repeated,
            selectedTextRange: { from, to },
        });
        const prompt = contextPacketToPrompt(packet);
        const surroundingSource = packet.sources.find((source) => source.id === "surrounding");

        expect(packet.omittedDocumentChars).toBeGreaterThan(0);
        expect(packet.selectedTextRange).toEqual({ from, to });
        expect(packet.surroundingTextKind).toBe("paragraphs");
        expect(packet.surroundingTextAddsContext).toBe(true);
        expect(packet.surroundingText).toContain("The paragraph before");
        expect(packet.surroundingText).toContain("The selected paragraph");
        expect(packet.surroundingText).toContain("The paragraph after");
        expect(packet.surroundingText).not.toContain("wrong shared phrase");
        expect(surroundingSource?.label).toBe("Nearby Paragraphs");
        expect(prompt).toContain('"source": "nearby-paragraphs"');
    });

    it("falls back to a bounded character window for huge paragraphs", () => {
        const selectedText = "selected point";
        const hugeParagraph = `This paragraph is intentionally large. ${"x".repeat(
            5000,
        )} ${selectedText} ${"y".repeat(5000)}`;
        const documentContent = ["Short setup.", hugeParagraph, "Short follow-through."].join(
            "\n\n",
        );
        const from = documentContent.indexOf(selectedText);
        const to = from + selectedText.length;

        const packet = buildAiContextPacket({
            mode: "feedback",
            documentContent,
            selectedText,
            selectedTextRange: { from, to },
        });

        expect(packet.surroundingTextKind).toBe("window");
        expect(packet.surroundingText).toContain(selectedText);
        expect(packet.surroundingText.length).toBeLessThan(documentContent.length);
    });

    it("clips long documents with an explicit omission marker", () => {
        const documentContent = `start ${"x".repeat(30000)} end`;

        const packet = buildAiContextPacket({
            mode: "chat",
            documentContent,
        });
        const prompt = contextPacketToPrompt(packet);

        expect(packet.scope).toBe("document");
        expect(packet.omittedDocumentChars).toBeGreaterThan(0);
        expect(prompt).toContain("characters omitted");
        expect(prompt).toContain("start");
        expect(prompt).toContain("end");
    });

    it("keeps writer context as an inspectable source", () => {
        const packet = buildAiContextPacket({
            mode: "chat",
            documentContent: "Draft",
            documentContext: { freeform: "Audience: skeptical editors" },
        });

        const writerSource = packet.sources.find((source) => source.id === "writer-context");
        expect(writerSource?.active).toBe(true);
        expect(writerSource?.chars).toBeGreaterThan(0);
        expect(contextPacketToPrompt(packet)).toContain('"source": "writer-brief"');
    });

    it("labels full-document context as visible draft state", () => {
        const packet = buildAiContextPacket({
            mode: "chat",
            documentContent: "Draft",
        });

        expect(contextScopeLabel(packet)).toBe("AI can see this draft");
    });

    it("includes open annotations as budgeted context", () => {
        const packet = buildAiContextPacket({
            mode: "feedback",
            documentContent: "The second paragraph repeats the claim.",
            annotationContext: [
                {
                    id: 7,
                    type: "comment",
                    targetText: "second paragraph",
                    messages: [{ author: "Bryan", message: "This may repeat the intro." }],
                    active: true,
                },
            ],
        });
        const prompt = contextPacketToPrompt(packet);

        expect(packet.includedAnnotationCount).toBe(1);
        expect(packet.sources.find((source) => source.id === "annotations")?.active).toBe(true);
        expect(prompt).toContain('"source": "existing-annotations"');
        expect(prompt).toContain('"status": "already-open-editorial-state"');
        expect(prompt).toContain('"type": "comment"');
        expect(prompt).toContain('"active": true');
        expect(prompt).toContain('"author": "Bryan"');
        expect(prompt).toContain("This may repeat the intro.");
    });

    it("caps annotation context by relevance budget", () => {
        const packet = buildAiContextPacket({
            mode: "chat",
            documentContent: "Draft",
            annotationContext: Array.from({ length: 8 }, (_, index) => ({
                id: index,
                type: "comment" as const,
                targetText: `target ${index}`,
                messages: [{ author: "Editor", message: `note ${index}` }],
            })),
        });

        expect(packet.includedAnnotationCount).toBe(6);
        expect(packet.omittedAnnotationCount).toBe(2);
        expect(packet.sources.find((source) => source.id === "annotations")?.detail).toBe(
            "6 of 8 included",
        );
    });
});

describe("getContextAwareActions", () => {
    it("returns selection-specific revise actions when text is selected", () => {
        const packet = buildAiContextPacket({
            mode: "revise",
            documentContent: "This sentence is a little too long.",
            selectedText: "a little too long",
        });

        const actions = getContextAwareActions("revise", packet);
        expect(actions.map((action) => action.id)).toContain("revise-tighten");
        expect(actions[0].prompt).toContain("selected text");
    });

    it("uses writer-context-aware feedback actions for a full draft", () => {
        const packet = buildAiContextPacket({
            mode: "feedback",
            documentContent: "A full draft.",
            documentContext: { freeform: "Goal: persuade a skeptical reader" },
        });

        const actions = getContextAwareActions("feedback", packet);
        expect(actions.find((action) => action.id === "feedback-brief")?.label).toBe(
            "Against the brief",
        );
    });

    it("offers annotation-aware actions when notes are open", () => {
        const packet = buildAiContextPacket({
            mode: "chat",
            documentContent: "A full draft.",
            annotationContext: [
                {
                    id: 1,
                    type: "comment",
                    targetText: "A full draft.",
                    messages: [{ message: "Clarify the main claim." }],
                },
            ],
        });

        const actions = getContextAwareActions("chat", packet);
        expect(actions[0].id).toBe("chat-annotations");
    });
});
