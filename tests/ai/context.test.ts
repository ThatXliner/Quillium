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
});
