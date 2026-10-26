import {
    assertCollegeContextReady,
    collegeState,
    getActiveCollegeSetup,
    updateActiveCollegeSetup,
} from "$lib/college/state.svelte";
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

function clonePersonas(personas: readonly ReaderPersona[]): ReaderPersona[] {
    return JSON.parse(JSON.stringify(personas)) as ReaderPersona[];
}

function reportCollegeError(error: unknown): void {
    collegeState.error =
        error instanceof Error ? error.message : "Could not save reader preferences.";
}

function collegeMutationAllowed(): boolean {
    try {
        assertCollegeContextReady();
        return true;
    } catch (error) {
        reportCollegeError(error);
        return false;
    }
}

/** Readers resolved for the active tab, falling back to device settings. */
export function getEffectivePersonas(): ReaderPersona[] {
    const setup = getActiveCollegeSetup();
    return clonePersonas(setup?.readers ?? readersSettings.personas);
}

export function getEnabledPersonas(): ReaderPersona[] {
    return getEffectivePersonas().filter((p) => p.enabled);
}

export async function togglePersona(id: string): Promise<void> {
    if (!collegeMutationAllowed()) return;
    const setup = getActiveCollegeSetup();
    if (setup) {
        const personas = clonePersonas(setup.readers);
        const persona = personas.find((p) => p.id === id);
        if (!persona) return;
        persona.enabled = !persona.enabled;
        try {
            await updateActiveCollegeSetup({ readers: personas });
        } catch (error) {
            reportCollegeError(error);
        }
        return;
    }
    const persona = readersSettings.personas.find((p) => p.id === id);
    if (persona) {
        persona.enabled = !persona.enabled;
        persistReadersSettings();
    }
}

export async function cycleChattiness(id: string): Promise<void> {
    if (!collegeMutationAllowed()) return;
    const setup = getActiveCollegeSetup();
    if (setup) {
        const personas = clonePersonas(setup.readers);
        const persona = personas.find((p) => p.id === id);
        if (!persona) return;
        const levels: ReaderPersona["chattiness"][] = ["quiet", "normal", "verbose"];
        const idx = levels.indexOf(persona.chattiness);
        persona.chattiness = levels[(idx + 1) % levels.length];
        try {
            await updateActiveCollegeSetup({ readers: personas });
        } catch (error) {
            reportCollegeError(error);
        }
        return;
    }
    const persona = readersSettings.personas.find((p) => p.id === id);
    if (!persona) return;
    const levels: ReaderPersona["chattiness"][] = ["quiet", "normal", "verbose"];
    const idx = levels.indexOf(persona.chattiness);
    persona.chattiness = levels[(idx + 1) % levels.length];
    persistReadersSettings();
}

export async function addCustomPersona(
    persona: Omit<ReaderPersona, "id" | "builtin">,
): Promise<void> {
    if (!collegeMutationAllowed()) return;
    const next = {
        ...persona,
        id: crypto.randomUUID(),
        builtin: false,
    } satisfies ReaderPersona;
    const setup = getActiveCollegeSetup();
    if (setup) {
        if (setup.readers.length >= 16) {
            collegeState.error = "A College setup can contain at most 16 readers.";
            return;
        }
        try {
            await updateActiveCollegeSetup({ readers: [...setup.readers, next] });
        } catch (error) {
            reportCollegeError(error);
        }
        return;
    }
    readersSettings.personas.push({
        ...next,
    });
    persistReadersSettings();
}

export async function removeCustomPersona(id: string): Promise<void> {
    if (!collegeMutationAllowed()) return;
    const setup = getActiveCollegeSetup();
    if (setup) {
        const next = setup.readers.filter((p) => !(p.id === id && !p.builtin));
        if (next.length === setup.readers.length) return;
        try {
            await updateActiveCollegeSetup({ readers: next });
        } catch (error) {
            reportCollegeError(error);
        }
        return;
    }
    const idx = readersSettings.personas.findIndex((p) => p.id === id && !p.builtin);
    if (idx !== -1) {
        readersSettings.personas.splice(idx, 1);
        persistReadersSettings();
    }
}
