<!--
    SettingsModal.svelte — Full settings dialog modal.

    Opens as a <dialog> element. The modal owns the draft/save/discard flow,
    tab switching, deep-link scroll-to-setting, and the header/footer chrome;
    the actual settings rows live in the ./sections components, built on the
    row primitives (SettingToggle, SettingSegmented, SettingSlider,
    FontPickerRow). Shared row styles live in ./settings.css.

    Live apply: every change is applied immediately via applySettings().
    Save: persists to localStorage. Close without saving: shake +
    fading red ring on the modal (same pattern as annotation alerts).
    Unsaved changes revert on discard.

    Props:
      - onclose: () => void — called when the modal is fully dismissed.
      - scrollTo — optional "setting-id" or "quick-actions:panel" deep link.
-->
<script lang="ts">
import changelog from "$lib/changelog.json";
import { FEEDBACK_FORM_URL } from "$lib/constants";
import {
    getEditorLanguageExtension,
    harperCompartment,
    languageCompartment,
} from "$lib/editor/extensions";
import {
    HARPER_DICTIONARY_KEY,
    harperExtension,
    loadUserDictionary,
    resetHarper,
} from "$lib/editor/harper/harperLinter";
import { forceLinting } from "$lib/editor/harper/lint";
import { appEventBus } from "$lib/events/appEventBus";
import { showFeedbackSurvey, syncAnalyticsOptOut } from "$lib/posthog"; // TODO(#191): re-add syncShareDocumentAnalytics
import posthog from "$lib/posthog";
import { appSettings, applySettings, persistSettings } from "$lib/settings.svelte";
import { editorView } from "$lib/stores";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Dialect } from "harper.js";
import { Bug, ChevronDown, MessageSquare, Scale, X } from "lucide-svelte";
import { get } from "svelte/store";
import FontGuideModal from "./FontGuideModal.svelte";
import "./settings.css";
import AISection from "./sections/AISection.svelte";
import AppearanceSection from "./sections/AppearanceSection.svelte";
import DictionarySection from "./sections/DictionarySection.svelte";
import EditorSection from "./sections/EditorSection.svelte";
import PrivacySection from "./sections/PrivacySection.svelte";
import QuickActionsSection from "./sections/QuickActionsSection.svelte";
import SearchSection from "./sections/SearchSection.svelte";
import TitleSection from "./sections/TitleSection.svelte";
import WritingSection from "./sections/WritingSection.svelte";

const { onclose, scrollTo }: { onclose: () => void; scrollTo?: string } = $props();

// Local draft — a shallow copy of persisted settings
let draft = $state({ ...appSettings });

// Snapshot of what was persisted when the modal opened (for discard)
const savedSnapshot = { ...appSettings };

