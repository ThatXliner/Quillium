import { type Chattiness, DEFAULT_PERSONAS, type ReaderPersona } from "./presets";

const STORAGE_KEY = "quillium-readers-settings";
const VALID_CHATTINESS: Chattiness[] = ["quiet", "normal", "verbose"];

function load(): ReaderPersona[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_PERSONAS.map((p) => ({ ...p }));
        const saved: ReaderPersona[] = JSON.parse(raw);
        // Merge saved state with defaults: preserve user toggles/chattiness,
        // but ensure new builtins are added if the preset list grows.
        const savedById = new Map(saved.map((p) => [p.id, p]));
        const merged = DEFAULT_PERSONAS.map((preset) => {
            const existing = savedById.get(preset.id);
            if (existing) {
                return {
                    ...preset,
                    enabled:
                        typeof existing.enabled === "boolean" ? existing.enabled : preset.enabled,
                    chattiness: VALID_CHATTINESS.includes(existing.chattiness)
                        ? existing.chattiness
                        : preset.chattiness,
                };
            }
            return { ...preset };
        });
        // Append any custom (non-builtin) personas the user created.
        for (const p of saved) {
            if (p.builtin === false)
                merged.push({ ...p, description: p.description || p.instruction });
        }
        return merged;
    } catch {
        return DEFAULT_PERSONAS.map((p) => ({ ...p }));
    }
}

export const readersSettings = $state<{ personas: ReaderPersona[] }>({
    personas:
        typeof localStorage !== "undefined" ? load() : DEFAULT_PERSONAS.map((p) => ({ ...p })),
});

export function persistReadersSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(readersSettings.personas));
    } catch {}
}

export function getEnabledPersonas(): ReaderPersona[] {
    return readersSettings.personas.filter((p) => p.enabled);
}

export function togglePersona(id: string) {
    const persona = readersSettings.personas.find((p) => p.id === id);
    if (persona) {
        persona.enabled = !persona.enabled;
        persistReadersSettings();
    }
}

export function cycleChattiness(id: string) {
    const persona = readersSettings.personas.find((p) => p.id === id);
    if (!persona) return;
    const levels: ReaderPersona["chattiness"][] = ["quiet", "normal", "verbose"];
    const idx = levels.indexOf(persona.chattiness);
    persona.chattiness = levels[(idx + 1) % levels.length];
    persistReadersSettings();
}

export function addCustomPersona(persona: Omit<ReaderPersona, "id" | "builtin">) {
    readersSettings.personas.push({
        ...persona,
        id: crypto.randomUUID(),
        builtin: false,
    });
    persistReadersSettings();
}

export function removeCustomPersona(id: string) {
    const idx = readersSettings.personas.findIndex((p) => p.id === id && !p.builtin);
    if (idx !== -1) {
        readersSettings.personas.splice(idx, 1);
        persistReadersSettings();
    }
}
