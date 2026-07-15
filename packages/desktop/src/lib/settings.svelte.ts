/**
 * settings.svelte.ts — Global application settings store.
 *
 * Persists user preferences to localStorage. Read by any component
 * that needs to respect user-configured behavior.
 */

import {
    READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS,
    normalizeReadonlyShareAutoUpdateDebounceMs,
} from "$lib/collab/readonlyShareAutoUpdate";
import { DRAFT_PANEL_DEFAULT_WIDTH, DRAFT_PANEL_MIN_WIDTH } from "$lib/editor/draftPanelResize";

const STORAGE_KEY = "quillium-app-settings";

/**
 * Reads the new-document undo policy at the moment a document is created.
 *
 * Each Tauri window owns its own in-memory `appSettings` rune. Reading the
 * shared localStorage value here prevents an already-open window from using a
 * stale copy after another window saves Settings. Invalid or unavailable
 * storage must choose the safer session-only default.
 */
export function getPersistUndoHistoryForNewDocuments(): boolean {
    try {
        if (typeof localStorage === "undefined") return false;
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return parsed.persistUndoHistoryForNewDocuments === true;
    } catch {
        return false;
    }
}

// Clamp bounds + default for the floating annotation panel width. Exported so
// Annotations.svelte's resize handle, reset button, and "is custom" check use
// the same numbers as the persisted default below — a hardcoded copy in the
// component could silently drift from DEFAULTS.annotationPanelWidth.
export const ANNOTATION_PANEL_MIN_WIDTH = 180;
export const ANNOTATION_PANEL_MAX_WIDTH = 420;
export const ANNOTATION_PANEL_DEFAULT_WIDTH = 280;

export type CustomQuickAction = {
    label: string;
    prompt: string;
    panel: "revise" | "feedback" | "chat";
};

export type AppSettings = {
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
    draftPanelWidth: number;
    readonlyShareAutoUpdate: boolean;
    readonlyShareAutoUpdateDebounceMs: number;
    /** Captured per document at creation; pre-2026-07-14 documents are grandfathered on. */
    persistUndoHistoryForNewDocuments: boolean;
    /** NanoWriMo writing reminders, gated at runtime by the `novel-november` flag. */
    writingRemindersEnabled: boolean;
    /** Local wall-clock times in 24-hour HH:mm format. */
    writingReminderTimes: string[];
    /** JavaScript weekday numbers (Sunday = 0). */
    writingReminderDays: number[];
    // Where annotation cards are placed when the AI sidebar is hidden (AI off):
    //   "visual-split" — balance cards across a left and right column
    //   "by-type"      — comments on the left, revisions/suggestions on the right
    //   "single"       — one right column (the classic layout)
    // Forced to "single" whenever aiEnabled is true (the sidebar owns the left).
    annotationLayout: "visual-split" | "by-type" | "single";
};

const DEFAULTS: AppSettings = {
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
    annotationPanelWidth: ANNOTATION_PANEL_DEFAULT_WIDTH,
    draftPanelWidth: DRAFT_PANEL_DEFAULT_WIDTH,
    readonlyShareAutoUpdate: false,
    readonlyShareAutoUpdateDebounceMs: READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS,
    persistUndoHistoryForNewDocuments: false,
    writingRemindersEnabled: false,
    writingReminderTimes: ["09:00"],
    writingReminderDays: [0, 1, 2, 3, 4, 5, 6],
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
        merged.readonlyShareAutoUpdate = merged.readonlyShareAutoUpdate === true;
        merged.readonlyShareAutoUpdateDebounceMs = normalizeReadonlyShareAutoUpdateDebounceMs(
            merged.readonlyShareAutoUpdateDebounceMs,
        );
        merged.persistUndoHistoryForNewDocuments =
            merged.persistUndoHistoryForNewDocuments === true;
        merged.writingRemindersEnabled = merged.writingRemindersEnabled === true;
        merged.writingReminderTimes = Array.isArray(merged.writingReminderTimes)
            ? [
                  ...new Set(
                      merged.writingReminderTimes.filter(
                          (time: unknown) =>
                              typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time),
                      ),
                  ),
              ].sort()
            : [...DEFAULTS.writingReminderTimes];
        if (merged.writingReminderTimes.length === 0) {
            merged.writingReminderTimes = [...DEFAULTS.writingReminderTimes];
        }
        if (Array.isArray(merged.writingReminderDays)) {
            const reminderDays = (merged.writingReminderDays as unknown[]).filter(
                (day): day is number =>
                    Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6,
            );
            merged.writingReminderDays = [...new Set(reminderDays)].sort((a, b) => a - b);
        } else {
            merged.writingReminderDays = [...DEFAULTS.writingReminderDays];
        }
        if (merged.writingReminderDays.length === 0) {
            merged.writingReminderDays = [...DEFAULTS.writingReminderDays];
        }
        merged.draftPanelWidth =
            typeof merged.draftPanelWidth === "number" && Number.isFinite(merged.draftPanelWidth)
                ? Math.max(DRAFT_PANEL_MIN_WIDTH, Math.round(merged.draftPanelWidth))
                : DRAFT_PANEL_DEFAULT_WIDTH;
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
