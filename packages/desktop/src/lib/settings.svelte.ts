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
    return readStoredSettings()?.persistUndoHistoryForNewDocuments === true;
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
    warnBeforeDraftAfterIdenticalVersion: boolean;
    duplicateDraftWarningHiddenUntil: number;
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
    warnBeforeDraftAfterIdenticalVersion: true,
    duplicateDraftWarningHiddenUntil: 0,
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

function readStoredSettings(): Partial<AppSettings> | undefined {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : undefined;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function loadSettings(fallback: AppSettings = DEFAULTS): AppSettings {
    let parsed = readStoredSettings();
    if (!parsed) return { ...fallback };
    // Migrate legacy alwaysShowTitle boolean.
    if ("alwaysShowTitle" in parsed && !("titleVisibility" in parsed)) {
        const { alwaysShowTitle, ...rest } = parsed;
        parsed = { ...rest, titleVisibility: alwaysShowTitle ? "always" : "hover" };
    }
    return normalizeSettings({ ...DEFAULTS, ...parsed });
}

function normalizeSettings(settings: AppSettings): AppSettings {
    const merged = { ...settings };
    merged.readonlyShareAutoUpdate = merged.readonlyShareAutoUpdate === true;
    merged.readonlyShareAutoUpdateDebounceMs = normalizeReadonlyShareAutoUpdateDebounceMs(
        merged.readonlyShareAutoUpdateDebounceMs,
    );
    merged.persistUndoHistoryForNewDocuments = merged.persistUndoHistoryForNewDocuments === true;
    merged.warnBeforeDraftAfterIdenticalVersion =
        merged.warnBeforeDraftAfterIdenticalVersion !== false;
    merged.duplicateDraftWarningHiddenUntil =
        typeof merged.duplicateDraftWarningHiddenUntil === "number" &&
        Number.isFinite(merged.duplicateDraftWarningHiddenUntil) &&
        merged.duplicateDraftWarningHiddenUntil > 0
            ? merged.duplicateDraftWarningHiddenUntil
            : 0;
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
            (day): day is number => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6,
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
    merged.uiZoom = Number.isFinite(merged.uiZoom)
        ? Math.round(Math.min(2, Math.max(0.5, merged.uiZoom)) * 10) / 10
        : DEFAULTS.uiZoom;
    merged.docFontSize = Number.isFinite(merged.docFontSize)
        ? Math.min(24, Math.max(14, merged.docFontSize))
        : DEFAULTS.docFontSize;
    merged.annotationPanelWidth = Number.isFinite(merged.annotationPanelWidth)
        ? Math.min(
              ANNOTATION_PANEL_MAX_WIDTH,
              Math.max(ANNOTATION_PANEL_MIN_WIDTH, Math.round(merged.annotationPanelWidth)),
          )
        : ANNOTATION_PANEL_DEFAULT_WIDTH;
    return merged;
}

function saveSettings(s: AppSettings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {}
}

/** Preview appearance without committing the Settings modal draft. */
export function previewSettings(s: Readonly<AppSettings>): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--doc-font-family", s.docFontFamily);
    root.style.setProperty("--doc-font-size", `${s.docFontSize}px`);
    root.style.setProperty("--ui-font-family", s.uiFontFamily);
    root.style.zoom = String(s.uiZoom);
}

const initialSettings = loadSettings();
if (
    typeof initialSettings.docFontFamily === "string" &&
    initialSettings.docFontFamily.includes("Inter")
) {
    initialSettings.docFontFamily = DEFAULTS.docFontFamily;
}
const settings = $state<AppSettings>(initialSettings);
export const appSettings: Readonly<AppSettings> = settings;

previewSettings(settings);

/** Commit absolute values, including validation, appearance, and persistence. */
export function updateSettings(patch: Partial<AppSettings>): void {
    // Merge against shared storage so an older window cannot overwrite another
    // window's new-document undo policy while changing an unrelated preference.
    Object.assign(settings, normalizeSettings({ ...loadSettings(settings), ...patch }));
    previewSettings(settings);
    saveSettings(settings);
}
