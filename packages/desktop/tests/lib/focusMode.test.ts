import { isFocusModeFeatureEnabled, isFocusModeShortcut } from "$lib/focusMode";
import { describe, expect, it } from "vitest";

function keyboardEvent(key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    return new KeyboardEvent("keydown", { key, ...modifiers });
}

describe("isFocusModeShortcut", () => {
    it("accepts F11 without primary modifiers", () => {
        expect(isFocusModeShortcut(keyboardEvent("F11"))).toBe(true);
    });

    it("accepts Command-Shift-F and Control-Shift-F", () => {
        expect(isFocusModeShortcut(keyboardEvent("f", { metaKey: true, shiftKey: true }))).toBe(
            true,
        );
        expect(isFocusModeShortcut(keyboardEvent("F", { ctrlKey: true, shiftKey: true }))).toBe(
            true,
        );
    });

    it("does not capture browser find or modified F11 shortcuts", () => {
        expect(isFocusModeShortcut(keyboardEvent("f", { metaKey: true }))).toBe(false);
        expect(isFocusModeShortcut(keyboardEvent("F11", { ctrlKey: true }))).toBe(false);
        expect(
            isFocusModeShortcut(
                keyboardEvent("f", { metaKey: true, shiftKey: true, altKey: true }),
            ),
        ).toBe(false);
    });
});

describe("isFocusModeFeatureEnabled", () => {
    it("enables focus mode only for the explicit boolean flag", () => {
        expect(isFocusModeFeatureEnabled(true)).toBe(true);
        expect(isFocusModeFeatureEnabled(false)).toBe(false);
        expect(isFocusModeFeatureEnabled(undefined)).toBe(false);
        expect(isFocusModeFeatureEnabled("control")).toBe(false);
    });
});
