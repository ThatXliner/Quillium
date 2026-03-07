/**
 * settings.svelte.ts — Global application settings store.
 *
 * Persists user preferences to localStorage. Read by any component
 * that needs to respect user-configured behavior.
 */

const STORAGE_KEY = "quillium-app-settings";

type AppSettings = {
    selectTextInNestedEditor: boolean;
    docFontFamily: string;
    docFontSize: number;
    uiFontFamily: string;
};

const DEFAULTS: AppSettings = {
    selectTextInNestedEditor: true,
    docFontFamily: '"SF Pro Text", system-ui, sans-serif',
    docFontSize: 18,
    uiFontFamily: "system-ui, -apple-system, sans-serif",
};

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULTS };
    }
}

function saveSettings(s: AppSettings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {}
}

export function applySettings(s: AppSettings) {
    const root = document.documentElement;
    root.style.setProperty("--doc-font-family", s.docFontFamily);
    root.style.setProperty("--doc-font-size", `${s.docFontSize}px`);
    root.style.setProperty("--ui-font-family", s.uiFontFamily);
}

export const appSettings = $state<AppSettings>(loadSettings());

// Apply persisted settings on startup
if (typeof document !== "undefined") {
    applySettings(appSettings);
}

/**
 * Persist settings whenever they change. Call this after mutating
 * any field on appSettings.
 */
export function persistSettings() {
    saveSettings(appSettings);
}
