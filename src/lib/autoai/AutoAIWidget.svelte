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
import { onMount, onDestroy } from "svelte";
import { aiProcessing, hasApiKey } from "$lib/ai/settings.svelte";
import Kbd from "$lib/ui/Kbd.svelte";
import {
    autoAISettings,
    persistAutoAISettings,
    type AutoAIAnnotationType,
    type AutoAIConservativeness,
    type AutoAIMode,
} from "./settings.svelte";
import { startAutoAI, stopAutoAI, triggerManualReview } from "./engine";

let open = $state(false);
let editingName = $state(false);
let nameInputEl = $state<HTMLInputElement | null>(null);
let widgetEl = $state<HTMLDivElement | null>(null);
let autoAIRunning = $state(autoAISettings.enabled);

const noApiKey = $derived(!hasApiKey());
const locked = $derived(noApiKey || !autoAIRunning);
const isReviewing = $derived(autoAIRunning && aiProcessing.active);
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
    const idx = parseInt((e.target as HTMLInputElement).value, 10);
    autoAISettings.conservativeness = focusLevels[idx];
    persistAutoAISettings();
}

function toggleOpen() {
    open = !open;
    editingName = false;
}

function toggleEnabled() {
    if (noApiKey) return;
    autoAISettings.enabled = !autoAISettings.enabled;
    autoAIRunning = autoAISettings.enabled;
    persistAutoAISettings();
    if (autoAISettings.enabled) startAutoAI();
    else stopAutoAI();
}

function handleManualReview() {
    open = false;
    triggerManualReview();
}

function setMode(mode: AutoAIMode) {
    autoAISettings.mode = mode;
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
    window.dispatchEvent(new CustomEvent("quillium:open-ai-settings"));
}

function handleDocClick(e: MouseEvent) {
    if (!open) return;
    if (widgetEl && !widgetEl.contains(e.target as Node)) open = false;
}

onMount(() => {
    document.addEventListener("mousedown", handleDocClick);
    if (autoAISettings.enabled) startAutoAI();
});

onDestroy(() => {
    document.removeEventListener("mousedown", handleDocClick);
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
    class="autoai-container {open ? 'w-[360px] h-[220px] rounded-[16px]' : 'w-[67px] h-[67px] rounded-[100px]'}
           {autoAIRunning && !locked && !open ? 'rainbow-active' : ''}
           {isReviewing && !open ? 'rainbow-reviewing' : ''}"
>
    <!-- Bubble layer -->
    <div class="layer {open ? 'opacity-0 pointer-events-none' : 'opacity-100'}
                flex items-center justify-center">
        <button
            onclick={toggleOpen}
            aria-label={noApiKey ? "AutoAI — add an API key to enable" : autoAIRunning ? "AutoAI active — click to configure" : "AutoAI paused — click to configure"}
            aria-expanded={open}
            class="w-full h-full flex items-center justify-center rounded-[inherit]
                   bg-transparent border-none cursor-pointer
                   {noApiKey ? 'text-gray-400' : !autoAIRunning ? 'text-gray-400' : 'text-amber-700'}"
        >
            {#if noApiKey}
                <!-- Lock icon -->
                <svg width="26" height="26" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="3.5" y="7" width="9" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            {:else if !autoAIRunning}
                <!-- Pause icon -->
                <svg width="26" height="26" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"/>
                    <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor"/>
                </svg>
            {:else}
                <!-- Quill icon -->
                <svg width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13 2C10 3 8 6 6 9C6 13 6 13 6 13C7 11 9 10 11 9C13 8 13 8 13 8C11 9 10 11 9 14L7.5 14C7.5 14 7 12 7 10C8 5 10 4 12 3Z" fill="currentColor" opacity="0.85"/>
                    <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.5"/>
                </svg>
            {/if}
        </button>
    </div>

    <!-- Panel layer -->
    <div class="layer {open ? 'opacity-100 delay-[80ms]' : 'opacity-0 pointer-events-none'}
                flex">

        <!-- LEFT PANE -->
        <div class="left-pane">
            <!-- Header: icon + name + pencil + toggle + × -->
            <div class="flex items-center gap-[6px]">
                <div class="bubble-icon {autoAIRunning && !locked ? 'bubble-icon-active' : ''}">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M13 2C10 3 8 6 6 9C6 13 6 13 6 13C7 11 9 10 11 9C13 8 13 8 13 8C11 9 10 11 9 14L7.5 14C7.5 14 7 12 7 10C8 5 10 4 12 3Z" fill="currentColor" opacity="0.85"/>
                        <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.5"/>
                    </svg>
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
                {:else if autoAIRunning}Active · every {debounceSeconds}s
                {:else}Paused{/if}
            </p>

            <div class="divider"></div>

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
                {:else}
                    <div class="mode-hint mode-hint-row mb-2 mt-1">Trigger with <Kbd keys={["⌘", "⇧", "R"]} /></div>
                {/if}
            </div>

            <!-- Delay or Review now -->
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
            {:else if autoAISettings.enabled}
                <button class="review-btn" onclick={handleManualReview} tabindex={open ? 0 : -1}>
                    Review now
                </button>
            {/if}
            </div>
        </div>

        <!-- Vertical divider -->
        <div class="v-divider"></div>

        <!-- RIGHT PANE -->
        <div class="right-pane">
            <!-- Annotation type pills -->
            <div class="field">
                <span class="field-label">FIND</span>
                <div class="flex flex-col gap-[5px]">
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

            <div class="divider"></div>

            <!-- Focus 3-stop slider -->
            <div class="field">
                <span class="field-label">DEPTH</span>
                <span class="focus-label">{focusLabels[autoAISettings.conservativeness]}</span>
                <span class="focus-desc">{focusDescriptions[autoAISettings.conservativeness]}</span>
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
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 40;
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

    .autoai-container.w-\[360px\] {
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
        transition: opacity 150ms ease;
    }

    /* ── Two-pane layout ── */
    .left-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        min-width: 0;
    }

    .v-divider {
        width: 1px;
        background: #ede8e0;
        align-self: stretch;
        flex-shrink: 0;
    }

    .right-pane {
        width: 116px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 10px;
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
    .mode-hint-row {
        display: flex; align-items: center; gap: 3px;
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
        width: 100%; padding: 5px 0; border-radius: 7px;
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
        width: 100%; padding: 4px 8px;
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
    .focus-label {
        font-size: 11px; font-weight: 500; color: #6b7280;
        text-align: center;
        transition: color 0.2s;
    }
    .focus-desc {
        font-size: 10px; color: #a89f96;
        text-align: center;
        margin-top: -2px;
    }
    .focus-slider-wrap {
        display: flex; align-items: center; gap: 3px;
    }
    .focus-stop { font-size: 9px; color: #c4bdb4; line-height: 1; }
    .focus-range { flex: 1; accent-color: #f59e0b; }
</style>
