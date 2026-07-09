/**
 * autoai/settings.svelte.ts — Minimal settings for Quillium's quiet reviewer.
 *
 * Review cadence, annotation mix, and editorial depth are internal decisions.
 * Writers choose only whether quiet review is active and may override the
 * automatically inferred writing stage.
 */

import {
    WRITING_STAGE_PREFERENCES,
    type WritingStagePreference,
} from "$lib/ai/editor/editorContract";

const STORAGE_KEY = "quillium-autoai-settings";

export type AutoAISettings = {
    enabled: boolean;
    stagePreference: WritingStagePreference;
};

export const DEFAULT_AUTOAI_SETTINGS: AutoAISettings = {
    enabled: false,
    stagePreference: "auto",
};

export function parseAutoAISettings(raw: unknown): AutoAISettings {
    if (!raw || typeof raw !== "object") return { ...DEFAULT_AUTOAI_SETTINGS };
    const value = raw as Record<string, unknown>;
    const stagePreference = WRITING_STAGE_PREFERENCES.includes(
        value.stagePreference as WritingStagePreference,
    )
        ? (value.stagePreference as WritingStagePreference)
        : "auto";

    // The old manual mode promised not to review automatically. Preserve that
    // expectation during migration by leaving quiet review paused.
    const migratedManualMode = value.mode === "manual";
    return {
        enabled: typeof value.enabled === "boolean" && !migratedManualMode && value.enabled,
        stagePreference,
    };
}

function load(): AutoAISettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? parseAutoAISettings(JSON.parse(raw)) : { ...DEFAULT_AUTOAI_SETTINGS };
    } catch {
        return { ...DEFAULT_AUTOAI_SETTINGS };
    }
}

export const autoAISettings = $state<AutoAISettings>(
    typeof localStorage !== "undefined" ? load() : { ...DEFAULT_AUTOAI_SETTINGS },
);

export function persistAutoAISettings(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(autoAISettings));
    } catch {}
}
