<!--
    AutoAIWidget.svelte — Fixed bottom-left AI collaborator bubble.

    Morphs between a circular bubble and an expanded settings card using the
    same transition-[width,height,border-radius] pattern as AISidebar.svelte.
    A single element expands — no swap between two elements.
-->
<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { aiProcessing, hasApiKey } from "$lib/ai/settings.svelte";
import {
    autoAISettings,
    persistAutoAISettings,
    type AutoAIAnnotationType,
    type AutoAIMode,
    type AutoAIConservativeness,
} from "./settings.svelte";
import { startAutoAI, stopAutoAI, triggerManualReview } from "./engine";

let popoverOpen = $state(false);
let widgetEl = $state<HTMLDivElement | null>(null);
let autoAIRunning = $state(autoAISettings.enabled);

function toggleEnabled() {
    autoAISettings.enabled = !autoAISettings.enabled;
    autoAIRunning = autoAISettings.enabled;
    persistAutoAISettings();
    if (autoAISettings.enabled) {
        startAutoAI();
    } else {
        stopAutoAI();
    }
}

function handleBubbleClick() {
    popoverOpen = !popoverOpen;
}

function handleManualReview() {
    popoverOpen = false;
    triggerManualReview();
}

function setMode(mode: AutoAIMode) {
    autoAISettings.mode = mode;
    persistAutoAISettings();
}

function setConservativeness(c: AutoAIConservativeness) {
    autoAISettings.conservativeness = c;
    persistAutoAISettings();
}

function toggleAnnotationType(type: AutoAIAnnotationType) {
    const idx = autoAISettings.annotationTypes.indexOf(type);
    if (idx === -1) {
        autoAISettings.annotationTypes = [...autoAISettings.annotationTypes, type];
    } else {
        autoAISettings.annotationTypes = autoAISettings.annotationTypes.filter((t) => t !== type);
    }
    persistAutoAISettings();
}

function handleDebounceInput(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!Number.isNaN(val) && val >= 2 && val <= 60) {
        autoAISettings.debounceMs = val * 1000;
        persistAutoAISettings();
    }
}

function handlePersonaInput(e: Event) {
    autoAISettings.persona = (e.target as HTMLInputElement).value;
    persistAutoAISettings();
}

function handleDocClick(e: MouseEvent) {
    if (!popoverOpen) return;
    if (widgetEl && !widgetEl.contains(e.target as Node)) {
        popoverOpen = false;
    }
}

onMount(() => {
    document.addEventListener("mousedown", handleDocClick);
    if (autoAISettings.enabled) startAutoAI();
});

onDestroy(() => {
    document.removeEventListener("mousedown", handleDocClick);
    stopAutoAI();
});

const isReviewing = $derived(autoAIRunning && aiProcessing.active);
const debounceSeconds = $derived(Math.round(autoAISettings.debounceMs / 1000));
const locked = $derived(!hasApiKey());
</script>

<!--
    Single morphing element. In bubble state: 40×40, border-radius:50%.
    In open state: 232px wide, auto height, border-radius:14px.
    The same transition-[width,height,border-radius] pattern as AISidebar.
-->
<div
    class="autoai-widget"
    class:open={popoverOpen}
    class:active={autoAIRunning && !locked}
    class:reviewing={isReviewing}
    class:locked
    bind:this={widgetEl}
    role="dialog"
    aria-label="AutoAI collaborator"