// Personal dictionary state — draft-only; persisted only on save()
function loadDictionaryWords(): string[] {
    try {
        const raw = localStorage.getItem(HARPER_DICTIONARY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

const savedDictionaryWords = loadDictionaryWords();
let dictionaryWords = $state<string[]>([...savedDictionaryWords]);

let isDirty = $derived(
    JSON.stringify(draft) !== JSON.stringify(savedSnapshot) ||
        JSON.stringify(dictionaryWords) !== JSON.stringify(savedDictionaryWords),
);

// Quick actions panel — owned here because the scroll-to-setting deep link
// ("quick-actions:feedback") selects a panel from outside the section.
let selectedPanel = $state<"revise" | "feedback" | "chat">("revise");

function isQuickActionPanel(value: string | undefined): value is typeof selectedPanel {
    return value === "revise" || value === "feedback" || value === "chat";
}

let dialogEl = $state<HTMLDialogElement | undefined>(undefined);
let innerEl = $state<HTMLDivElement | undefined>(undefined);
let bodyEl = $state<HTMLDivElement | undefined>(undefined);

// Shake + ring state — key increments each trigger so CSS animation replays
let alertKey = $state(0);
let alerting = $state(false);

// All changelog versions, newest-first (matches changelog.json ordering),
// for the "What's New" dropdown.
const changelogVersions: { version: string; date: string }[] = Object.entries(
    changelog as Record<string, { date: string; content: string }>,
).map(([version, entry]) => ({ version, date: entry.date }));

let whatsNewOpen = $state(false);

function openChangelog(version?: string) {
    appEventBus.emit({ type: "show-changelog", version });
    whatsNewOpen = false;
    onclose();
}

// Close the What's New dropdown on outside click.
$effect(() => {
    if (!whatsNewOpen) return;
    const handler = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest(".whats-new-dropdown")) {
            whatsNewOpen = false;
        }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
});

// Tab state
let activeTab = $state<"basic" | "advanced">("basic");
let tabTrackEl = $state<HTMLElement | undefined>(undefined);
let tabPillStyle = $state("");

$effect(() => {
    if (!tabTrackEl) return;
    const buttons = tabTrackEl.querySelectorAll<HTMLButtonElement>(".settings-tab-btn");
    const idx = activeTab === "basic" ? 0 : 1;
    const btn = buttons[idx];
    if (!btn) return;
    tabPillStyle = `--tab-pill-width: ${btn.offsetWidth}px; --tab-pill-x: ${btn.offsetLeft - 3}px;`;
});

let showFontGuide = $state<"doc" | "ui" | null>(null);

function scrollToSettingTarget(targetId: string) {
    requestAnimationFrame(() => {
        const target = dialogEl?.querySelector<HTMLElement>(`[data-setting-id="${targetId}"]`);
        if (!target) return;
        if (bodyEl) {
            const bodyRect = bodyEl.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            bodyEl.scrollTo({
                top:
                    bodyEl.scrollTop +
                    targetRect.top -
                    bodyRect.top -
                    bodyRect.height / 2 +
                    targetRect.height / 2,
                behavior: "smooth",
            });
        } else {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        target.classList.add("setting-flash");
        target.addEventListener("animationend", () => target.classList.remove("setting-flash"), {
            once: true,
        });
    });
}

function applyScrollTarget(target: string | undefined) {
    if (!target) return;
    const [settingId, detail] = target.split(":");
    if (settingId === "quick-actions") {
        activeTab = "advanced";
        if (isQuickActionPanel(detail)) {
            selectedPanel = detail;
        }
    }
    scrollToSettingTarget(settingId);
}

$effect(() => {
    if (dialogEl && !dialogEl.open) {
        dialogEl.showModal();
        posthog.capture("settings_opened");

        applyScrollTarget(scrollTo);
    }
});

$effect(() => {
    if (!dialogEl?.open || !bodyEl || !scrollTo) return;
    applyScrollTarget(scrollTo);
});

function handleChange() {
    applySettings(draft);
}

function save() {
    const analyticsChanged = appSettings.analyticsEnabled !== draft.analyticsEnabled;
    // TODO(#191): restore shareDocChanged check when shareDocumentAnalytics is re-enabled
    // const shareDocChanged =
    //     appSettings.shareDocumentAnalytics !== draft.shareDocumentAnalytics ||
    //     appSettings.shareDocumentKey !== draft.shareDocumentKey;
    Object.assign(appSettings, draft);
    persistSettings();

    // Reconfigure Harper grammar checker; always reset so the dictionary
    // starts clean (removed words are evicted), then re-import the full list.
    const dialectMap = {
        american: Dialect.American,
        british: Dialect.British,
        australian: Dialect.Australian,
    } as const;
    localStorage.setItem(HARPER_DICTIONARY_KEY, JSON.stringify(dictionaryWords));
    resetHarper(dialectMap[draft.grammarDialect]);
    loadUserDictionary().then(() => {
        const v = get(editorView);
        if (v) forceLinting(v);
    });

    const view = get(editorView);
    if (view) {
        view.dispatch({
            effects: [
                harperCompartment.reconfigure(draft.grammarCheckEnabled ? harperExtension() : []),
                languageCompartment.reconfigure(getEditorLanguageExtension(draft.editorMode)),
            ],
        });
    }

    if (analyticsChanged) {
        syncAnalyticsOptOut(draft.analyticsEnabled);
    }
    // TODO(#191): restore syncShareDocumentAnalytics call when document sharing is re-enabled
    // if (shareDocChanged) {
    //     syncShareDocumentAnalytics(draft.shareDocumentAnalytics, draft.shareDocumentKey);
    // }
    posthog.capture("settings_saved", {
        ai_enabled: draft.aiEnabled,
        select_text_in_nested_editor: draft.selectTextInNestedEditor,
        show_nested_editor: draft.showNestedEditor,
        atomic_revisions: draft.atomicRevisions,
        editor_mode: draft.editorMode,
        doc_font_family: draft.docFontFamily,
        doc_font_size: draft.docFontSize,
        ui_font_family: draft.uiFontFamily,
        title_visibility: draft.titleVisibility,
        title_hover_delay: draft.titleHoverDelay,
        title_linger_duration: draft.titleLingerDuration,
        ui_zoom: draft.uiZoom,
        custom_quick_actions_count: draft.customQuickActions.length,
        auto_version_on_revision_create: draft.autoVersionOnRevisionCreate,
        annotation_layout: draft.annotationLayout,
        show_shortcut_hints: draft.showShortcutHints,
        show_ai_suggestions: draft.showAiSuggestions,
        collapse_context_summary: draft.collapseContextSummary,
        show_word_count: draft.showWordCount,
        analytics_enabled: draft.analyticsEnabled,
        // TODO(#191): restore share_document_analytics prop when re-enabled
        // share_document_analytics: draft.shareDocumentAnalytics,
        check_for_updates: draft.checkForUpdates,
    });
    onclose();
}

function discard() {
    applySettings(savedSnapshot);
    dictionaryWords = [...savedDictionaryWords];
    onclose();
}

function tryClose() {
    if (isDirty) {
        triggerAlert();
    } else {
        onclose();
    }
}

function triggerAlert() {
    alertKey += 1;
    alerting = true;
    setTimeout(() => {
        alerting = false;
    }, 1400);
}

function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) tryClose();
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        e.preventDefault();
        tryClose();
    }
}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="settings-modal"
    onclick={handleBackdropClick}
