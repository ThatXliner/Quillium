<!--
    AutoAIWidget.svelte — Fixed bottom-left AI collaborator bubble.

    Two-pane layout when open:
      Left:  header (icon + name✏ + toggle + ×), status, mode seg, delay slider
      Right: annotation type pills (always visible, dimmed when off),
             divider, focus 3-stop slider with morphing label

    Morph pattern: single container, transition-[width,height,border-radius],
    two overlapping opacity layers, bubble fades out / panel fades in (+80ms delay).
-->
<script lang="ts">
import { hasApiKey } from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import Kbd from "$lib/ui/Kbd.svelte";
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";
import AutoAIFace, { type FaceState } from "./AutoAIFace.svelte";
import { autoAIPhase, startAutoAI, stopAutoAI, triggerManualReview } from "./engine";
import { createFaceAnimation } from "./faceAnimation.svelte";
import {
    type AutoAIAnnotationType,
    type AutoAIConservativeness,
    type AutoAIMode,
    autoAISettings,
    persistAutoAISettings,
} from "./settings.svelte";

let open = $state(false);
let editingName = $state(false);
let nameInputEl = $state<HTMLInputElement | null>(null);
let widgetEl = $state<HTMLDivElement | null>(null);
// Derived directly from the settings object so external mutations (e.g.
// AISettings.svelte disabling AutoAI when the API key is removed) are
// immediately reflected here without a separate manual sync step.
const autoAIRunning = $derived(autoAISettings.enabled);

const noApiKey = $derived(!hasApiKey());
const locked = $derived(noApiKey || !autoAIRunning);

// Playful face behavior (eye tracking, sleep/wake) lives in faceAnimation.
// It only cares about panel-open state and whether the engine is idle
// enough to allow sleep — the rest of the logic is self-contained.
const face = createFaceAnimation({
    getWidgetEl: () => widgetEl,
    getIsPanelOpen: () => open,
    getCanSleep: () => autoAIRunning && !noApiKey && get(autoAIPhase) === "idle",
});

const faceState = $derived<FaceState>(
    !hasApiKey()
        ? "disabled"
        : $autoAIPhase === "reviewing"
          ? "reviewing"
          : $autoAIPhase === "thinking"
            ? "thinking"
            : face.isWaking
              ? "waking"
              : face.isSleeping
                ? "sleeping"
                : face.isTracking
                  ? "tracking"
                  : "idle",
);
const isReviewing = $derived(autoAIRunning && $autoAIPhase === "reviewing");
const debounceSeconds = $derived(Math.round(autoAISettings.debounceMs / 1000));

// Focus slider: map conservativeness ↔ 0/1/2
const focusLevels: AutoAIConservativeness[] = ["conservative", "balanced", "thorough"];
const focusLabels: Record<AutoAIConservativeness, string> = {
    conservative: "Conservative",
    balanced: "Balanced",
    thorough: "Thorough",
};
const focusDescriptions: Record<AutoAIConservativeness, string> = {
    conservative: "Clear issues only",
    balanced: "Style & clarity too",
    thorough: "Reviews everything",
};
const focusIndex = $derived(focusLevels.indexOf(autoAISettings.conservativeness));

function handleFocusSlider(e: Event) {
    const idx = Number.parseInt((e.target as HTMLInputElement).value, 10);
    autoAISettings.conservativeness = focusLevels[idx];
    posthog.capture("autoai_settings_changed", { setting: "depth", value: focusLevels[idx] });
    persistAutoAISettings();
}

function toggleOpen() {
    open = !open;
    editingName = false;
    if (open) face.wakeSilently();
    else face.resetSleep();
}

function toggleEnabled() {
    if (noApiKey) return;
    autoAISettings.enabled = !autoAISettings.enabled;
    posthog.capture("autoai_toggled", { enabled: autoAISettings.enabled });
    persistAutoAISettings();
    if (autoAISettings.enabled) startAutoAI();
    else stopAutoAI();
}

function handleManualReview() {
    posthog.capture("autoai_manual_review_triggered");
    open = false;
    triggerManualReview();
}

function setMode(mode: AutoAIMode) {
    autoAISettings.mode = mode;
    posthog.capture("autoai_mode_changed", { mode });
    persistAutoAISettings();
}

