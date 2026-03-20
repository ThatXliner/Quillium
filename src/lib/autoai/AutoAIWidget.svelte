<!--
    AutoAIWidget.svelte — Fixed bottom-right AI collaborator bubble.

    Notion-Nosey-style circular avatar. Rainbow outline when AutoAI is
    active. Click to open a config popover (toggle, mode, debounce, persona,
    annotation types, conservativeness).
-->
<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { aiProcessing } from "$lib/ai/settings.svelte";
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

// Track running state separately so the rainbow shows when reviewing
// even if aiProcessing is also used by other AI features.
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

function handleWidgetClick() {
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

// Close popover when clicking outside.
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
</script>

<div class="autoai-root" bind:this={widgetEl}>
    <!-- The bubble -->
    <button
        class="autoai-bubble"
        class:active={autoAIRunning}
        class:reviewing={isReviewing}
        onclick={handleWidgetClick}
        title={autoAIRunning ? "AutoAI is active — click to configure" : "AutoAI — click to enable"}
        aria-label="AutoAI collaborator"
    >
        <span class="autoai-initials">{autoAISettings.persona.slice(0, 2).toUpperCase()}</span>
    </button>

    <!-- Config popover -->
    {#if popoverOpen}
        <div class="autoai-popover">
            <div class="popover-header">
                <span class="popover-title">{autoAISettings.persona}</span>
                <span class="popover-subtitle">AI Collaborator</span>
            </div>

            <!-- Enable / disable -->
            <div class="popover-row">
                <span class="row-label">Active</span>
                <button
                    class="toggle-btn"
                    class:on={autoAISettings.enabled}
                    onclick={toggleEnabled}
                    aria-label={autoAISettings.enabled ? "Disable AutoAI" : "Enable AutoAI"}
                >
                    <span class="toggle-knob"></span>
                </button>
            </div>

            {#if autoAISettings.enabled}
                <!-- Manual trigger -->
                {#if autoAISettings.mode === "manual"}
                    <button class="review-now-btn" onclick={handleManualReview}>
                        Review now
                    </button>
                {/if}
            {/if}

            <hr class="popover-divider" />

            <!-- Persona -->
            <div class="popover-field">
                <label class="field-label" for="autoai-persona">Name</label>
                <input
                    id="autoai-persona"
                    class="field-input"
                    type="text"
                    value={autoAISettings.persona}
                    oninput={handlePersonaInput}
                    maxlength={20}
                />
            </div>

            <!-- Mode -->
            <div class="popover-field">
                <span class="field-label">Mode</span>
                <div class="segment-ctrl">
                    <button
                        class="seg-btn"
                        class:seg-active={autoAISettings.mode === "continuous"}
                        onclick={() => setMode("continuous")}
                    >Continuous</button>
                    <button
                        class="seg-btn"
                        class:seg-active={autoAISettings.mode === "manual"}
                        onclick={() => setMode("manual")}
                    >Manual</button>
                </div>
            </div>

            <!-- Debounce (continuous only) -->
            {#if autoAISettings.mode === "continuous"}
                <div class="popover-field">
                    <label class="field-label" for="autoai-debounce">
                        Delay: {debounceSeconds}s
                    </label>
                    <input
                        id="autoai-debounce"
                        class="field-range"
                        type="range"
                        min="2"
                        max="60"
                        value={debounceSeconds}
                        oninput={handleDebounceInput}
                    />
                </div>
            {/if}

            <!-- Conservativeness -->
            <div class="popover-field">
                <span class="field-label">Focus</span>
                <div class="segment-ctrl">
                    {#each (["conservative", "balanced", "thorough"] as AutoAIConservativeness[]) as level}
                        <button
                            class="seg-btn"
                            class:seg-active={autoAISettings.conservativeness === level}
                            onclick={() => setConservativeness(level)}
                        >{level[0].toUpperCase() + level.slice(1)}</button>
                    {/each}
                </div>
            </div>

            <!-- Annotation types -->
            <div class="popover-field">
                <span class="field-label">Annotate with</span>
                <div class="checkbox-row">
                    {#each (["comment", "suggestion", "revision"] as AutoAIAnnotationType[]) as type}
                        <label class="checkbox-label">
                            <input
                                type="checkbox"
                                checked={autoAISettings.annotationTypes.includes(type)}
                                onchange={() => toggleAnnotationType(type)}
                            />
                            {type[0].toUpperCase() + type.slice(1)}s
                        </label>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    .autoai-root {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 40;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
    }

    /* Bubble */
    .autoai-bubble {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 2.5px solid transparent;
        background:
            linear-gradient(#f5f3f0, #f5f3f0) padding-box,
            linear-gradient(135deg, #d1d5db, #9ca3af) border-box;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
            box-shadow 0.2s,
            transform 0.15s;
    }

    .autoai-bubble:hover {
        transform: scale(1.06);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
    }

    .autoai-bubble.active {
        background:
            linear-gradient(#f5f3f0, #f5f3f0) padding-box,
            conic-gradient(
                from 0deg,
                #f59e0b,
                #ec4899,
                #8b5cf6,
                #3b82f6,
                #10b981,
                #f59e0b
            ) border-box;
    }

    .autoai-bubble.reviewing {
        animation: rainbow-spin 2s linear infinite;
    }

    @keyframes rainbow-spin {
        to {
            background:
                linear-gradient(#f5f3f0, #f5f3f0) padding-box,
                conic-gradient(
                    from 360deg,
                    #f59e0b,
                    #ec4899,
                    #8b5cf6,
                    #3b82f6,
                    #10b981,
                    #f59e0b
                ) border-box;
        }
    }

    .autoai-initials {
        font-size: 13px;
        font-weight: 600;
        color: #4b5563;
        letter-spacing: 0.02em;
        user-select: none;
    }

    /* Popover */
    .autoai-popover {
        width: 240px;
        background: rgba(250, 248, 245, 0.96);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.5);
        border-radius: 14px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.14);
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .popover-header {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .popover-title {
        font-size: 14px;
        font-weight: 600;
        color: #1f2937;
    }

    .popover-subtitle {
        font-size: 11px;
        color: #9ca3af;
    }

    .popover-divider {
        border: none;
        border-top: 1px solid #e5e7eb;
        margin: 0;
    }

    /* Toggle */
    .popover-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .row-label {
        font-size: 13px;
        color: #374151;
    }

    .toggle-btn {
        width: 36px;
        height: 20px;
        border-radius: 10px;
        background: #d1d5db;
        border: none;
        cursor: pointer;
        position: relative;
        transition: background 0.2s;
        padding: 0;
    }

    .toggle-btn.on {
        background: #3b82f6;
    }

    .toggle-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        transition: transform 0.2s;
    }

    .toggle-btn.on .toggle-knob {
        transform: translateX(16px);
    }

    /* Review now button */
    .review-now-btn {
        width: 100%;
        padding: 6px 0;
        border-radius: 8px;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        color: #1d4ed8;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
    }

    .review-now-btn:hover {
        background: #dbeafe;
    }

    /* Fields */
    .popover-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .field-label {
        font-size: 11px;
        font-weight: 500;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .field-input {
        font-size: 13px;
        border: 1px solid #e5e7eb;
        border-radius: 7px;
        padding: 5px 8px;
        background: white;
        color: #1f2937;
        outline: none;
        transition: border-color 0.15s;
    }

    .field-input:focus {
        border-color: #93c5fd;
    }

    .field-range {
        width: 100%;
        accent-color: #3b82f6;
    }

    /* Segmented control */
    .segment-ctrl {
        display: flex;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
    }

    .seg-btn {
        flex: 1;
        padding: 5px 0;
        font-size: 12px;
        border: none;
        background: white;
        color: #6b7280;
        cursor: pointer;
        transition:
            background 0.15s,
            color 0.15s;
    }

    .seg-btn + .seg-btn {
        border-left: 1px solid #e5e7eb;
    }

    .seg-btn.seg-active {
        background: #eff6ff;
        color: #1d4ed8;
        font-weight: 500;
    }

    /* Checkboxes */
    .checkbox-row {
        display: flex;
        gap: 10px;
    }

    .checkbox-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: #374151;
        cursor: pointer;
    }

    .checkbox-label input {
        accent-color: #3b82f6;
        cursor: pointer;
    }
</style>
