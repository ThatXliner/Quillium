import {
    DEFAULT_AUTOAI_SETTINGS,
    autoAISettings,
    parseAutoAISettings,
    persistAutoAISettings,
} from "$lib/autoai/settings.svelte";
import { beforeEach, describe, expect, it } from "vitest";

describe("quiet review settings migration", () => {
    beforeEach(() => {
        localStorage.clear();
        Object.assign(autoAISettings, DEFAULT_AUTOAI_SETTINGS);
    });

    it("keeps the writer-facing settings minimal", () => {
        expect(DEFAULT_AUTOAI_SETTINGS).toEqual({
            enabled: false,
            stagePreference: "auto",
        });
    });

    it("preserves enabled continuous review from the old settings shape", () => {
        expect(
            parseAutoAISettings({
                enabled: true,
                mode: "continuous",
                debounceMs: 30_000,
                annotationTypes: ["revision"],
                conservativeness: "thorough",
                persona: "My bot",
            }),
        ).toEqual({ enabled: true, stagePreference: "auto" });
    });

    it("does not silently turn old manual mode into automatic review", () => {
        expect(parseAutoAISettings({ enabled: true, mode: "manual" })).toEqual({
            enabled: false,
            stagePreference: "auto",
        });
    });

    it("persists a writing-stage override", () => {
        autoAISettings.stagePreference = "refining";
        persistAutoAISettings();
        expect(JSON.parse(localStorage.getItem("quillium-autoai-settings") ?? "{}")).toEqual({
            enabled: false,
            stagePreference: "refining",
        });
    });
});
