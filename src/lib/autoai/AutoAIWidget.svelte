<!--
    AutoAIWidget.svelte — Fixed bottom-left AI collaborator bubble.

    Morphs between a circular bubble and a settings card using the exact
    same pattern as AISidebar.svelte:
      - Single container div with transition-[width,height,border-radius]
      - Two absolutely-positioned overlapping layers (bubble / panel)
      - Each layer fades via transition-opacity; panel has an 80ms delay
      - overflow-hidden clips content during the morph
      - rounded-[100px] (not 9999px) for the circle state
      - Content height is measured via ResizeObserver and set explicitly
        so height can animate (auto cannot be transitioned)
-->
<script lang="ts">
import { onMount, onDestroy, tick } from "svelte";
import { aiProcessing, hasApiKey } from "$lib/ai/settings.svelte";
import {
    autoAISettings,
    persistAutoAISettings,
    type AutoAIAnnotationType,
    type AutoAIMode,
    type AutoAIConservativeness,
} from "./settings.svelte";
import { startAutoAI, stopAutoAI, triggerManualReview } from "./engine";

let open = $state(false);
let transitionDone = $state(false); // true once opening transition finishes
let widgetEl = $state<HTMLDivElement | null>(null);
let panelEl = $state<HTMLDivElement | null>(null);
let autoAIRunning = $state(autoAISettings.enabled);
let measuredHeight = $state(0);

const locked = $derived(!hasApiKey());
const isReviewing = $derived(autoAIRunning && aiProcessing.active && !locked);
const debounceSeconds = $derived(Math.round(autoAISettings.debounceMs / 1000));

// Measure panel height whenever it changes so we can animate to it.
let ro: ResizeObserver | null = null;

function measurePanel() {
    if (panelEl) measuredHeight = panelEl.scrollHeight;
}

$effect(() => {
    if (panelEl) {
        ro?.disconnect();
        ro = new ResizeObserver(measurePanel);
        ro.observe(panelEl);
        measurePanel();
    }
});

function toggleOpen() {
    open = !open;
    transitionDone = false;
}

function toggleEnabled() {
    if (locked) return;
    autoAISettings.enabled = !autoAISettings.enabled;
    autoAIRunning = autoAISettings.enabled;
    persistAutoAISettings();
    if (autoAISettings.enabled) startAutoAI(); else stopAutoAI();
}

function handleManualReview() {
    open = false;
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
        if (autoAISettings.annotationTypes.length === 1) return;
        autoAISettings.annotationTypes = autoAISettings.annotationTypes.filter(t => t !== type);
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
    if (!open) return;
    if (widgetEl && !widgetEl.contains(e.target as Node)) open = false;
}

onMount(() => {
    document.addEventListener("mousedown", handleDocClick);
    if (autoAISettings.enabled) startAutoAI();
});

onDestroy(() => {
    document.removeEventListener("mousedown", handleDocClick);
    ro?.disconnect();
    stopAutoAI();
});

const focusLabel: Record<AutoAIConservativeness, string> = {
    conservative: "Conservative",
    balanced: "Balanced",
    thorough: "Thorough",
};
</script>

<div
    bind:this={widgetEl}
    class="autoai-container"
    class:is-open={open}
    class:transition-done={open && transitionDone}
    class:rainbow-active={autoAIRunning && !locked && !open}
    class:rainbow-reviewing={isReviewing && !open}
    style={open ? `width: 224px; height: ${measuredHeight}px; border-radius: 14px;` : ''}
    ontransitionend={(e) => { if (e.propertyName === 'width' && open) transitionDone = true; }}
