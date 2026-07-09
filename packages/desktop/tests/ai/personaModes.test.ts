import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
    DEFAULT_PERSONA_MODES,
    parsePersonaModes,
    personaModes,
    setPersonasForMode,
} from "$lib/ai/settings.svelte";

describe("personaModes migration", () => {
    beforeEach(() => {
        localStorage.clear();
        personaModes.feedback = false;
        personaModes.revise = false;
        personaModes.editor = false;
    });

    it("defaults all persona surfaces to off", () => {
        expect(DEFAULT_PERSONA_MODES).toEqual({
            feedback: false,
            revise: false,
            editor: false,
        });
    });

    it("preserves existing feedback/revise values and adds editor=false", () => {
        expect(parsePersonaModes({ feedback: true, revise: false })).toEqual({
            feedback: true,
            revise: false,
            editor: false,
        });
    });

    it("ignores malformed stored values", () => {
        expect(parsePersonaModes({ feedback: "yes", revise: true, editor: 1 })).toEqual({
            feedback: false,
            revise: true,
            editor: false,
        });
    });

    it("persists the editor opt-in without dropping legacy modes", () => {
        personaModes.feedback = true;
        personaModes.revise = false;

        setPersonasForMode("editor", true);

        expect(JSON.parse(localStorage.getItem("quillium-ai-persona-modes") ?? "{}")).toEqual({
            feedback: true,
            revise: false,
            editor: true,
        });
    });
});
