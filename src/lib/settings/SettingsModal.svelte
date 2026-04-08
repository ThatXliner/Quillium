<!--
    SettingsModal.svelte — Full settings dialog modal.

    Opens as a <dialog> element. Provides controls for document font,
    document font size, UI font, and the select-text-in-nested-editor toggle.

    Live apply: every change is applied immediately via applySettings().
    Save: persists to localStorage. Close without saving: shake +
    fading red ring on the modal (same pattern as annotation alerts).
    Unsaved changes revert on discard.

    Props:
      - onclose: () => void — called when the modal is fully dismissed.
-->
<script lang="ts">
import {
    X,
    Settings2,
    Check,
    ChevronDown,
    Plus,
    Trash2,
    HelpCircle,
    MessageSquare,
} from "lucide-svelte";
import { appSettings, applySettings, persistSettings } from "$lib/settings.svelte";
import type { CustomQuickAction } from "$lib/settings.svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FEEDBACK_FORM_URL } from "$lib/constants";
import { syncAnalyticsOptOut, syncShareDocumentAnalytics } from "$lib/posthog";
import posthog from "$lib/posthog";
import FontGuideModal from "./FontGuideModal.svelte";
import { FONTS } from "./fonts";
import changelog from "$lib/changelog.json";
import ChangelogModal from "$lib/ui/ChangelogModal.svelte";

const { onclose, scrollTo }: { onclose: () => void; scrollTo?: string } = $props();

type FontOption = {
    label: string;
    value: string;
    sample?: string;
    group?: string;
    featured?: boolean;
};

function firstInstalled(...names: string[]): { label: string; cssName: string } {
    for (const name of names) {
        if (document.fonts.check(`12px "${name}"`)) return { label: name, cssName: `"${name}"` };
    }
    // None found — use the last as the labeled fallback
    const last = names[names.length - 1];
    return { label: last, cssName: `"${last}"` };
}
const PLACEHOLDER =
    Math.random() < 0.2
        ? "Sphinx of black quartz, judge my vow"
        : "The quick brown fox jumps over the lazy dog";
const mono = firstInstalled(
    "SF Mono",
    "JetBrains Mono",
    "Cascadia Code",
    "Fira Code",
    "Consolas",
    "Menlo",
);
const sans = firstInstalled("SF Pro Text", "Inter", "Segoe UI", "Helvetica Neue");

const monoStack = `${mono.cssName}, ui-monospace, monospace`;
const sansStack = `${sans.cssName}, system-ui, sans-serif`;

// Map static font data into picker FontOption shape, then inject the two
// runtime-resolved system entries (system sans + system mono).
const DOC_FONTS: FontOption[] = [
    ...FONTS.filter((f) => f.docFont).map((f) => ({
        label: f.name,
        value: f.cssFamily,
        sample: f.sample,
        group: f.group,
        featured: f.docFeatured,
    })),
    { group: "Sans", label: sans.label, value: sansStack },
    { group: "Typewriter", label: mono.label, value: monoStack },
];

const UI_FONTS: FontOption[] = [
    // System fonts come first as featured picks
    {
        featured: true,
        group: "Sans",
        label: sans.label,
        value: sansStack,
        sample: "Crisp system default",
    },
    {
        featured: true,
        group: "Mono",
        label: mono.label,
        value: monoStack,
        sample: "Crisp monospace precision",
    },
    ...FONTS.filter((f) => f.uiFont || f.uiFeatured).map((f) => ({
        label: f.name,
        value: f.cssFamily,
        sample: f.sample,
        group: f.group,
        featured: f.uiFeatured,
    })),
];

// Local draft — a shallow copy of persisted settings
let draft = $state({ ...appSettings });

// Snapshot of what was persisted when the modal opened (for discard)
const savedSnapshot = { ...appSettings };

let isDirty = $derived(JSON.stringify(draft) !== JSON.stringify(savedSnapshot));

// Quick actions state
let selectedPanel = $state<"revise" | "feedback" | "chat">("revise");
let newActionLabel = $state("");
let newActionPrompt = $state("");
let panelActions = $derived(
    (draft.customQuickActions ?? []).filter((a) => a.panel === selectedPanel),
);

