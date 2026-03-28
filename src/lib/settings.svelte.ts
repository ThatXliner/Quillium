/**
 * settings.svelte.ts — Global application settings store.
 *
 * Persists user preferences to localStorage. Read by any component
 * that needs to respect user-configured behavior.
 */

const STORAGE_KEY = "quillium-app-settings";

export type CustomQuickAction = {
    label: string;
    prompt: string;
    panel: "revise" | "feedback" | "chat";
};

type AppSettings = {
    selectTextInNestedEditor: boolean;
    showNestedEditor: boolean;
    atomicRevisions: boolean;
    docFontFamily: string;
    docFontSize: number;
    uiFontFamily: string;
    customQuickActions: CustomQuickAction[];
    titleVisibility: "hover" | "always" | "never";
    titleHoverDelay: number;
    titleLingerDuration: number;
    uiZoom: number;
    analyticsEnabled: boolean;
    aiEnabled: boolean;
    showShortcutHints: boolean;
    showWordCount: boolean;
    wordCountDisplayMode: "words" | "chars" | "both";
    persistResizeSizes: boolean;
    revisionModalWidth?: number;
    revisionModalHeight?: number;
    commentModalWidth?: number;
    commentModalHeight?: number;
    settingsModalWidth?: number;
    settingsModalHeight?: number;
    aiSidebarWidth?: number;
    aiSidebarHeight?: number;
};

const DEFAULTS: AppSettings = {
    selectTextInNestedEditor: true,
    showNestedEditor: true,
    atomicRevisions: true,
    docFontFamily: "Georgia, serif",
    docFontSize: 18,
    uiFontFamily: "system-ui, -apple-system, sans-serif",
    customQuickActions: [],
    titleVisibility: "hover",
    titleHoverDelay: 350,
    titleLingerDuration: 3000,
    uiZoom: 1,
    analyticsEnabled: true,
    aiEnabled: false,
    showShortcutHints: true,
    showWordCount: true,
    wordCountDisplayMode: "both",
    persistResizeSizes: false,
};

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        const parsed = JSON.parse(raw);
        // Migrate legacy alwaysShowTitle boolean
        if ("alwaysShowTitle" in parsed && !("titleVisibility" in parsed)) {
            parsed.titleVisibility = parsed.alwaysShowTitle ? "always" : "hover";
            delete parsed.alwaysShowTitle;
        }
        return { ...DEFAULTS, ...parsed };
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
    root.style.zoom = String(s.uiZoom);
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
