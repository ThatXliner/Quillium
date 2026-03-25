/**
 * Unit tests for forkState.ts — pure fork-mode state computation.
 */
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { computeForkStateJson, type ForkMode } from "./forkState";

// Minimal savedFields — empty means toJSON/fromJSON just round-trip the doc.
const savedFields = {};
const extensions: never[] = [];

function stateWithText(text: string) {
    return EditorState.create({ doc: text, extensions });
}

describe("computeForkStateJson", () => {
    it("returns null for blank mode", () => {
        const state = stateWithText("hello world");
        expect(computeForkStateJson(state, savedFields, extensions, "blank")).toBeNull();
    });

    it("duplicate: serialises the full state", () => {
        const state = stateWithText("hello world");
        const json = computeForkStateJson(state, savedFields, extensions, "duplicate");
        expect(json).not.toBeNull();
        const parsed = JSON.parse(json!);
        // The serialised doc text should be present
        expect(JSON.stringify(parsed)).toContain("hello world");
    });

    it("duplicate: round-trips through EditorState.fromJSON", () => {
        const state = stateWithText("round trip test");
        const json = computeForkStateJson(state, savedFields, extensions, "duplicate");
        const restored = EditorState.fromJSON(JSON.parse(json!), { extensions }, savedFields);
        expect(restored.doc.toString()).toBe("round trip test");
    });

    it("duplicate_without_annotations: preserves text", () => {
        const state = stateWithText("my draft text");
        const json = computeForkStateJson(state, savedFields, extensions, "duplicate_without_annotations");
        expect(json).not.toBeNull();
        const restored = EditorState.fromJSON(JSON.parse(json!), { extensions }, savedFields);
        expect(restored.doc.toString()).toBe("my draft text");
    });

    it("duplicate_without_annotations: produces valid JSON", () => {
        const state = stateWithText("some content");
        const json = computeForkStateJson(state, savedFields, extensions, "duplicate_without_annotations");
        expect(() => JSON.parse(json!)).not.toThrow();
    });

    it("blank: ignores document content", () => {
        const state = stateWithText("ignore this");
        expect(computeForkStateJson(state, savedFields, extensions, "blank")).toBeNull();
    });

    it("handles empty document", () => {
        const state = stateWithText("");
        const json = computeForkStateJson(state, savedFields, extensions, "duplicate");
        expect(json).not.toBeNull();
        const restored = EditorState.fromJSON(JSON.parse(json!), { extensions }, savedFields);
        expect(restored.doc.toString()).toBe("");
    });

    it("handles large document without throwing", () => {
        const text = "word ".repeat(10_000);
        const state = stateWithText(text);
        const json = computeForkStateJson(state, savedFields, extensions, "duplicate");
        expect(json).not.toBeNull();
        expect(JSON.parse(json!)).toBeTruthy();
    });
});

describe("computeForkStateJson — all modes return correct types", () => {
    const modes: ForkMode[] = ["duplicate", "duplicate_without_annotations", "blank"];
    const state = stateWithText("test");

    for (const mode of modes) {
        it(`mode "${mode}" returns string or null`, () => {
            const result = computeForkStateJson(state, savedFields, extensions, mode);
            expect(result === null || typeof result === "string").toBe(true);
        });
    }
});
