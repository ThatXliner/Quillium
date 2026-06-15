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

export type ThemePreference = "light" | "dark" | "system";

type AppSettings = {
    theme: ThemePreference;
    selectTextInNestedEditor: boolean;
    showNestedEditor: boolean;
    atomicRevisions: boolean;
    editorMode: "plain" | "markdown";
    docFontFamily: string;
    docFontSize: number;
    uiFontFamily: string;
    customQuickActions: CustomQuickAction[];
    titleVisibility: "hover" | "always" | "never";
    titleHoverDelay: number;
    titleLingerDuration: number;
    uiZoom: number;
    analyticsEnabled: boolean;
    // TODO(#191): re-enable once App Store is established
    // shareDocumentAnalytics: boolean;
    // shareDocumentKey: string;
    aiEnabled: boolean;
    showShortcutHints: boolean;
    showWordCount: boolean;
    wordCountDisplayMode: "words" | "chars" | "both";
    autoVersionOnRevisionCreate: boolean;
    showAiSuggestions: boolean;
    // When true, the AI panels hide the "AI can see your selection" context
    // summary card and tuck it into the header info (ℹ) icon instead.
    collapseContextSummary: boolean;
    checkForUpdates: boolean;
    grammarCheckEnabled: boolean;
    grammarDialect: "american" | "british" | "australian";
    annotationPanelWidth: number;
    // Where annotation cards are placed when the AI sidebar is hidden (AI off):
    //   "visual-split" — balance cards across a left and right column
    //   "by-type"      — comments on the left, revisions/suggestions on the right
    //   "single"       — one right column (the classic layout)
    // Forced to "single" whenever aiEnabled is true (the sidebar owns the left).
    annotationLayout: "visual-split" | "by-type" | "single";
};

const DEFAULTS: AppSettings = {
    theme: "system",
    selectTextInNestedEditor: true,
    showNestedEditor: true,
    atomicRevisions: true,
    editorMode: "markdown",
    docFontFamily: "Georgia, serif",
    docFontSize: 18,
    uiFontFamily: "system-ui, -apple-system, sans-serif",
    customQuickActions: [],
    titleVisibility: "hover",
    titleHoverDelay: 350,
    titleLingerDuration: 3000,
    uiZoom: 1,
    analyticsEnabled: true,
    // TODO(#191): re-enable once App Store is established
    // shareDocumentAnalytics: false,
    // shareDocumentKey: "",
    aiEnabled: false,
    showShortcutHints: true,
    showWordCount: true,
    wordCountDisplayMode: "both",
    autoVersionOnRevisionCreate: true,
    showAiSuggestions: true,
    collapseContextSummary: false,
    checkForUpdates: true,
    grammarCheckEnabled: true,
    grammarDialect: "american",
    annotationPanelWidth: 280,
    annotationLayout: "visual-split",
};

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        let parsed = JSON.parse(raw);
        // Migrate legacy alwaysShowTitle boolean
        if ("alwaysShowTitle" in parsed && !("titleVisibility" in parsed)) {
            const { alwaysShowTitle, ...rest } = parsed;
            parsed = {
                ...rest,
                titleVisibility: alwaysShowTitle ? "always" : "hover",
            };
        }
        const merged = { ...DEFAULTS, ...parsed };
        if (typeof merged.docFontFamily === "string" && merged.docFontFamily.includes("Inter")) {
            merged.docFontFamily = DEFAULTS.docFontFamily;
        }
        return merged;
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
    // Drives the dark-mode token layer in app.css. "system" follows the OS via
    // prefers-color-scheme; "light"/"dark" force the theme regardless of OS.
    root.setAttribute("data-theme", s.theme);
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
