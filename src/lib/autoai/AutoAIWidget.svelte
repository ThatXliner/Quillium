<!--
    AutoAIWidget.svelte — Fixed bottom-left AI collaborator bubble.

    Morphs between a circular bubble and a settings card using the exact
    same pattern as AISidebar.svelte:
      - Single container div with transition-[width,height,border-radius]
      - Two absolutely-positioned overlapping layers (bubble / panel)
      - Each layer fades via transition-opacity; panel has an 80ms delay
      - overflow-hidden clips content during the morph
      - rounded-[100px] (not 9999px) for the circle state
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

let open = $state(false);
let widgetEl = $state<HTMLDivElement | null>(null);
let autoAIRunning = $state(autoAISettings.enabled);

const locked = $derived(!hasApiKey());
const isReviewing = $derived(autoAIRunning && aiProcessing.active);
const debounceSeconds = $derived(Math.round(autoAISettings.debounceMs / 1000));

function toggleOpen() {
    open = !open;
}

function toggleEnabled() {
    if (locked) return;
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
</script>

<!--
    Single morphing container — exactly like AISidebar:
    closed: w-[40px] h-[40px] rounded-[100px]
    open:   w-[232px] h-auto rounded-[14px]
    transition-[width,height,border-radius] duration-[340ms]
-->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={widgetEl}
    onclick={(e) => e.stopPropagation()}
    class="autoai-container {open ? 'w-[232px] rounded-[14px]' : 'w-[40px] h-[40px] rounded-[100px]'}
           {autoAIRunning && !locked && !open ? 'rainbow-active' : ''}
           {isReviewing && !open ? 'rainbow-reviewing' : ''}"
>
    <!-- Bubble layer — visible when closed -->
    <div class="absolute inset-0 flex items-center justify-center
                transition-opacity duration-150
                {open ? 'opacity-0 pointer-events-none' : 'opacity-100'}">
        <button
            onclick={toggleOpen}
            aria-label={locked
                ? "AutoAI — add an API key in settings to enable"
                : autoAIRunning
                    ? "AutoAI active — click to configure"
                    : "AutoAI — click to enable"}
            title={locked ? "Add an API key in settings to use AutoAI" : undefined}
            aria-expanded={open}
            class="w-full h-full flex items-center justify-center rounded-[inherit]
                   bg-transparent border-none cursor-pointer
                   {locked ? 'text-gray-400' : 'text-amber-700'}"
        >
            <!-- Quill icon -->
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M13 2C10 3 8 6 6 9C6 13 6 13 6 13C7 11 9 10 11 9C13 8 13 8 13 8C11 9 10 11 9 14L7.5 14C7.5 14 7 12 7 10C8 5 10 4 12 3Z" fill="currentColor" opacity="0.85"/>
                <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.5"/>
            </svg>
        </button>
    </div>

    <!-- Panel layer — visible when open, 80ms delay matches AISidebar -->
    <div class="w-full flex flex-col gap-[10px] p-3
                transition-opacity duration-150
                {open ? 'opacity-100 delay-[80ms]' : 'opacity-0 pointer-events-none'}">

        <!-- Header -->
        <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-full border border-amber-300 bg-[#faf8f5]
                        flex items-center justify-center text-amber-700 shrink-0">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13 2C10 3 8 6 6 9C6 13 6 13 6 13C7 11 9 10 11 9C13 8 13 8 13 8C11 9 10 11 9 14L7.5 14C7.5 14 7 12 7 10C8 5 10 4 12 3Z" fill="currentColor" opacity="0.85"/>
                    <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.5"/>
                </svg>
            </div>
            <div class="flex flex-col flex-1 min-w-0">
                <span class="text-[13px] font-semibold text-gray-800 truncate leading-tight">
                    {autoAISettings.persona}
                </span>
                <span class="text-[10px] text-gray-400 whitespace-nowrap">
                    {#if isReviewing}
                        Reviewing…
                    {:else if autoAIRunning}
                        Active · every {debounceSeconds}s
                    {:else}
                        Paused
                    {/if}
                </span>
            </div>
            <!-- Toggle -->
            <button
                class="toggle-btn {autoAISettings.enabled && !locked ? 'on' : ''}"
                onclick={toggleEnabled}
                disabled={locked}
                aria-label={locked ? "Add an API key to enable AutoAI" : autoAISettings.enabled ? "Pause AutoAI" : "Enable AutoAI"}
            >
                <span class="toggle-knob"></span>
            </button>
            <!-- Close -->
            <button
                onclick={toggleOpen}
                aria-label="Close"
                class="w-5 h-5 flex items-center justify-center rounded text-gray-400
                       hover:text-gray-600 hover:bg-black/5 border-none bg-transparent
                       cursor-pointer transition-colors shrink-0"
            >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </button>
        </div>

        {#if locked}
            <p class="text-[11px] text-gray-400 leading-snug m-0">
                Add an API key in settings to enable AutoAI.
            </p>
        {:else if autoAISettings.mode === "manual" && autoAISettings.enabled}
            <button
                onclick={handleManualReview}
                class="w-full py-1.5 rounded-lg bg-amber-50 border border-amber-200
                       text-amber-900 text-[12px] font-medium cursor-pointer
                       hover:bg-amber-100 transition-colors"
            >
                Review now
            </button>
        {/if}

        <hr class="border-none border-t border-[#ede8e0] m-0" />

        <!-- Name -->
        <div class="field">
            <label class="field-label" for="autoai-persona">NAME</label>
            <input
                id="autoai-persona"
                class="field-input"
                type="text"
                value={autoAISettings.persona}
                oninput={handlePersonaInput}
                maxlength={20}
                tabindex={open ? 0 : -1}
            />
        </div>

        <!-- Mode -->
        <div class="field">
            <span class="field-label">MODE</span>
            <div class="seg-ctrl">
                <button class="seg-btn {autoAISettings.mode === 'continuous' ? 'seg-active' : ''}"
                    onclick={() => setMode("continuous")} tabindex={open ? 0 : -1}>Continuous</button>
                <button class="seg-btn {autoAISettings.mode === 'manual' ? 'seg-active' : ''}"
                    onclick={() => setMode("manual")} tabindex={open ? 0 : -1}>Manual</button>
            </div>
        </div>

        <!-- Delay -->
        {#if autoAISettings.mode === "continuous"}
            <div class="field">
                <label class="field-label" for="autoai-debounce">DELAY: {debounceSeconds}S</label>
                <input
                    id="autoai-debounce"
                    class="w-full accent-amber-500"
                    type="range" min="2" max="60"
                    value={debounceSeconds}
                    oninput={handleDebounceInput}
                    tabindex={open ? 0 : -1}
                />
            </div>
        {/if}

        <!-- Focus -->
        <div class="field">
            <span class="field-label">FOCUS</span>
            <div class="seg-ctrl">
                {#each (["conservative", "balanced", "thorough"] as AutoAIConservativeness[]) as level}
                    <button
                        class="seg-btn {autoAISettings.conservativeness === level ? 'seg-active' : ''}"
                        onclick={() => setConservativeness(level)}
                        tabindex={open ? 0 : -1}
                    >{level[0].toUpperCase() + level.slice(1)}</button>
                {/each}
            </div>
        </div>

        <!-- Annotate with -->
        <div class="field">
            <span class="field-label">ANNOTATE WITH</span>
            <div class="flex gap-[10px]">
                {#each (["comment", "suggestion", "revision"] as AutoAIAnnotationType[]) as type}
                    <label class="flex items-center gap-1 text-[11px] text-gray-700 cursor-pointer">
                        <input
                            type="checkbox"
                            class="accent-amber-500 cursor-pointer"
                            checked={autoAISettings.annotationTypes.includes(type)}
                            onchange={() => toggleAnnotationType(type)}
                            tabindex={open ? 0 : -1}
                        />
                        {type[0].toUpperCase() + type.slice(1)}s
                    </label>
                {/each}
            </div>
        </div>
    </div>
</div>

<style>
    /* ── Morphing container ── */
    .autoai-container {
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 40;
        overflow: hidden;

        /* Closed height is set via Tailwind h-[40px];
           open height is content-driven so we don't set it here */
        background: #faf8f5;
        border: 2px solid #d6b87a;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.10);

        /* Same easing curve as AISidebar */
        transition:
            width 340ms cubic-bezier(0.33, 0, 0.2, 1),
            height 340ms cubic-bezier(0.33, 0, 0.2, 1),
            border-radius 340ms cubic-bezier(0.33, 0, 0.2, 1),
            border-color 300ms ease,
            box-shadow 200ms ease;
    }

    /* Open state — override height for content-driven sizing */
    .autoai-container.w-\[232px\] {
        height: auto;
        border-color: #e8e0d4;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.10), 0 1px 4px rgba(0, 0, 0, 0.06);
        overflow: visible; /* allow range thumbs to render outside clip */
    }

    /* Rainbow border — active (static) */
    .rainbow-active {
        border: 2px solid transparent;
        background:
            linear-gradient(#faf8f5, #faf8f5) padding-box,
            conic-gradient(from 0deg, #f59e0b, #ec4899, #8b5cf6, #3b82f6, #10b981, #f59e0b) border-box;
    }

    /* Rainbow border — reviewing (spinning) */
    .rainbow-reviewing {
        border: 2px solid transparent;
        animation: rainbow-spin 2s linear infinite;
    }

    @keyframes rainbow-spin {
        from {
            background:
                linear-gradient(#faf8f5, #faf8f5) padding-box,
                conic-gradient(from 0deg, #f59e0b, #ec4899, #8b5cf6, #3b82f6, #10b981, #f59e0b) border-box;
        }
        to {
            background:
                linear-gradient(#faf8f5, #faf8f5) padding-box,
                conic-gradient(from 360deg, #f59e0b, #ec4899, #8b5cf6, #3b82f6, #10b981, #f59e0b) border-box;
        }
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

    .toggle-btn:disabled {
        opacity: 0.4;
        cursor: default;
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

    /* ── Fields ── */
    .field {
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

    /* ── Segmented control ── */
    .seg-ctrl {
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
</style>
