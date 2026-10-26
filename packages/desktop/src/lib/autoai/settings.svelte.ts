/**
 * autoai/settings.svelte.ts — AutoAI collaborator settings store.
 *
 * Persists to localStorage. Read by AutoAIWidget and the engine.
 */

const STORAGE_KEY = "quillium-autoai-settings";

export type AutoAIAnnotationType = "comment" | "suggestion" | "revision";
export type AutoAIConservativeness = "conservative" | "balanced" | "thorough";
export type AutoAIMode = "continuous" | "manual";

export type AutoAISettings = {
    enabled: boolean;
    mode: AutoAIMode;
    debounceMs: number;
    persona: string;
    annotationTypes: AutoAIAnnotationType[];
    conservativeness: AutoAIConservativeness;
};

const DEFAULTS: AutoAISettings = {
    enabled: false,
    mode: "continuous",
    debounceMs: 10000,
    persona: "AutoAI",
    annotationTypes: ["comment"],
    conservativeness: "conservative",
};

function load(): AutoAISettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULTS };
    }
}

export const autoAISettings = $state<AutoAISettings>(
    typeof localStorage !== "undefined" ? load() : { ...DEFAULTS },
);

export function persistAutoAISettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(autoAISettings));
    } catch {}
}