function toggleAnnotationType(type: AutoAIAnnotationType) {
    const idx = autoAISettings.annotationTypes.indexOf(type);
    if (idx === -1) {
        autoAISettings.annotationTypes = [...autoAISettings.annotationTypes, type];
    } else {
        if (autoAISettings.annotationTypes.length === 1) return; // keep at least one
        autoAISettings.annotationTypes = autoAISettings.annotationTypes.filter((t) => t !== type);
    }
    posthog.capture("autoai_settings_changed", {
        setting: "annotation_types",
        value: autoAISettings.annotationTypes,
    });
    persistAutoAISettings();
}

function handleDebounceInput(e: Event) {
    const val = Number.parseInt((e.target as HTMLInputElement).value, 10);
    if (!Number.isNaN(val) && val >= 2 && val <= 60) {
        autoAISettings.debounceMs = val * 1000;
        persistAutoAISettings();
    }
}

function handlePersonaInput(e: Event) {
    autoAISettings.persona = (e.target as HTMLInputElement).value;
    persistAutoAISettings();
}

function startEditingName() {
    editingName = true;
    // Focus after tick
    setTimeout(() => nameInputEl?.focus(), 0);
}

function stopEditingName() {
    editingName = false;
}

function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === "Escape") stopEditingName();
}

function openSettings() {
    open = false;
    appEventBus.emit({ type: "ai-open-settings" });
}

function handleDocClick(e: MouseEvent) {
    if (!open) return;
    if (widgetEl && !widgetEl.contains(e.target as Node)) {
        open = false;
        face.resetSleep();
    }
}

onMount(() => {
    document.addEventListener("mousedown", handleDocClick);
    face.start();
    if (autoAISettings.enabled) startAutoAI();
});

onDestroy(() => {
    document.removeEventListener("mousedown", handleDocClick);
    face.stop();
    stopAutoAI();
});

const annotationPills = [
    { type: "comment" as AutoAIAnnotationType, label: "Comments", cls: "pill-comment" },
    { type: "suggestion" as AutoAIAnnotationType, label: "Suggestions", cls: "pill-suggestion" },
    { type: "revision" as AutoAIAnnotationType, label: "Revisions", cls: "pill-revision" },
];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={widgetEl}
    onclick={(e) => e.stopPropagation()}
    class="autoai-container {open ? 'w-[320px] h-[310px] rounded-[16px]' : 'w-[67px] h-[67px] rounded-[100px]'}
           {autoAIRunning && !locked && !open ? 'rainbow-active' : ''}
           {isReviewing && !open ? 'rainbow-reviewing' : ''}"