>
    <div bind:this={innerEl} class="settings-modal-inner">
        <!-- Shake wrapper -->
        <div class="settings-shake-wrapper {alerting ? 'settings-shaking' : ''}">

        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.06] shrink-0">
            <div class="flex items-baseline gap-3">
                <div class="flex items-baseline gap-1.5">
                    <h2 class="text-[13px] font-semibold text-black/60">Settings</h2>
                    <span class="text-[11px] text-black/30 font-medium leading-none">{typeof __APP_VERSION__ === "string" ? `v${__APP_VERSION__}` : "dev"}</span>
                </div>
                <div class="settings-tab-track" bind:this={tabTrackEl} style={tabPillStyle}>
                    <div class="settings-tab-pill"><div class="settings-tab-pill-inner"></div></div>
                    <button
                        onclick={() => activeTab = "basic"}
                        class="settings-tab-btn outline-none {activeTab === 'basic' ? 'settings-tab-btn-active' : ''}"
                    >Basic</button>
                    <button
                        onclick={() => activeTab = "advanced"}
                        class="settings-tab-btn outline-none {activeTab === 'advanced' ? 'settings-tab-btn-active' : ''}"
                    >Advanced</button>
                </div>
            </div>
            <div class="flex items-center gap-1.5">
                {#if changelogVersions.length > 0}
                    <div class="whats-new-dropdown relative flex items-stretch">
                        <button
                            onclick={() => openChangelog()}
                            class="text-[10px] font-medium pl-2.5 pr-2 py-1 rounded-l-md bg-blue-500/[0.08] text-blue-700 border border-blue-500/[0.12] hover:bg-blue-500/[0.15] transition-colors"
                        >
                            What's New
                        </button>
                        <button
                            onclick={() => (whatsNewOpen = !whatsNewOpen)}
                            aria-label="Browse previous changelogs"
                            aria-expanded={whatsNewOpen}
                            class="flex items-center px-1 rounded-r-md bg-blue-500/[0.08] text-blue-700 border border-l-0 border-blue-500/[0.12] hover:bg-blue-500/[0.15] transition-colors"
                        >
                            <ChevronDown size={12} class="transition-transform {whatsNewOpen ? 'rotate-180' : ''}" />
                        </button>
                        {#if whatsNewOpen}
                            <div
                                class="absolute top-full right-0 mt-1 w-44 max-h-64 overflow-y-auto rounded-lg bg-white shadow-lg border border-black/[0.08] py-1 z-10"
                            >
                                {#each changelogVersions as { version, date } (version)}
                                    <button
                                        onclick={() => openChangelog(version)}
                                        class="w-full flex items-baseline justify-between gap-2 px-3 py-1.5 text-left hover:bg-blue-500/[0.06] transition-colors"
                                    >
                                        <span class="text-[11px] font-medium text-black/70">v{version}</span>
                                        <span class="text-[10px] text-black/35">{date}</span>
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/if}
                <button
                    onclick={tryClose}
                    aria-label="Close settings"
                    class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-black/25 hover:text-black/55 hover:bg-black/5 transition-colors"
                >
                    <span class="text-[9px] font-mono text-black/20 leading-none">esc</span>
                    <X size={15} />
                </button>
            </div>
        </div>

        <!-- Body -->
        <div bind:this={bodyEl} class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-0">
            <PrivacySection {draft} onchange={handleChange} />

            <div class="section-divider"></div>

            <SearchSection />

            <div class="section-divider"></div>

            <AppearanceSection {draft} onchange={handleChange} onFontGuide={(tab) => (showFontGuide = tab)} />

            <div class="section-divider"></div>

            <WritingSection {draft} onchange={handleChange} advanced={activeTab === "advanced"} />

            <div class="section-divider"></div>

            <DictionarySection bind:words={dictionaryWords} />

            {#if activeTab === "advanced"}
                <TitleSection {draft} onchange={handleChange} />

                <div class="section-divider"></div>

                <EditorSection {draft} onchange={handleChange} />

                <div class="section-divider"></div>

                <AISection {draft} onchange={handleChange} />

                {#if draft.aiEnabled}
                    <QuickActionsSection {draft} bind:selectedPanel />
                {/if}
            {/if}
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between gap-2 px-5 py-3 border-t border-black/[0.06] shrink-0">
            <div class="flex items-center gap-3">
                <button
                    onclick={() => {
                        // Close settings first so the centered survey isn't behind it.
                        // General feedback → survey. Fall back to the bug form if
                        // surveys are unavailable (opted out / no ID configured),
                        // so the button is never a no-op.
                        onclose();
                        if (!showFeedbackSurvey("settings")) openUrl(FEEDBACK_FORM_URL);
                    }}
                    class="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md bg-amber-400/20 text-amber-700 border border-amber-400/30 hover:bg-amber-400/30 transition-colors"
                >
                    <MessageSquare size={12} />
                    Send Feedback
                </button>
                <button
                    onclick={() => openUrl(FEEDBACK_FORM_URL)}
                    class="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md text-black/40 hover:text-black/60 transition-colors"
                >
                    <Bug size={12} />
                    Report a bug
                </button>
                <button
                    onclick={() => {
                        // Close settings first so the licenses modal isn't stacked behind it.
                        appEventBus.emit({ type: "show-licenses" });
                        onclose();
                    }}
                    class="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md text-black/40 hover:text-black/60 transition-colors"
                >
                    <Scale size={12} />
                    Licenses
                </button>
                <span class="text-[11px] text-rose-400/80 transition-opacity duration-200 {isDirty ? 'opacity-100' : 'opacity-0'}">
                    Unsaved
                </span>
            </div>
            <div class="flex items-center gap-2">
                <button
                    onclick={discard}
                    class="text-xs text-black/40 hover:text-black/60 transition-colors px-2 py-1"
                >Cancel</button>
                {#key alertKey}
                    <button
                        onclick={save}
                        class="text-xs text-white transition-colors px-3 py-1.5 rounded-full font-medium {alertKey > 0 ? 'save-alert' : ''} {isDirty ? 'bg-blue-500 hover:bg-blue-600' : 'bg-blue-500/50 hover:bg-blue-500/70'}"
                    >Save</button>
                {/key}
            </div>
        </div>

        </div><!-- end shake wrapper -->
    </div>
</dialog>

{#if showFontGuide}
    <FontGuideModal tab={showFontGuide} onclose={() => showFontGuide = null} />
{/if}


<style>
    .settings-modal {
        border: none;
        padding: 0;
        background: transparent;
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .settings-modal::backdrop {
        background: rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(4px);
    }

    .settings-modal-inner {
        position: relative;
        width: 640px;
        height: 72vh;
        max-height: 82vh;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.2);
        overflow: hidden;
    }

    /* Tab switcher — matches FontGuide tab style */
    .settings-tab-track {
        position: relative;
        display: flex;
        gap: 2px;
        background: rgba(180, 180, 180, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.35);
        border-radius: 999px;
        padding: 3px;
        backdrop-filter: blur(8px);
        /* overflow-hidden clips the backdrop-blur to the rounded corner — WebKit won't otherwise */
        overflow: hidden;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.08);
    }

    /* Two layers: outer carries the drop shadow + radius (no overflow → shadow stays
       rounded); inner carries backdrop-blur + radius + overflow-hidden (clips the blur
       to the corner). In WebKit a single element with backdrop-filter + radius +
       overflow-hidden + box-shadow squares the shadow at the corners; splitting avoids
       it while still clipping the blur. */
    .settings-tab-pill {
        position: absolute;
        top: 3px;
        left: 3px;
        height: calc(100% - 6px);
        border-radius: 999px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        transition: transform 0.25s cubic-bezier(0.34, 1.2, 0.64, 1), width 0.25s cubic-bezier(0.34, 1.2, 0.64, 1);
        width: var(--tab-pill-width, 72px);
        transform: translateX(var(--tab-pill-x, 0px));
    }

    .settings-tab-pill-inner {
        width: 100%;
        height: 100%;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(8px);
        /* overflow-hidden clips the backdrop-blur to the rounded corner — WebKit won't otherwise */
        overflow: hidden;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
    }

    .settings-tab-btn {
        position: relative;
        font-size: 11px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.4);
        padding: 2px 10px;
        border-radius: 999px;
        transition: color 0.2s;
        cursor: pointer;
        z-index: 1;
    }

    .settings-tab-btn:hover {
        color: rgba(0, 0, 0, 0.55);
    }

    .settings-tab-btn-active {
        color: rgba(0, 0, 0, 0.7);
    }

    /* Shake animation — same curve as annotation pending-shake */
    @keyframes settings-shake {
        0%   { transform: translateX(0); }
        10%  { transform: translateX(-6px); }
        20%  { transform: translateX(6px); }
        30%  { transform: translateX(-5px); }
        40%  { transform: translateX(5px); }
        50%  { transform: translateX(-3px); }
        60%  { transform: translateX(3px); }
        70%  { transform: translateX(-1px); }
        80%  { transform: translateX(1px); }
        100% { transform: translateX(0); }
    }

    .settings-shake-wrapper {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .settings-shaking {
        animation: settings-shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
    }

    /* Fading red ring on Save button */
    .save-alert {
        animation: save-ring-fade 1.4s ease-out both;
    }

    @keyframes save-ring-fade {
        0%   { box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.85); }
        70%  { box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.85); }
        100% { box-shadow: 0 0 0 0px rgba(251, 113, 133, 0); }
    }
</style>