>
    <!-- Bubble icon — visible when closed, fades out when open -->
    <button
        class="bubble-face"
        class:hidden={popoverOpen}
        onclick={handleBubbleClick}
        tabindex={popoverOpen ? -1 : 0}
        aria-label={locked ? "AutoAI — add an API key in settings to enable" : autoAIRunning ? "AutoAI active — click to configure" : "AutoAI — click to enable"}
        title={locked ? "Add an API key in settings to use AutoAI" : undefined}
        aria-expanded={popoverOpen}
    >
        <!-- Quill icon -->
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13 2C13 2 10 3 8 6C6 9 6 13 6 13C6 13 7 11 9 10C11 9 13 8 13 8C13 8 11 9 10 11C9 13 9 14 9 14L7.5 14C7.5 14 7 12 7 10C7 8 8 5 10 4C12 3 13 2 13 2Z" fill="currentColor" opacity="0.85"/>
            <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.4"/>
        </svg>
    </button>

    <!-- Expanded content — fades in when open -->
    <div class="panel-content" class:visible={popoverOpen} aria-hidden={!popoverOpen}>
        <!-- Header -->
        <div class="panel-header">
            <div class="header-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13 2C13 2 10 3 8 6C6 9 6 13 6 13C6 13 7 11 9 10C11 9 13 8 13 8C13 8 11 9 10 11C9 13 9 14 9 14L7.5 14C7.5 14 7 12 7 10C7 8 8 5 10 4C12 3 13 2 13 2Z" fill="currentColor" opacity="0.85"/>
                    <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.4"/>
                </svg>
            </div>
            <div class="header-text">
                <span class="header-name">{autoAISettings.persona}</span>
                <span class="header-sub">
                    {#if isReviewing}
                        Reviewing…
                    {:else if autoAIRunning}
                        Active · every {debounceSeconds}s
                    {:else}
                        Paused
                    {/if}
                </span>
            </div>
            <button
                class="toggle-btn"
                class:on={autoAISettings.enabled && !locked}
                onclick={locked ? undefined : toggleEnabled}
                disabled={locked}
                aria-label={locked ? "Add an API key to enable AutoAI" : autoAISettings.enabled ? "Pause AutoAI" : "Enable AutoAI"}
            >
                <span class="toggle-knob"></span>
            </button>
            <button class="close-btn" onclick={handleBubbleClick} aria-label="Close">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </button>
        </div>

        {#if locked}
            <p class="locked-notice">Add an API key in settings to enable AutoAI.</p>
        {:else if autoAISettings.mode === "manual" && autoAISettings.enabled}
            <button class="review-now-btn" onclick={handleManualReview}>
                Review now
            </button>
        {/if}

        <hr class="divider" />

        <div class="popover-field">
            <label class="field-label" for="autoai-persona">NAME</label>
            <input
                id="autoai-persona"
                class="field-input"
                type="text"
                value={autoAISettings.persona}
                oninput={handlePersonaInput}
                maxlength={20}
                tabindex={popoverOpen ? 0 : -1}
            />
        </div>

        <div class="popover-field">
            <span class="field-label">MODE</span>
            <div class="segment-ctrl">
                <button class="seg-btn" class:seg-active={autoAISettings.mode === "continuous"} onclick={() => setMode("continuous")} tabindex={popoverOpen ? 0 : -1}>Continuous</button>
                <button class="seg-btn" class:seg-active={autoAISettings.mode === "manual"} onclick={() => setMode("manual")} tabindex={popoverOpen ? 0 : -1}>Manual</button>
            </div>
        </div>

        {#if autoAISettings.mode === "continuous"}
            <div class="popover-field">
                <label class="field-label" for="autoai-debounce">DELAY: {debounceSeconds}S</label>
                <input
                    id="autoai-debounce"
                    class="field-range"
                    type="range"
                    min="2"
                    max="60"
                    value={debounceSeconds}
                    oninput={handleDebounceInput}
                    tabindex={popoverOpen ? 0 : -1}
                />
            </div>
        {/if}

        <div class="popover-field">
            <span class="field-label">FOCUS</span>
            <div class="segment-ctrl">
                {#each (["conservative", "balanced", "thorough"] as AutoAIConservativeness[]) as level}
                    <button
                        class="seg-btn"
                        class:seg-active={autoAISettings.conservativeness === level}
                        onclick={() => setConservativeness(level)}
                        tabindex={popoverOpen ? 0 : -1}
                    >{level[0].toUpperCase() + level.slice(1)}</button>
                {/each}
            </div>
        </div>

        <div class="popover-field">
            <span class="field-label">ANNOTATE WITH</span>
            <div class="checkbox-row">
                {#each (["comment", "suggestion", "revision"] as AutoAIAnnotationType[]) as type}
                    <label class="checkbox-label">
                        <input
                            type="checkbox"
                            checked={autoAISettings.annotationTypes.includes(type)}
                            onchange={() => toggleAnnotationType(type)}
                            tabindex={popoverOpen ? 0 : -1}
                        />
                        {type[0].toUpperCase() + type.slice(1)}s
                    </label>
                {/each}
            </div>
        </div>
    </div>
</div>

<style>
    /* ── Root morphing element ── */
    .autoai-widget {
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 40;

        /* Bubble state */
        width: 40px;
        height: 40px;
        border-radius: 20px;
        overflow: hidden;

        background: #faf8f5;
        border: 2px solid #d6b87a; /* warm amber — idle */
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.10);
        cursor: pointer;

        /* The morph: same pattern as AISidebar */
        transition:
            width 300ms cubic-bezier(0.33, 0, 0.2, 1),
            height 300ms cubic-bezier(0.33, 0, 0.2, 1),
            border-radius 300ms cubic-bezier(0.33, 0, 0.2, 1),
            box-shadow 200ms ease,
            border-color 300ms ease;
    }

    .autoai-widget.open {
        width: 232px;
        height: auto; /* content-driven */
        border-radius: 14px;
        border-color: #e8e0d4;
        cursor: default;
        box-shadow:
            0 4px 16px rgba(0, 0, 0, 0.10),
            0 1px 4px rgba(0, 0, 0, 0.06);
        overflow: visible; /* allow range thumb to render */
    }

    /* Locked state — muted, no amber */
    .autoai-widget.locked:not(.open) {
        border-color: #d1d5db;
        opacity: 0.6;
    }

    .autoai-widget.locked .bubble-face {
        color: #9ca3af;
    }

    /* Active (rainbow) border */
    .autoai-widget.active:not(.open) {
        border: 2px solid transparent;
        background:
            linear-gradient(#faf8f5, #faf8f5) padding-box,
            conic-gradient(from 0deg, #f59e0b, #ec4899, #8b5cf6, #3b82f6, #10b981, #f59e0b) border-box;
    }

    .autoai-widget.reviewing:not(.open) {
        animation: rainbow-spin 2s linear infinite;
    }

    @keyframes rainbow-spin {
        to {
            background:
                linear-gradient(#faf8f5, #faf8f5) padding-box,
                conic-gradient(from 360deg, #f59e0b, #ec4899, #8b5cf6, #3b82f6, #10b981, #f59e0b) border-box;
        }
    }

    /* ── Bubble face (icon, visible when closed) ── */
    .bubble-face {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #92681a;
        background: transparent;
        border: none;
        cursor: pointer;
        border-radius: inherit;
        transition: opacity 150ms ease, transform 150ms ease;
    }

    .bubble-face.hidden {
        opacity: 0;
        pointer-events: none;
        transform: scale(0.7);
    }

    .bubble-face:not(.hidden):hover {
        opacity: 0.8;
    }

    /* ── Expanded panel content ── */
    .panel-content {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 150ms ease 50ms; /* slight delay so morph starts first */
    }

    .panel-content.visible {
        opacity: 1;
        pointer-events: auto;
    }

    /* ── Header ── */
    .panel-header {
        display: flex;
        align-items: center;
        gap: 7px;
    }

    .header-icon {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1.5px solid #d6b87a;
        background: #faf8f5;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #92681a;
        flex-shrink: 0;
    }

    .header-text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
    }

    .header-name {
        font-size: 13px;
        font-weight: 600;
        color: #1f2937;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.2;
    }

    .header-sub {
        font-size: 10px;
        color: #9ca3af;
        white-space: nowrap;
    }

    .close-btn {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: #9ca3af;
        cursor: pointer;
        border-radius: 4px;
        padding: 0;
        flex-shrink: 0;
        transition: color 0.15s, background 0.15s;
    }

    .close-btn:hover {
        color: #6b7280;
        background: #f3f0eb;
    }

    /* ── Toggle ── */
    .toggle-btn {
        width: 30px;
        height: 17px;
        border-radius: 9px;
        background: #d1d5db;
        border: none;
        cursor: pointer;
        position: relative;
        transition: background 0.2s;
        padding: 0;
        flex-shrink: 0;
    }

    .toggle-btn.on {
        background: #f59e0b;
    }

    .toggle-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        transition: transform 0.2s;
    }

    .toggle-btn.on .toggle-knob {
        transform: translateX(13px);
    }

    /* ── Divider ── */
    .divider {
        border: none;
        border-top: 1px solid #ede8e0;
        margin: 0;
    }

    /* ── Locked notice ── */
    .locked-notice {
        font-size: 11px;
        color: #9ca3af;
        margin: 0;
        line-height: 1.4;
    }

    /* ── Review now ── */
    .review-now-btn {
        width: 100%;
        padding: 6px 0;
        border-radius: 8px;
        background: #fef3c7;
        border: 1px solid #fcd34d;
        color: #92400e;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
    }

    .review-now-btn:hover {
        background: #fde68a;
    }

    /* ── Fields ── */
    .popover-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .field-label {
        font-size: 10px;
        font-weight: 500;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }

    .field-input {
        font-size: 13px;
        border: 1px solid #e5ddd3;
        border-radius: 7px;
        padding: 5px 8px;
        background: white;
        color: #1f2937;
        outline: none;
        transition: border-color 0.15s;
    }

    .field-input:focus {
        border-color: #fcd34d;
    }

    .field-range {
        width: 100%;
        accent-color: #f59e0b;
    }

    /* ── Segmented control ── */
    .segment-ctrl {
        display: flex;
        border: 1px solid #e5ddd3;
        border-radius: 8px;
        overflow: hidden;
        background: white;
    }

    .seg-btn {
        flex: 1;
        padding: 5px 0;
        font-size: 11px;
        border: none;
        background: transparent;
        color: #6b7280;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
    }

    .seg-btn + .seg-btn {
        border-left: 1px solid #e5ddd3;
    }

    .seg-btn.seg-active {
        background: #fef3c7;
        color: #92400e;
        font-weight: 500;
    }

    /* ── Checkboxes ── */
    .checkbox-row {
        display: flex;
        gap: 10px;
    }

    .checkbox-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: #374151;
        cursor: pointer;
    }

    .checkbox-label input {
        accent-color: #f59e0b;
        cursor: pointer;
    }
</style>