function addQuickAction() {
    if (!newActionLabel.trim() || !newActionPrompt.trim()) return;
    draft.customQuickActions = [
        ...(draft.customQuickActions ?? []),
        { label: newActionLabel.trim(), prompt: newActionPrompt.trim(), panel: selectedPanel },
    ];
    newActionLabel = "";
    newActionPrompt = "";
}

function removeQuickAction(index: number) {
    const allActions = draft.customQuickActions ?? [];
    // index is relative to panelActions; find absolute index
    const panelItems = allActions
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a.panel === selectedPanel);
    const absIndex = panelItems[index]?.i;
    if (absIndex === undefined) return;
    draft.customQuickActions = allActions.filter((_, i) => i !== absIndex);
}

let dialogEl = $state<HTMLDialogElement | undefined>(undefined);
let innerEl = $state<HTMLDivElement | undefined>(undefined);

// Shake + ring state — key increments each trigger so CSS animation replays
let alertKey = $state(0);
let alerting = $state(false);

declare const __APP_VERSION__: string;

function getChangelogEntry(): { date: string; content: string; version: string } | null {
    const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
    if (appVersion === "dev") return null;
    const parts = appVersion.split(".");
    const currentMinor = `${parts[0]}.${parts[1]}`;
    const entry = (changelog as Record<string, { date: string; content: string }>)[currentMinor];
    if (!entry) return null;
    return { ...entry, version: currentMinor };
}

let showChangelogFromSettings = $state(false);
const currentChangelog = getChangelogEntry();

// Which custom dropdown is open: "doc" | "ui" | null
let openDropdown = $state<"doc" | "ui" | null>(null);
let showFontGuide = $state<"doc" | "ui" | null>(null);

$effect(() => {
    if (dialogEl && !dialogEl.open) {
        dialogEl.showModal();
        posthog.capture("settings_opened");

        if (scrollTo) {
            // Wait a tick for the dialog layout to settle
            requestAnimationFrame(() => {
                const target = dialogEl?.querySelector(`[data-setting-id="${scrollTo}"]`);
                if (!target) return;
                target.scrollIntoView({ behavior: "smooth", block: "center" });
                target.classList.add("setting-flash");
                target.addEventListener(
                    "animationend",
                    () => target.classList.remove("setting-flash"),
                    { once: true },
                );
            });
        }
    }
});

// Close dropdowns on outside click
$effect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest(".font-dropdown")) {
            openDropdown = null;
        }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
});

function handleChange() {
    applySettings(draft);
}

function save() {
    const analyticsChanged = appSettings.analyticsEnabled !== draft.analyticsEnabled;
    const shareDocChanged =
        appSettings.shareDocumentAnalytics !== draft.shareDocumentAnalytics ||
        appSettings.shareDocumentKey !== draft.shareDocumentKey;
    Object.assign(appSettings, draft);
    persistSettings();
    if (analyticsChanged) {
        syncAnalyticsOptOut(draft.analyticsEnabled);
    }
    if (shareDocChanged) {
        syncShareDocumentAnalytics(draft.shareDocumentAnalytics, draft.shareDocumentKey);
    }
    posthog.capture("settings_saved", {
        ai_enabled: draft.aiEnabled,
        select_text_in_nested_editor: draft.selectTextInNestedEditor,
        show_nested_editor: draft.showNestedEditor,
        atomic_revisions: draft.atomicRevisions,
        doc_font_family: draft.docFontFamily,
        doc_font_size: draft.docFontSize,
        ui_font_family: draft.uiFontFamily,
        title_visibility: draft.titleVisibility,
        title_hover_delay: draft.titleHoverDelay,
        title_linger_duration: draft.titleLingerDuration,
        ui_zoom: draft.uiZoom,
        custom_quick_actions_count: draft.customQuickActions.length,
        auto_version_on_revision_create: draft.autoVersionOnRevisionCreate,
        show_shortcut_hints: draft.showShortcutHints,
        show_ai_suggestions: draft.showAiSuggestions,
        show_word_count: draft.showWordCount,
        analytics_enabled: draft.analyticsEnabled,
        share_document_analytics: draft.shareDocumentAnalytics,
    });
    onclose();
}

