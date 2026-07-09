/**
 * autoai/settings.svelte.ts — Explicit controls for the background reviewer.
 *
 * AutoAI is intentionally configurable: writers decide when it runs, how long
 * it waits, which annotation forms it may create, and how selective it should be.
 */

const STORAGE_KEY = "quillium-autoai-settings";

export const AUTOAI_ANNOTATION_TYPES = ["comment", "suggestion", "revision"] as const;
export type AutoAIAnnotationType = (typeof AUTOAI_ANNOTATION_TYPES)[number];
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

export const DEFAULT_AUTOAI_SETTINGS: AutoAISettings = {
    enabled: false,
    mode: "continuous",
    debounceMs: 10_000,
    persona: "AutoAI",
    annotationTypes: ["comment", "suggestion", "revision"],
    conservativeness: "conservative",
};

const CONSERVATIVENESS_LEVELS: AutoAIConservativeness[] = ["conservative", "balanced", "thorough"];

export function parseAutoAISettings(raw: unknown): AutoAISettings {
    if (!raw || typeof raw !== "object") {
        return { ...DEFAULT_AUTOAI_SETTINGS, annotationTypes: [...AUTOAI_ANNOTATION_TYPES] };
    }
    const value = raw as Record<string, unknown>;
    const annotationTypes = Array.isArray(value.annotationTypes)
        ? value.annotationTypes.filter((item): item is AutoAIAnnotationType =>
              AUTOAI_ANNOTATION_TYPES.includes(item as AutoAIAnnotationType),
          )
        : [...AUTOAI_ANNOTATION_TYPES];

    return {
        enabled: typeof value.enabled === "boolean" ? value.enabled : false,
        mode: value.mode === "manual" ? "manual" : "continuous",
        debounceMs:
            typeof value.debounceMs === "number" && value.debounceMs >= 2_000
                ? Math.min(value.debounceMs, 60_000)
                : 10_000,
        persona:
            typeof value.persona === "string" && value.persona.trim()
                ? value.persona.trim().slice(0, 20)
                : "AutoAI",
        annotationTypes:
            annotationTypes.length > 0 ? annotationTypes : [...AUTOAI_ANNOTATION_TYPES],
        conservativeness: CONSERVATIVENESS_LEVELS.includes(
            value.conservativeness as AutoAIConservativeness,
        )
            ? (value.conservativeness as AutoAIConservativeness)
            : "conservative",
    };
}

function load(): AutoAISettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? parseAutoAISettings(JSON.parse(raw)) : parseAutoAISettings(undefined);
    } catch {
        return parseAutoAISettings(undefined);
    }
}

export const autoAISettings = $state<AutoAISettings>(
    typeof localStorage !== "undefined" ? load() : parseAutoAISettings(undefined),
);

export function persistAutoAISettings(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(autoAISettings));
    } catch {}
}
