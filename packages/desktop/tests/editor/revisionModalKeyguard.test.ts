import { describe, expect, it } from "vitest";
import { shouldHandleRevisionModalKeydown } from "$lib/editor/plugins/annotations/revisionModalKeyguard";

describe("shouldHandleRevisionModalKeydown", () => {
    it("ignores events that were already handled", () => {
        const event = { defaultPrevented: true, target: null } as KeyboardEvent;
        expect(shouldHandleRevisionModalKeydown(event)).toBe(false);
    });

    it("ignores events originating inside CodeMirror editors", () => {
        const wrapper = document.createElement("div");
        wrapper.className = "cm-editor";
        const inner = document.createElement("button");
        wrapper.appendChild(inner);
        document.body.appendChild(wrapper);

        const event = { defaultPrevented: false, target: inner } as unknown as KeyboardEvent;
        expect(shouldHandleRevisionModalKeydown(event)).toBe(false);

        wrapper.remove();
    });

    it("ignores events targeting text inputs and textareas", () => {
        const input = document.createElement("input");
        const textarea = document.createElement("textarea");

        expect(
            shouldHandleRevisionModalKeydown({
                target: input,
                defaultPrevented: false,
            } as unknown as KeyboardEvent),
        ).toBe(false);
        expect(
            shouldHandleRevisionModalKeydown({
                target: textarea,
                defaultPrevented: false,
            } as unknown as KeyboardEvent),
        ).toBe(false);
    });

    it("allows events that should bubble up to the modal", () => {
        const span = document.createElement("span");
        const event = { defaultPrevented: false, target: span } as unknown as KeyboardEvent;
        expect(shouldHandleRevisionModalKeydown(event)).toBe(true);
    });
});
