import {
    DEFAULT_AUTOAI_SETTINGS,
    autoAISettings,
    parseAutoAISettings,
    persistAutoAISettings,
} from "$lib/autoai/settings.svelte";
import { beforeEach, describe, expect, it } from "vitest";

describe("AutoAI settings migration", () => {
    beforeEach(() => {
        localStorage.clear();
        Object.assign(autoAISettings, DEFAULT_AUTOAI_SETTINGS, {
            annotationTypes: [...DEFAULT_AUTOAI_SETTINGS.annotationTypes],
        });
    });

    it("keeps the original writer-facing controls explicit", () => {
        expect(DEFAULT_AUTOAI_SETTINGS).toEqual({
            enabled: false,
            mode: "continuous",
            debounceMs: 10_000,
            persona: "AutoAI",
            annotationTypes: ["comment", "suggestion", "revision"],
            conservativeness: "conservative",
        });
    });

    it("preserves a valid existing settings shape", () => {
        expect(
            parseAutoAISettings({
                enabled: true,
                mode: "manual",
                debounceMs: 30_000,
                annotationTypes: ["comment", "revision"],
                conservativeness: "thorough",
                persona: "Draft Coach",
            }),
        ).toEqual({
            enabled: true,
            mode: "manual",
            debounceMs: 30_000,
            annotationTypes: ["comment", "revision"],
            conservativeness: "thorough",
            persona: "Draft Coach",
        });
    });

    it("falls back safely for malformed values and never disables every output type", () => {
        expect(
            parseAutoAISettings({
                enabled: "yes",
                mode: "unknown",
                debounceMs: 90_000,
                annotationTypes: ["unknown"],
                conservativeness: "maximum",
                persona: "   ",
            }),
        ).toEqual({
            ...DEFAULT_AUTOAI_SETTINGS,
            debounceMs: 60_000,
        });
    });

    it("persists explicit review controls", () => {
        autoAISettings.enabled = true;
        autoAISettings.mode = "manual";
        autoAISettings.debounceMs = 25_000;
        autoAISettings.annotationTypes = ["comment", "suggestion"];
        autoAISettings.conservativeness = "balanced";
        autoAISettings.persona = "Margin Editor";
        persistAutoAISettings();
        expect(JSON.parse(localStorage.getItem("quillium-autoai-settings") ?? "{}")).toEqual({
            enabled: true,
            mode: "manual",
            debounceMs: 25_000,
            annotationTypes: ["comment", "suggestion"],
            conservativeness: "balanced",
            persona: "Margin Editor",
        });
    });
});