>
    <!-- Bubble layer -->
    <div class="layer bubble-layer" class:hidden={open}>
        <button
            onclick={toggleOpen}
            class="bubble-btn"
            aria-label={locked ? "AutoAI — add an API key to enable" : autoAIRunning ? "AutoAI active — click to configure" : "AutoAI — click to configure"}
            aria-expanded={open}
        >
            {#if locked}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="3.5" y="7" width="9" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            {:else}
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13 2C10 3 8 6 6 9C6 13 6 13 6 13C7 11 9 10 11 9C13 8 13 8 13 8C11 9 10 11 9 14L7.5 14C7.5 14 7 12 7 10C8 5 10 4 12 3Z" fill="currentColor" opacity="0.85"/>
                    <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.5"/>
                </svg>
            {/if}
        </button>
    </div>

    <!-- Panel layer — measured separately so height is always known -->
    <div
        class="layer panel-layer"
        class:visible={open}
        aria-hidden={!open}
    >
        <!-- This inner div is what we measure -->
        <div bind:this={panelEl} class="panel-inner">

            <!-- Header -->
            <div class="panel-header">
                <div class="header-icon" class:header-icon-active={autoAIRunning && !locked}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M13 2C10 3 8 6 6 9C6 13 6 13 6 13C7 11 9 10 11 9C13 8 13 8 13 8C11 9 10 11 9 14L7.5 14C7.5 14 7 12 7 10C8 5 10 4 12 3Z" fill="currentColor" opacity="0.85"/>
                        <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.5"/>
                    </svg>
                </div>
                <div class="header-text">
                    <span class="header-name">{autoAISettings.persona}</span>
                    <span class="header-sub">
                        {#if isReviewing}Reviewing…
                        {:else if autoAIRunning}Active · every {debounceSeconds}s
                        {:else}Paused{/if}
                    </span>
                </div>
                <button
                    class="toggle-btn" class:toggle-on={autoAISettings.enabled && !locked}
                    onclick={toggleEnabled} disabled={locked}
                    aria-label={locked ? "Add an API key to enable" : autoAISettings.enabled ? "Pause" : "Enable"}
                ><span class="toggle-knob"></span></button>
                <button class="close-btn" onclick={toggleOpen} aria-label="Close">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>

            {#if locked}
                <p class="locked-msg">Add an API key in settings to enable AutoAI.</p>
            {:else if autoAISettings.mode === "manual" && autoAISettings.enabled}
                <button class="review-btn" onclick={handleManualReview}>Review now</button>
            {/if}

            <hr class="divider" />

            <div class="field">
                <label class="field-label" for="autoai-persona">NAME</label>
                <input id="autoai-persona" class="field-input" type="text"
                    value={autoAISettings.persona} oninput={handlePersonaInput} maxlength={20}
                    tabindex={open ? 0 : -1} />
            </div>

            <div class="field">
                <span class="field-label">MODE</span>
                <div class="seg">
                    <button class="seg-btn" class:seg-active={autoAISettings.mode === "continuous"}
                        onclick={() => setMode("continuous")} tabindex={open ? 0 : -1}>Continuous</button>
                    <button class="seg-btn" class:seg-active={autoAISettings.mode === "manual"}
                        onclick={() => setMode("manual")} tabindex={open ? 0 : -1}>Manual</button>
                </div>
            </div>

            {#if autoAISettings.mode === "continuous"}
                <div class="field">
                    <label class="field-label" for="autoai-delay">DELAY: {debounceSeconds}S</label>
                    <input id="autoai-delay" class="range" type="range" min="2" max="60"
                        value={debounceSeconds} oninput={handleDebounceInput} tabindex={open ? 0 : -1} />
                </div>
            {/if}

            <div class="field">
                <span class="field-label">FOCUS</span>
                <div class="seg">
                    {#each (["conservative", "balanced", "thorough"] as AutoAIConservativeness[]) as level}
                        <button class="seg-btn" class:seg-active={autoAISettings.conservativeness === level}
                            onclick={() => setConservativeness(level)} tabindex={open ? 0 : -1}
                        >{focusLabel[level]}</button>
                    {/each}
                </div>
            </div>

            <div class="field">
                <span class="field-label">ANNOTATE WITH</span>
                <div class="check-row">
                    {#each (["comment", "suggestion", "revision"] as AutoAIAnnotationType[]) as type}
                        <label class="check-label">
                            <input type="checkbox" class="check"
                                checked={autoAISettings.annotationTypes.includes(type)}
                                onchange={() => toggleAnnotationType(type)}
                                tabindex={open ? 0 : -1} />
                            {type[0].toUpperCase() + type.slice(1)}s
                        </label>
                    {/each}
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    .autoai-container {
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 40;
        overflow: hidden;
        width: 40px;
        height: 40px;
        border-radius: 20px; /* exact half of 40px — animates cleanly to 14px */
        background: #faf8f5;
        border: 2px solid #d6b87a;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.10);
        transition:
            width 340ms cubic-bezier(0.33, 0, 0.2, 1),
            height 340ms cubic-bezier(0.33, 0, 0.2, 1),
            border-radius 340ms cubic-bezier(0.33, 0, 0.2, 1),
            border-color 300ms ease,
            box-shadow 200ms ease;
    }

    .autoai-container.is-open {
        /* width/height/border-radius set via inline style from measuredHeight */
        border-color: #e8e0d4;
        box-shadow: 0 4px 16px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06);
    }

    /* Only allow overflow once the morph transition has fully completed */
    .autoai-container.transition-done {
        overflow: visible;
    }

    .rainbow-active {
        border: 2px solid transparent;
        background:
            linear-gradient(#faf8f5, #faf8f5) padding-box,
            conic-gradient(from 0deg, #f59e0b, #ec4899, #8b5cf6, #3b82f6, #10b981, #f59e0b) border-box;
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

    /* Bubble */
    .bubble-layer { display: flex; align-items: center; justify-content: center; }
    .bubble-layer.hidden { opacity: 0; pointer-events: none; }

    .bubble-btn {
        width: 100%; height: 100%;
        display: flex; align-items: center; justify-content: center;
        background: transparent; border: none; cursor: pointer;
        color: #92681a;
        border-radius: inherit;
    }

    /* Panel */
    .panel-layer { opacity: 0; pointer-events: none; }
    .panel-layer.visible { opacity: 1; pointer-events: auto; transition-delay: 80ms; }

    .panel-inner {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
    }

    /* ── Header ── */
    .panel-header { display: flex; align-items: center; gap: 7px; }

    .header-icon {
        width: 24px; height: 24px;
        border-radius: 50%;
        border: 1.5px solid #d6b87a;
        background: #faf8f5;
        color: #92681a;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
    }

    .header-icon-active {
        border: 1.5px solid transparent;
        background:
            linear-gradient(#faf8f5, #faf8f5) padding-box,
            conic-gradient(from 0deg, #f59e0b, #ec4899, #8b5cf6, #3b82f6, #10b981, #f59e0b) border-box;
        color: #7c3aed;
    }

    .header-text { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .header-name { font-size: 13px; font-weight: 600; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
    .header-sub  { font-size: 10px; color: #9ca3af; white-space: nowrap; }

    .toggle-btn {
        width: 30px; height: 17px;
        border-radius: 9px; background: #d1d5db;
        border: none; cursor: pointer; position: relative;
        transition: background 0.2s; padding: 0; flex-shrink: 0;
    }
    .toggle-btn:disabled { opacity: 0.4; cursor: default; }
    .toggle-btn.toggle-on { background: #f59e0b; }
    .toggle-knob {
        position: absolute; top: 2px; left: 2px;
        width: 13px; height: 13px; border-radius: 50%;
        background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        transition: transform 0.2s;
    }
    .toggle-btn.toggle-on .toggle-knob { transform: translateX(13px); }

    .close-btn {
        width: 20px; height: 20px;
        display: flex; align-items: center; justify-content: center;
        border: none; background: transparent; color: #9ca3af;
        cursor: pointer; border-radius: 4px; padding: 0; flex-shrink: 0;
        transition: color 0.15s, background 0.15s;
    }
    .close-btn:hover { color: #6b7280; background: #f3f0eb; }

    /* ── Misc ── */
    .locked-msg { font-size: 11px; color: #9ca3af; margin: 0; line-height: 1.4; }

    .review-btn {
        width: 100%; padding: 6px 0; border-radius: 8px;
        background: #fef3c7; border: 1px solid #fcd34d;
        color: #92400e; font-size: 12px; font-weight: 500;
        cursor: pointer; transition: background 0.15s;
    }
    .review-btn:hover { background: #fde68a; }

    .divider { border: none; border-top: 1px solid #ede8e0; margin: 0; }

    /* ── Fields ── */
    .field { display: flex; flex-direction: column; gap: 5px; }

    .field-label {
        font-size: 10px; font-weight: 500; color: #9ca3af;
        text-transform: uppercase; letter-spacing: 0.06em;
    }

    .field-input {
        font-size: 13px; border: 1px solid #e5ddd3;
        border-radius: 7px; padding: 5px 8px;
        background: white; color: #1f2937;
        outline: none; transition: border-color 0.15s;
    }
    .field-input:focus { border-color: #fcd34d; }

    .range { width: 100%; accent-color: #f59e0b; }

    .seg {
        display: flex; border: 1px solid #e5ddd3;
        border-radius: 8px; overflow: hidden; background: white;
    }
    .seg-btn {
        flex: 1; padding: 5px 0; font-size: 11px;
        border: none; background: transparent; color: #6b7280;
        cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .seg-btn + .seg-btn { border-left: 1px solid #e5ddd3; }
    .seg-btn.seg-active { background: #fef3c7; color: #92400e; font-weight: 500; }

    .check-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .check-label {
        display: flex; align-items: center; gap: 4px;
        font-size: 11px; color: #374151; cursor: pointer;
    }
    .check { accent-color: #f59e0b; cursor: pointer; }
</style>