>
    <!-- Bubble layer -->
    <div class="layer {open ? 'opacity-0 pointer-events-none' : noApiKey ? 'opacity-50' : 'opacity-100'}
                flex items-center justify-center">
        <button
            onclick={toggleOpen}
            aria-label={noApiKey ? "AutoAI — add an API key to enable" : autoAIRunning ? "AutoAI active — click to configure" : "AutoAI paused — click to configure"}
            aria-expanded={open}
            class="w-full h-full flex items-center justify-center rounded-[inherit]
                   bg-transparent border-none cursor-pointer"
        >
            <AutoAIFace
                faceState={faceState}
                eyeOffsetX={face.eyeOffsetX}
                eyeOffsetY={face.eyeOffsetY}
            />
        </button>
    </div>

    <!-- Panel layer -->
    <div class="layer {open ? 'opacity-100 delay-[80ms]' : 'opacity-0 pointer-events-none'}">

        <!-- Header (spans full width) -->
        <div class="panel-header">
            <div class="flex items-center gap-[6px]">
                <div class="bubble-icon {autoAIRunning && !locked ? 'bubble-icon-active' : ''}">
                    <div style="transform: scale(0.38); transform-origin: center; width: 42px; height: 30px; display: flex; align-items: center; justify-content: center;">
                        <AutoAIFace faceState={faceState} eyeOffsetX={0} eyeOffsetY={0} />
                    </div>
                </div>
                <div class="flex items-center gap-[3px] flex-1 min-w-0">
                    {#if editingName}
                        <input
                            bind:this={nameInputEl}
                            class="name-input"
                            type="text"
                            value={autoAISettings.persona}
                            oninput={handlePersonaInput}
                            onblur={stopEditingName}
                            onkeydown={handleNameKeydown}
                            maxlength={20}
                        />
                    {:else}
                        <span class="name-text">{autoAISettings.persona}</span>
                        <button class="pencil-btn" onclick={startEditingName} aria-label="Edit name" tabindex={open ? 0 : -1}>
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    {/if}
                </div>
                <button
                    class="toggle-btn {autoAISettings.enabled && !noApiKey ? 'on' : ''}"
                    onclick={toggleEnabled}
                    disabled={noApiKey}
                    aria-label={noApiKey ? "Add an API key to enable" : autoAISettings.enabled ? "Pause" : "Enable"}
                ><span class="toggle-knob"></span></button>
                <button class="icon-btn" onclick={toggleOpen} aria-label="Close">
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                        <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>

            <!-- Status -->
            <p class="status-line">
                {#if noApiKey}<button class="settings-link" onclick={openSettings} tabindex={open ? 0 : -1}>Add an API key</button> to enable AutoAI.
                {:else if isReviewing}Reviewing…
                {:else if autoAIRunning && autoAISettings.mode === "continuous"}Active · every {debounceSeconds}s
                {:else if autoAIRunning}Active · on your call
                {:else}Paused{/if}
            </p>

            <div class="divider"></div>
        </div>

        <!-- Body (single column) -->
        <div class="panel-body">
            <!-- Mode + Delay (dimmed when no API key) -->
            <div class="{locked ? 'opacity-40 pointer-events-none' : ''}">
            <div class="field">
                <span class="field-label">MODE</span>
                <div class="seg-ctrl">
                    <button class="seg-btn {autoAISettings.mode === 'continuous' ? 'seg-active' : ''}"
                        onclick={() => setMode("continuous")} tabindex={open ? 0 : -1}>Auto</button>
                    <button class="seg-btn {autoAISettings.mode === 'manual' ? 'seg-active' : ''}"
                        onclick={() => setMode("manual")} tabindex={open ? 0 : -1}>Manual</button>
                </div>
                {#if autoAISettings.mode === "continuous"}
                    <span class="mode-hint">Reviews as you write</span>
                {:else if autoAISettings.enabled}
                    <button class="review-btn" onclick={handleManualReview} tabindex={open ? 0 : -1}>
                        Review now <Kbd keys={["⌘", "⇧", "R"]} />
                    </button>
                {/if}
            </div>

            <!-- Delay -->
            {#if autoAISettings.mode === "continuous"}
                <div class="field">
                    <div class="delay-label-row">
                        <label class="field-label" for="autoai-debounce">DELAY: {debounceSeconds}S</label>
                        {#if debounceSeconds !== 10}
                            <button class="text-[11px] text-blue-500 hover:text-blue-600 transition-colors cursor-pointer bg-none border-none p-0" onclick={() => { autoAISettings.debounceMs = 10000; persistAutoAISettings(); }} tabindex={open ? 0 : -1}>Reset</button>
                        {/if}
                    </div>
                    <input id="autoai-debounce" class="range" type="range" min="2" max="60"
                        value={debounceSeconds} oninput={handleDebounceInput} tabindex={open ? 0 : -1} />
                </div>
            {/if}
            </div>

            <div class="divider"></div>

            <!-- FIND: horizontal pills -->
            <div class="field">
                <span class="field-label">FIND</span>
                <div class="flex flex-row gap-[5px]">
                    {#each annotationPills as p}
                        <button
                            class="pill {autoAISettings.annotationTypes.includes(p.type) ? p.cls : 'pill-off'}"
                            onclick={() => toggleAnnotationType(p.type)}
                            tabindex={open ? 0 : -1}
                            aria-pressed={autoAISettings.annotationTypes.includes(p.type)}
                        >{p.label}</button>
                    {/each}
                </div>
            </div>

            <!-- DEPTH slider -->
            <div class="field">
                <div class="depth-header">
                    <span class="field-label">DEPTH</span>
                    <span class="depth-info">
                        <span class="focus-label">{focusLabels[autoAISettings.conservativeness]}</span>
                        <span class="focus-desc">{focusDescriptions[autoAISettings.conservativeness]}</span>
                    </span>
                </div>
                <div class="focus-slider-wrap">
                    <span class="focus-stop">○</span>
                    <input class="range focus-range" type="range" min="0" max="2"
                        value={focusIndex} oninput={handleFocusSlider} tabindex={open ? 0 : -1} />
                    <span class="focus-stop">○</span>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    /* ── Container ── */
    .autoai-container {
        position: relative;
        overflow: hidden;
        background: #faf8f5;
        border: 2px solid #d6b87a;
        box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.7),
            inset 0 -1px 0 rgba(0,0,0,0.04),
            0 4px 12px rgba(0,0,0,0.12),
            0 1px 3px rgba(0,0,0,0.08);
        backdrop-filter: blur(8px);
        transition:
            width 340ms cubic-bezier(0.33,0,0.2,1),
            height 340ms cubic-bezier(0.33,0,0.2,1),
            border-radius 340ms cubic-bezier(0.33,0,0.2,1),
            border-color 300ms ease,
            box-shadow 200ms ease;
    }

    .autoai-container.w-\[320px\] {
        border-color: #e8e0d4;
        box-shadow: 0 4px 16px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06);
        backdrop-filter: none;
    }

    .rainbow-active {
        border: 2px solid transparent;
        background:
            linear-gradient(#faf8f5,#faf8f5) padding-box,
            conic-gradient(from 0deg,#f59e0b,#ec4899,#8b5cf6,#3b82f6,#10b981,#f59e0b) border-box;
    }

    .rainbow-reviewing {
        border: 2px solid transparent;
        animation: rainbow-spin 2s linear infinite;
    }

    @keyframes rainbow-spin {
        from { background: linear-gradient(#faf8f5,#faf8f5) padding-box, conic-gradient(from 0deg,#f59e0b,#ec4899,#8b5cf6,#3b82f6,#10b981,#f59e0b) border-box; }
        to   { background: linear-gradient(#faf8f5,#faf8f5) padding-box, conic-gradient(from 360deg,#f59e0b,#ec4899,#8b5cf6,#3b82f6,#10b981,#f59e0b) border-box; }
    }

    /* ── Layers ── */
    .layer {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        transition: opacity 150ms ease;
    }

    /* ── Panel header (full-width) ── */
    .panel-header {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 12px 0;
    }

    /* ── Panel body (single column) ── */
    .panel-body {
        display: flex;
        flex-direction: column;
        flex: 1;
        gap: 8px;
        padding: 12px;
        min-height: 0;
    }



    /* ── Header elements ── */
    .bubble-icon {
        width: 22px; height: 22px;
        border-radius: 50%;
        border: 1.5px solid #d6b87a;
        background: #faf8f5;
        color: #92681a;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
    }

    .bubble-icon-active {
        border: 1.5px solid transparent;
        background:
            linear-gradient(#faf8f5,#faf8f5) padding-box,
            conic-gradient(from 0deg,#f59e0b,#ec4899,#8b5cf6,#3b82f6,#10b981,#f59e0b) border-box;
        color: #7c3aed;
    }

    .name-text {
        font-size: 13px; font-weight: 600; color: #1f2937;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        line-height: 1.2;
    }

    .pencil-btn {
        display: flex; align-items: center; justify-content: center;
        width: 16px; height: 16px;
        border: none; background: transparent; cursor: pointer;
        color: #c4b89a; padding: 0; border-radius: 3px;
        transition: color 0.15s;
        flex-shrink: 0;
    }
    .pencil-btn:hover { color: #92681a; }

    .name-input {
        font-size: 13px; font-weight: 600; color: #1f2937;
        border: none; border-bottom: 1.5px solid #fcd34d;
        background: transparent; outline: none;
        width: 100%; padding: 0; line-height: 1.2;
    }

    .toggle-btn {
        width: 28px; height: 16px; border-radius: 8px;
        background: #d1d5db; border: none; cursor: pointer;
        position: relative; transition: background 0.2s; padding: 0; flex-shrink: 0;
    }
    .toggle-btn:disabled { opacity: 0.4; cursor: default; }
    .toggle-btn.on { background: #f59e0b; }
    .toggle-knob {
        position: absolute; top: 2px; left: 2px;
        width: 12px; height: 12px; border-radius: 50%;
        background: white; box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        transition: transform 0.2s;
    }
    .toggle-btn.on .toggle-knob { transform: translateX(12px); }

    .icon-btn {
        width: 18px; height: 18px;
        display: flex; align-items: center; justify-content: center;
        border: none; background: transparent; color: #c4bdb4;
        cursor: pointer; border-radius: 3px; padding: 0; flex-shrink: 0;
        transition: color 0.15s;
    }
    .icon-btn:hover { color: #9ca3af; }

    /* ── Status ── */
    .status-line {
        font-size: 11px; color: #9ca3af; margin: 0; line-height: 1.3;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .settings-link {
        background: none; border: none; padding: 0; margin: 0;
        font-size: inherit; color: #92681a; font-weight: 500;
        cursor: pointer; text-decoration: underline;
        text-underline-offset: 2px;
        transition: color 0.15s;
    }
    .settings-link:hover { color: #b45309; }

    .mode-hint {
        font-size: 10px; color: #b5a99a; line-height: 1.2;
    }
    .delay-label-row {
        display: flex; align-items: center; justify-content: space-between;
    }

    .divider { height: 1px; background: #ede8e0; flex-shrink: 0; }

    /* ── Fields ── */
    .field { display: flex; flex-direction: column; gap: 4px; }

    .field-label {
        font-size: 9px; font-weight: 500; color: #b5a99a;
        text-transform: uppercase; letter-spacing: 0.07em;
    }

    /* ── Segmented control ── */
    .seg-ctrl {
        display: flex; border: 1px solid #e5ddd3;
        border-radius: 7px; overflow: hidden; background: white;
    }
    .seg-btn {
        flex: 1; padding: 4px 0; font-size: 11px;
        border: none; background: transparent; color: #6b7280;
        cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .seg-btn + .seg-btn { border-left: 1px solid #e5ddd3; }
    .seg-btn.seg-active { background: #fef3c7; color: #92400e; font-weight: 500; }

    /* ── Range ── */
    .range { width: 100%; accent-color: #f59e0b; }

    /* ── Review now ── */
    .review-btn {
        width: 100%; padding: 5px 0; margin: 6px 0; border-radius: 7px;
        display: flex; align-items: center; justify-content: center; gap: 6px;
        background: rgba(254, 243, 199, 0.7);
        border: 1px solid rgba(252, 211, 77, 0.4);
        color: #92400e; font-size: 11px; font-weight: 500;
        cursor: pointer; transition: background 0.15s, box-shadow 0.15s;
        box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.6),
            inset 0 -1px 0 rgba(0,0,0,0.04),
            0 1px 3px rgba(0,0,0,0.08);
        backdrop-filter: blur(4px);
    }
    .review-btn:hover {
        background: rgba(253, 230, 138, 0.8);
        box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.7),
            inset 0 -1px 0 rgba(0,0,0,0.06),
            0 2px 4px rgba(0,0,0,0.10);
    }

    /* ── Annotation type pills (right pane) ── */
    .pill {
        flex: 1; padding: 4px 8px;
        border-radius: 999px; font-size: 11px; font-weight: 500;
        border: 1.5px solid transparent; cursor: pointer;
        transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s;
        text-align: center; white-space: nowrap;
    }
    .pill-off    { background: white; color: #c4bdb4; border-color: #ede8e0; }
    .pill-off:hover { border-color: #c4b89a; color: #9ca3af; }
    .pill-comment    { background: #fef9e7; color: #92400e; border-color: #fcd34d; }
    .pill-suggestion { background: #f0fdf4; color: #166534; border-color: #86efac; }
    .pill-revision   { background: #faf5ff; color: #6b21a8; border-color: #d8b4fe; }

    /* ── Focus slider ── */
    .depth-header {
        display: flex; align-items: baseline; gap: 8px;
    }
    .depth-info {
        display: flex; align-items: baseline; gap: 5px;
    }
    .focus-label {
        font-size: 11px; font-weight: 500; color: #6b7280;
        transition: color 0.2s;
    }
    .focus-desc {
        font-size: 10px; color: #a89f96;
    }
    .focus-slider-wrap {
        display: flex; align-items: center; gap: 3px;
    }
    .focus-stop { font-size: 9px; color: #c4bdb4; line-height: 1; }
    .focus-range { flex: 1; accent-color: #f59e0b; }
</style>