function discard() {
    applySettings(savedSnapshot);
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

function fontLabel(fonts: FontOption[], value: string) {
    return fonts.find((f) => f.value === value)?.label ?? fonts[0].label;
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
            <div class="flex items-center gap-2">
                <Settings2 size={14} class="text-black/35" />
                <h2 class="text-[13px] font-semibold text-black/60">Settings</h2>
            </div>
            <div class="flex items-center gap-1.5">
                {#if currentChangelog}
                    <button
                        onclick={() => { showChangelogFromSettings = true; }}
                        class="text-[10px] font-medium px-2.5 py-1 rounded-md bg-blue-500/[0.08] text-blue-700 border border-blue-500/[0.12] hover:bg-blue-500/[0.15] transition-colors"
                    >
                        What's New
                    </button>
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
        <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-0">

            <!-- DOCUMENT section -->
            <div class="section-label">Document</div>

            <!-- Font family row -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="flex items-center gap-1.5">
                        <div class="setting-title">Font family</div>
                        <button
                            onclick={() => showFontGuide = "doc"}
                            aria-label="Font guide"
                            class="text-black/25 hover:text-black/50 transition-colors"
                        >
                            <HelpCircle size={13} />
                        </button>
                    </div>
                    <div class="setting-desc">Editor font</div>
                </div>
                <!-- Custom dropdown -->
                <div class="flex items-center gap-2 shrink-0">
                {#if draft.docFontFamily !== "Georgia, serif"}
                    <button
                        type="button"
                        onclick={() => { draft.docFontFamily = "Georgia, serif"; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <div class="font-dropdown relative" role="none">
                    <button
                        onclick={() => openDropdown = openDropdown === "doc" ? null : "doc"}
                        class="dropdown-trigger {openDropdown === 'doc' ? 'dropdown-trigger-open' : ''}"
                    >
                        <span style="font-family: {draft.docFontFamily}; font-size: 13px;">{fontLabel(DOC_FONTS, draft.docFontFamily)}</span>
                        <ChevronDown size={11} class="text-black/35 transition-transform duration-150 {openDropdown === 'doc' ? 'rotate-180' : ''}" />
                    </button>
                    {#if openDropdown === "doc"}
                        <div class="dropdown-popover">
                            <div class="dropdown-section-label">Our Picks</div>
                            {#each DOC_FONTS.filter(f => f.featured) as font}
                                {@const selected = draft.docFontFamily === font.value}
                                <button
                                    class="dropdown-option {selected ? 'dropdown-option-active' : ''}"
                                    onclick={() => {
                                        draft.docFontFamily = font.value;
                                        openDropdown = null;
                                        handleChange();
                                    }}
                                >
                                    <div class="flex-1 min-w-0">
                                        <div class="dropdown-option-label" style="font-family: {font.value};">{font.label}</div>
                                        <div class="dropdown-option-sample" style="font-family: {font.value};">{font?.sample ?? PLACEHOLDER}</div>
                                    </div>
                                    {#if selected}
                                        <Check size={11} class="text-blue-500 shrink-0" />
                                    {/if}
                                </button>
                            {/each}
                            <div class="dropdown-divider"></div>
                            <div class="dropdown-section-label">All Fonts</div>
                            {#each DOC_FONTS.filter(f => !f.featured).sort((a, b) => a.label.localeCompare(b.label)) as font}
                                {@const selected = draft.docFontFamily === font.value}
                                <button
                                    class="dropdown-option {selected ? 'dropdown-option-active' : ''}"
                                    onclick={() => {
                                        draft.docFontFamily = font.value;
                                        openDropdown = null;
                                        handleChange();
                                    }}
                                >
                                    <div class="flex-1 min-w-0">
                                        <div class="dropdown-option-label" style="font-family: {font.value};">{font.label}</div>
                                        <div class="dropdown-option-sample" style="font-family: {font.value};">{PLACEHOLDER}</div>
                                    </div>
                                    {#if selected}
                                        <Check size={11} class="text-blue-500 shrink-0" />
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
                </div>
            </div>

            <!-- Font size row -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Font size</div>
                    <div class="setting-desc">Text size (14-24 px)</div>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <input
                        type="range"
                        min="14"
                        max="24"
                        step="1"
                        bind:value={draft.docFontSize}
                        oninput={handleChange}
                        class="w-28 accent-blue-500 cursor-pointer"
                    />
                    <span class="text-[12px] text-black/50 w-7 text-right tabular-nums">{draft.docFontSize}px</span>
                    {#if draft.docFontSize !== 18}
                        <button
                            type="button"
                            onclick={() => { draft.docFontSize = 18; handleChange(); }}
                            class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                        >Reset</button>
                    {/if}
                </div>
            </div>

            <!-- UI zoom row -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Zoom</div>
                    <div class="setting-desc">Scale the entire interface (Cmd+= / Cmd+-)</div>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <span class="text-[12px] text-black/50 tabular-nums">{Math.round(draft.uiZoom * 100)}%</span>
                    {#if draft.uiZoom !== 1}
                        <button
                            type="button"
                            onclick={() => { draft.uiZoom = 1; handleChange(); }}
                            class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                        >Reset to 100%</button>
                    {/if}
                </div>
            </div>

            <div class="section-divider"></div>

            <!-- INTERFACE section -->
            <div class="section-label">Interface</div>

            <!-- UI font row -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="flex items-center gap-1.5">
                        <div class="setting-title">UI font family</div>
                        <button
                            onclick={() => showFontGuide = "ui"}
                            aria-label="Font guide"
                            class="text-black/25 hover:text-black/50 transition-colors"
                        >
                            <HelpCircle size={13} />
                        </button>
                    </div>
                    <div class="setting-desc">UI font</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if draft.uiFontFamily !== sansStack}
                    <button
                        type="button"
                        onclick={() => { draft.uiFontFamily = sansStack; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <div class="font-dropdown relative" role="none">
                    <button
                        onclick={() => openDropdown = openDropdown === "ui" ? null : "ui"}
                        class="dropdown-trigger {openDropdown === 'ui' ? 'dropdown-trigger-open' : ''}"
                    >
                        <span style="font-family: {draft.uiFontFamily}; font-size: 13px;">{fontLabel(UI_FONTS, draft.uiFontFamily)}</span>
                        <ChevronDown size={11} class="text-black/35 transition-transform duration-150 {openDropdown === 'ui' ? 'rotate-180' : ''}" />
                    </button>
                    {#if openDropdown === "ui"}
                        <div class="dropdown-popover">
                            <div class="dropdown-section-label">Our Picks</div>
                            {#each UI_FONTS.filter(f => f.featured) as font}
                                {@const selected = draft.uiFontFamily === font.value}
                                <button
                                    class="dropdown-option {selected ? 'dropdown-option-active' : ''}"
                                    onclick={() => {
                                        draft.uiFontFamily = font.value;
                                        openDropdown = null;
                                        handleChange();
                                    }}
                                >
                                    <div class="flex-1 min-w-0">
                                        <div class="dropdown-option-label" style="font-family: {font.value};">{font.label}</div>
                                        <div class="dropdown-option-sample" style="font-family: {font.value};">{font?.sample ?? PLACEHOLDER}</div>
                                    </div>
                                    {#if selected}
                                        <Check size={11} class="text-blue-500 shrink-0" />
                                    {/if}
                                </button>
                            {/each}
                            <div class="dropdown-divider"></div>
                            <div class="dropdown-section-label">All Fonts</div>
                            {#each UI_FONTS.filter(f => !f.featured).sort((a, b) => a.label.localeCompare(b.label)) as font}
                                {@const selected = draft.uiFontFamily === font.value}
                                <button
                                    class="dropdown-option {selected ? 'dropdown-option-active' : ''}"
                                    onclick={() => {
                                        draft.uiFontFamily = font.value;
                                        openDropdown = null;
                                        handleChange();
                                    }}
                                >
                                    <div class="flex-1 min-w-0">
                                        <div class="dropdown-option-label" style="font-family: {font.value};">{font.label}</div>
                                        <div class="dropdown-option-sample" style="font-family: {font.value};">{PLACEHOLDER}</div>
                                    </div>
                                    {#if selected}
                                        <Check size={11} class="text-blue-500 shrink-0" />
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
                </div>
            </div>

            <div class="section-divider"></div>

            <!-- UI TWEAKS section -->
            <div class="section-label">UI Tweaks</div>

            <!-- Title visibility -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Document title</div>
                    <div class="setting-desc">When to show the title in the status bar</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if draft.titleVisibility !== "hover"}
                    <button
                        type="button"
                        onclick={() => { draft.titleVisibility = "hover"; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <div class="flex rounded-lg overflow-hidden border border-black/[0.09]">
                    {#each ([["hover", "On hover"], ["always", "Always"], ["never", "Never"]] as const) as [val, label]}
                        <button
                            onclick={() => { draft.titleVisibility = val; handleChange(); }}
                            class="px-3 py-1.5 text-[11px] font-medium transition-colors
                                {draft.titleVisibility === val
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-white text-black/50 hover:bg-black/[0.04]'}"
                        >{label}</button>
                    {/each}
                </div>
                </div>
            </div>

            <!-- Title hover delay -->
            <div class="setting-row {draft.titleVisibility !== 'hover' ? 'opacity-40 pointer-events-none' : ''}">
                <div class="setting-meta">
                    <div class="setting-title">Title hover delay</div>
                    <div class="setting-desc">How long to hover before the title appears (ms)</div>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <input
                        type="range"
                        min="0"
                        max="3000"
                        step="100"
                        bind:value={draft.titleHoverDelay}
                        oninput={handleChange}
                        class="w-28 accent-blue-500 cursor-pointer"
                    />
                    <span class="text-[12px] text-black/50 w-10 text-right tabular-nums">{draft.titleHoverDelay}ms</span>
                    {#if draft.titleHoverDelay !== 350}
                        <button
                            type="button"
                            onclick={() => { draft.titleHoverDelay = 350; handleChange(); }}
                            class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                        >Reset</button>
                    {/if}
                </div>
            </div>

            <!-- Title linger duration -->
            <div class="setting-row {draft.titleVisibility !== 'hover' ? 'opacity-40 pointer-events-none' : ''}">
                <div class="setting-meta">
                    <div class="setting-title">Title linger duration</div>
                    <div class="setting-desc">How long the title stays visible after editing stops (ms)</div>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <input
                        type="range"
                        min="500"
                        max="10000"
                        step="500"
                        bind:value={draft.titleLingerDuration}
                        oninput={handleChange}
                        class="w-28 accent-blue-500 cursor-pointer"
                    />
                    <span class="text-[12px] text-black/50 w-10 text-right tabular-nums">{draft.titleLingerDuration >= 1000 ? `${draft.titleLingerDuration / 1000}s` : `${draft.titleLingerDuration}ms`}</span>
                    {#if draft.titleLingerDuration !== 3000}
                        <button
                            type="button"
                            onclick={() => { draft.titleLingerDuration = 3000; handleChange(); }}
                            class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                        >Reset</button>
                    {/if}
                </div>
            </div>

            <div class="section-divider"></div>

            <!-- EDITOR section -->
            <div class="section-label">Editor</div>

            <!-- Show nested editor toggle -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Nested editor in revisions</div>
                    <div class="setting-desc">Inline editor inside revision cards</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if !draft.showNestedEditor}
                    <button
                        type="button"
                        onclick={() => { draft.showNestedEditor = true; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <button
                    role="switch"
                    aria-checked={draft.showNestedEditor}
                    aria-label="Toggle nested editor in revision card"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.showNestedEditor ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.showNestedEditor = !draft.showNestedEditor;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.showNestedEditor ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
                </div>
            </div>

            <!-- Atomic revisions toggle -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Atomic revisions</div>
                    <div class="setting-desc">Edit revision text only in the revision editor</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if !draft.atomicRevisions}
                    <button
                        type="button"
                        onclick={() => { draft.atomicRevisions = true; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <button
                    role="switch"
                    aria-checked={draft.atomicRevisions}
                    aria-label="Toggle atomic revisions"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.atomicRevisions ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.atomicRevisions = !draft.atomicRevisions;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.atomicRevisions ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
                </div>
            </div>

            <!-- Select text toggle -->
            <div class="setting-row {!draft.showNestedEditor ? 'opacity-40 pointer-events-none' : ''}">
                <div class="setting-meta">
                    <div class="setting-title">Select text in nested editor</div>
                    <div class="setting-desc">Highlight selected text when a revision opens</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if !draft.selectTextInNestedEditor}
                    <button
                        type="button"
                        onclick={() => { draft.selectTextInNestedEditor = true; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <button
                    role="switch"
                    aria-checked={draft.selectTextInNestedEditor}
                    aria-label="Toggle select text in nested editor"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.selectTextInNestedEditor ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.selectTextInNestedEditor = !draft.selectTextInNestedEditor;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.selectTextInNestedEditor ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
                </div>
            </div>

            <!-- Auto version on revision creation toggle -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Auto-create version on revision</div>
                    <div class="setting-desc">Automatically add a new empty version when creating a revision</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if !draft.autoVersionOnRevisionCreate}
                    <button
                        type="button"
                        onclick={() => { draft.autoVersionOnRevisionCreate = true; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <button
                    role="switch"
                    aria-checked={draft.autoVersionOnRevisionCreate}
                    aria-label="Toggle auto-create version on revision"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.autoVersionOnRevisionCreate ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.autoVersionOnRevisionCreate = !draft.autoVersionOnRevisionCreate;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.autoVersionOnRevisionCreate ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
                </div>
            </div>

            <!-- Shortcut hints toggle -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Shortcut hints</div>
                    <div class="setting-desc">Show a floating cheat-sheet of annotation shortcuts (comment, revision, dictionary) next to your text selection</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if !draft.showShortcutHints}
                    <button
                        type="button"
                        onclick={() => { draft.showShortcutHints = true; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <button
                    role="switch"
                    aria-checked={draft.showShortcutHints}
                    aria-label="Toggle shortcut hints"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.showShortcutHints ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.showShortcutHints = !draft.showShortcutHints;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.showShortcutHints ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
                </div>
            </div>

            <!-- AI suggestion decorations toggle -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">AI suggestion underlines</div>
                    <div class="setting-desc">Show green underlines in the editor for AI suggestions. When hidden, suggestions still appear in the sidebar.</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if !draft.showAiSuggestions}
                    <button
                        type="button"
                        onclick={() => { draft.showAiSuggestions = true; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <button
                    role="switch"
                    aria-checked={draft.showAiSuggestions}
                    aria-label="Toggle AI suggestion underlines"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.showAiSuggestions ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.showAiSuggestions = !draft.showAiSuggestions;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.showAiSuggestions ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
                </div>
            </div>

            <!-- Word count overlay toggle -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Word count overlay</div>
                    <div class="setting-desc">Show a floating word/character count pill (click it to change display mode)</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if !draft.showWordCount}
                    <button
                        type="button"
                        onclick={() => { draft.showWordCount = true; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <button
                    role="switch"
                    aria-checked={draft.showWordCount}
                    aria-label="Toggle word count overlay"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.showWordCount ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.showWordCount = !draft.showWordCount;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.showWordCount ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
                </div>
            </div>

            <div class="section-divider"></div>

            <!-- PRIVACY section -->
            <div class="section-label">Privacy</div>

            <!-- Analytics toggle -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title flex items-center gap-1.5">
                        Usage analytics
                        <button
                            onclick={() => openUrl("https://quillium.bryanhu.com/privacy")}
                            aria-label="Privacy policy and your data rights"
                            title="Privacy policy and your data rights"
                            class="text-black/25 hover:text-black/50 transition-colors"
                        >
                            <HelpCircle size={13} />
                        </button>
                    </div>
                    <div class="setting-desc">Help improve Quillium by sending anonymous usage data</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if !draft.analyticsEnabled}
                    <button
                        type="button"
                        onclick={() => { draft.analyticsEnabled = true; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <button
                    role="switch"
                    aria-checked={draft.analyticsEnabled}
                    aria-label="Toggle usage analytics"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.analyticsEnabled ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.analyticsEnabled = !draft.analyticsEnabled;
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.analyticsEnabled ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
                </div>
            </div>

            <!-- Share document toggle (only relevant when analytics are on) -->
            {#if draft.analyticsEnabled}
            <div class="setting-row" data-setting-id="share-document-analytics">
                <div class="setting-meta">
                    <div class="setting-title">Share your document</div>
                    <div class="setting-desc">Enable to share your document contents with analytics when making a bug report.</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                {#if draft.shareDocumentAnalytics}
                    <button
                        type="button"
                        onclick={() => { draft.shareDocumentAnalytics = false; draft.shareDocumentKey = ""; handleChange(); }}
                        class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                    >Reset</button>
                {/if}
                <button
                    role="switch"
                    aria-checked={draft.shareDocumentAnalytics}
                    aria-label="Toggle document sharing"
                    class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                        {draft.shareDocumentAnalytics ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                    onclick={() => {
                        draft.shareDocumentAnalytics = !draft.shareDocumentAnalytics;
                        if (!draft.shareDocumentAnalytics) draft.shareDocumentKey = "";
                        handleChange();
                    }}
                >
                    <span
                        class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                            transition-transform duration-200
                            {draft.shareDocumentAnalytics ? 'translate-x-4' : 'translate-x-0'}"
                    ></span>
                </button>
                </div>
            </div>
            {#if draft.shareDocumentAnalytics}
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Incident code</div>
                    <div class="setting-desc">Paste the code from the notification so we can match your document to the issue.</div>
                </div>
                <input
                    type="text"
                    bind:value={draft.shareDocumentKey}
                    oninput={handleChange}
                    placeholder="e.g. QIR-7K3P"
                    class="w-40 px-2 py-1 text-sm rounded border border-black/10 bg-white/50
                        focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30
                        placeholder:text-black/30"
                />
            </div>
            {/if}
            {/if}

            <div class="section-divider"></div>

            <!-- AI section -->
            <div class="section-label">AI</div>

            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title flex items-center gap-1.5">
                        Enable AI features
                        <button
                            onclick={() => openUrl("https://quillium.bryanhu.com/blog/ai-is-not-the-point")}
                            aria-label="Why is this off by default?"
                            title="Why is this off by default?"
                            class="text-black/25 hover:text-black/50 transition-colors"
                        >
                            <HelpCircle size={13} />
                        </button>
                    </div>
                    <div class="setting-desc">Show AI sidebar, auto-AI collaborator, and AI-powered tools</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <button
                        role="switch"
                        aria-checked={draft.aiEnabled}
                        aria-label="Toggle AI features"
                        class="relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200
                            {draft.aiEnabled ? 'bg-blue-500' : 'bg-black/[0.15]'}"
                        onclick={() => {
                            draft.aiEnabled = !draft.aiEnabled;
                            handleChange();
                        }}
                    >
                        <span
                            class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                                transition-transform duration-200
                                {draft.aiEnabled ? 'translate-x-4' : 'translate-x-0'}"
                        ></span>
                    </button>
                </div>
            </div>

            <!-- QUICK ACTIONS section (AI-dependent) -->
            {#if draft.aiEnabled}
            <div class="section-divider"></div>
            <div class="section-label">Quick Actions</div>

            <!-- Panel selector -->
            <div class="setting-row">
                <div class="setting-meta">
                    <div class="setting-title">Panel</div>
                    <div class="setting-desc">Add chips to a specific AI panel</div>
                </div>
                <div class="flex rounded-lg overflow-hidden border border-black/[0.09] shrink-0">
                    {#each (["revise", "feedback", "chat"] as const) as panel}
                        <button
                            onclick={() => { selectedPanel = panel; }}
                            class="px-3 py-1.5 text-[11px] font-medium capitalize transition-colors
                                {selectedPanel === panel
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-white text-black/50 hover:bg-black/[0.04]'}"
                        >{panel}</button>
                    {/each}
                </div>
            </div>

            <!-- Existing chips for selected panel -->
            {#if panelActions.length > 0}
                <div class="flex flex-col gap-1 mb-2">
                    {#each panelActions as action, i}
                        <div class="flex items-start gap-2 px-2 py-2 rounded-lg bg-black/[0.02] border border-black/[0.05]">
                            <div class="flex-1 min-w-0">
                                <div class="text-[12px] font-medium text-black/70 truncate">{action.label}</div>
                                <div class="text-[11px] text-black/38 mt-0.5 line-clamp-2 leading-snug">{action.prompt}</div>
                            </div>
                            <button
                                onclick={() => removeQuickAction(i)}
                                aria-label="Remove quick action"
                                class="shrink-0 mt-0.5 p-1 rounded text-black/25 hover:text-red-400 hover:bg-red-50 transition-colors"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    {/each}
                </div>
            {:else}
                <div class="text-[11px] text-black/30 px-0.5 mb-2">No custom chips for this panel yet.</div>
            {/if}

            <!-- Add new chip form -->
            <div class="flex flex-col gap-1.5 px-0.5">
                <input
                    bind:value={newActionLabel}
                    placeholder="Label (shown on chip)"
                    class="w-full px-2.5 py-1.5 text-[12px] border border-black/[0.1] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-black/25"
                />
                <textarea
                    bind:value={newActionPrompt}
                    placeholder="Full prompt sent to AI…"
                    rows="2"
                    class="w-full px-2.5 py-1.5 text-[12px] border border-black/[0.1] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none placeholder:text-black/25"
                ></textarea>
                <button
                    onclick={addQuickAction}
                    disabled={!newActionLabel.trim() || !newActionPrompt.trim()}
                    class="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-medium
                        bg-blue-500/80 text-white rounded-lg hover:bg-blue-600/80 transition-colors
                        disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Plus size={12} />
                    Add chip
                </button>
            </div>
            {/if}

        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between gap-2 px-5 py-3 border-t border-black/[0.06] shrink-0">
            <div class="flex items-center gap-3">
                <button
                    onclick={() => openUrl(FEEDBACK_FORM_URL)}
                    class="flex items-center gap-1.5 text-[11px] text-black/30 hover:text-black/55 transition-colors"
                >
                    <MessageSquare size={12} />
                    Send Feedback
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

{#if showChangelogFromSettings && currentChangelog}
    <ChangelogModal
        date={currentChangelog.date}
        content={currentChangelog.content}
        version={currentChangelog.version}
        ondismiss={() => { showChangelogFromSettings = false; }}
    />
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

    /* Section labels */
    .section-label {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(0, 0, 0, 0.35);
        margin-top: 0.25rem;
        margin-bottom: 0.5rem;
        padding: 0 0.125rem;
    }

    .section-divider {
        height: 1px;
        background: rgba(0, 0, 0, 0.05);
        margin: 0.75rem 0;
    }

    /* Setting row */
    .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.5rem;
        padding: 0.5rem 0.125rem;
    }

    .setting-meta {
        flex: 1;
        min-width: 0;
    }

    .setting-title {
        font-size: 13px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.75);
        line-height: 1.3;
    }

    .setting-desc {
        font-size: 11px;
        color: rgba(0, 0, 0, 0.38);
        margin-top: 1px;
        line-height: 1.4;
    }

    /* Custom font dropdown trigger */
    .dropdown-trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px 5px 11px;
        background: rgba(0, 0, 0, 0.04);
        border: 1px solid rgba(0, 0, 0, 0.09);
        border-radius: 8px;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s, border-color 0.15s;
        min-width: 148px;
        justify-content: space-between;
    }

    .dropdown-trigger:hover {
        background: rgba(0, 0, 0, 0.07);
        border-color: rgba(0, 0, 0, 0.13);
    }

    .dropdown-trigger-open {
        background: rgba(0, 0, 0, 0.06);
        border-color: rgba(59, 130, 246, 0.4);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    /* Dropdown popover */
    .dropdown-popover {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        min-width: 200px;
        max-height: 280px;
        overflow-y: auto;
        background: white;
        border: 1px solid rgba(0, 0, 0, 0.09);
        border-radius: 10px;
        box-shadow:
            0 8px 24px -4px rgba(0, 0, 0, 0.12),
            0 2px 8px -2px rgba(0, 0, 0, 0.07);
        padding: 4px;
        z-index: 50;
    }

    .dropdown-option {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 7px 9px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.1s;
        text-align: left;
    }

    .dropdown-option:hover {
        background: rgba(0, 0, 0, 0.04);
    }

    .dropdown-option-active {
        background: rgba(59, 130, 246, 0.07);
    }

    .dropdown-option-active:hover {
        background: rgba(59, 130, 246, 0.1);
    }

    .dropdown-option-label {
        font-size: 12px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.7);
        line-height: 1.2;
    }

    .dropdown-option-sample {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.38);
        margin-top: 2px;
        line-height: 1.3;
    }

    .dropdown-section-label {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: rgba(0, 0, 0, 0.3);
        padding: 4px 9px 2px;
    }

    .dropdown-divider {
        height: 1px;
        background: rgba(0, 0, 0, 0.06);
        margin: 4px 0;
    }

    /* Flash animation for scroll-to-setting */
    @keyframes setting-flash {
        0%   { background: rgba(59, 130, 246, 0.18); }
        100% { background: transparent; }
    }
    :global(.setting-flash) {
        animation: setting-flash 1.5s ease-out;
        border-radius: 6px;
    }
</style>
