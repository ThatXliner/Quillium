import { describe, expect, it } from "vitest";
import {
    buildAiContextPacket,
    contextPacketToPrompt,
    getContextAwareActions,
} from "$lib/ai/context";

describe("buildAiContextPacket", () => {
    it("prioritizes selected text and nearby context", () => {
        const documentContent = [
            "Opening paragraph sets the frame.",
            "The selected passage carries the turn in the argument.",
            "Closing paragraph resolves the thought.",
        ].join("\n\n");

        const packet = buildAiContextPacket({
            mode: "feedback",
            documentContent,
            selectedText: "selected passage",
        });

        expect(packet.scope).toBe("selection");
        expect(packet.selectedText).toBe("selected passage");
        expect(packet.surroundingText).toContain("selected passage");
        expect(packet.sources.find((source) => source.id === "selection")?.active).toBe(true);
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
        expect(prompt).toContain("Existing annotations");
        expect(prompt).toContain("avoid duplicating");
        expect(prompt).toContain("[comment #7, active]");
        expect(prompt).toContain("Bryan: This may repeat the intro.");
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
