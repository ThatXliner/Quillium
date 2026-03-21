<!--
    AutoAIWidget.svelte — Radial circle-based AutoAI controls.

    Main bubble opens/closes a radial fan of setting circles:
      - Enable toggle (on/off)
      - Mode (continuous ↔ manual)
      - Focus (conservative → balanced → thorough, cycles)
      - Annotation types: comments, suggestions, revisions (toggle each)

    Each satellite circle has a small label beneath it.
    Rainbow border on main bubble when active, spinning when reviewing.
-->
<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { aiProcessing, hasApiKey } from "$lib/ai/settings.svelte";
import {
    autoAISettings,
    persistAutoAISettings,
    type AutoAIAnnotationType,
    type AutoAIConservativeness,
} from "./settings.svelte";
import { startAutoAI, stopAutoAI, triggerManualReview } from "./engine";

let open = $state(false);
let widgetEl = $state<HTMLDivElement | null>(null);
let autoAIRunning = $state(autoAISettings.enabled);

const locked = $derived(!hasApiKey());
const isReviewing = $derived(autoAIRunning && aiProcessing.active && !locked);

function toggleOpen() { open = !open; }

function toggleEnabled() {
    if (locked) return;
    autoAISettings.enabled = !autoAISettings.enabled;
    autoAIRunning = autoAISettings.enabled;
    persistAutoAISettings();
    if (autoAISettings.enabled) startAutoAI(); else stopAutoAI();
}

function cycleMode() {
    autoAISettings.mode = autoAISettings.mode === "continuous" ? "manual" : "continuous";
    persistAutoAISettings();
}

function cycleFocus() {
    const order: AutoAIConservativeness[] = ["conservative", "balanced", "thorough"];
    const idx = order.indexOf(autoAISettings.conservativeness);
    autoAISettings.conservativeness = order[(idx + 1) % order.length];
    persistAutoAISettings();
}

function toggleType(type: AutoAIAnnotationType) {
    const idx = autoAISettings.annotationTypes.indexOf(type);
    if (idx === -1) {
        autoAISettings.annotationTypes = [...autoAISettings.annotationTypes, type];
    } else {
        if (autoAISettings.annotationTypes.length === 1) return; // keep at least one
        autoAISettings.annotationTypes = autoAISettings.annotationTypes.filter(t => t !== type);
    }
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

// Focus label abbreviations
const focusLabel: Record<AutoAIConservativeness, string> = {
    conservative: "Low",
    balanced: "Mid",
    thorough: "High",
};

const focusTitle: Record<AutoAIConservativeness, string> = {
    conservative: "Conservative",
    balanced: "Balanced",
    thorough: "Thorough",
};

// Satellites: [id, label, angle-from-top-of-bubble, distance]
// We fan them out from top-left going counter-clockwise (up and to the right)
// Angles in degrees from the positive-x axis, measured at the bubble center.
// Bubble is at bottom-left; satellites fan upward/rightward.
//
// Layout (from bubble center, spreading upward):
//   enable  — directly above
//   mode    — upper-left diagonal
//   focus   — upper-right diagonal
//   comments, suggestions, revisions — arc further out

// Each satellite: { id, angle (deg, 0=right, 90=up), dist (px) }
const BUBBLE_R = 20; // half of 40px bubble

type Satellite = {
    id: string;
    angle: number; // degrees, 0=right, 90=up
    dist: number;
};

const satellites: Satellite[] = [
    { id: "enable",      angle: 90,  dist: 68  },
    { id: "mode",        angle: 60,  dist: 68  },
    { id: "focus",       angle: 30,  dist: 68  },
    { id: "comments",    angle: 75,  dist: 130 },
    { id: "suggestions", angle: 45,  dist: 130 },
    { id: "revisions",   angle: 15,  dist: 130 },
];

function satPos(angle: number, dist: number) {
    const rad = (angle * Math.PI) / 180;
    // Origin is center of bubble (BUBBLE_R, BUBBLE_R from top-left of root)
    // Satellites spread upward/right, so y is inverted
    const x = BUBBLE_R + Math.cos(rad) * dist;
    const y = BUBBLE_R - Math.sin(rad) * dist;
    return { x, y };
}

function isTypeOn(type: AutoAIAnnotationType) {
    return autoAISettings.annotationTypes.includes(type);
}
</script>

<div
    class="autoai-root"
    bind:this={widgetEl}
>
    <!-- Satellite circles -->
    {#each satellites as sat, i}
        {@const pos = satPos(sat.angle, sat.dist)}
        {@const delay = open ? i * 30 : (satellites.length - 1 - i) * 20}
        <div
            class="satellite"
            style="
                left: {pos.x}px;
                top: {pos.y}px;
                transition-delay: {delay}ms;
                opacity: {open ? 1 : 0};
                transform: translate(-50%, -50%) scale({open ? 1 : 0.4});
                pointer-events: {open ? 'auto' : 'none'};
            "
        >
            {#if sat.id === "enable"}
                <button
                    class="sat-btn {autoAISettings.enabled && !locked ? 'sat-on' : ''} {locked ? 'sat-locked' : ''}"
                    onclick={toggleEnabled}
                    title={locked ? "Add an API key to enable" : autoAISettings.enabled ? "Pause AutoAI" : "Enable AutoAI"}
                >
                    {#if locked}
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="4" y="7" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    {:else if autoAISettings.enabled}
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="4" width="2" height="8" rx="1" fill="currentColor"/><rect x="9" y="4" width="2" height="8" rx="1" fill="currentColor"/></svg>
                    {:else}
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 3.5l8 4.5-8 4.5V3.5z" fill="currentColor"/></svg>
                    {/if}
                </button>
                <span class="sat-label">{locked ? "Locked" : autoAISettings.enabled ? "Pause" : "Start"}</span>

            {:else if sat.id === "mode"}
                <button
                    class="sat-btn {autoAISettings.mode === 'continuous' ? 'sat-on' : ''}"
                    onclick={cycleMode}
                    title="Mode: {autoAISettings.mode}"
                >
                    {#if autoAISettings.mode === "continuous"}
                        <!-- Loop icon -->
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 016-6 6 6 0 014.24 1.76L14 2v4h-4l1.42-1.42A4 4 0 104 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    {:else}
                        <!-- Hand/manual icon -->
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v7M5 5L8 2l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 9v3a2 2 0 002 2h6a2 2 0 002-2V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    {/if}
                </button>
                <span class="sat-label">{autoAISettings.mode === "continuous" ? "Auto" : "Manual"}</span>

            {:else if sat.id === "focus"}
                <button
                    class="sat-btn sat-focus-{autoAISettings.conservativeness}"
                    onclick={cycleFocus}
                    title="Focus: {focusTitle[autoAISettings.conservativeness]}"
                >
                    <!-- Eye icon -->
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/></svg>
                </button>
                <span class="sat-label">{focusLabel[autoAISettings.conservativeness]}</span>

            {:else if sat.id === "comments"}
                <button
                    class="sat-btn sat-type {isTypeOn('comment') ? 'sat-type-on' : ''}"
                    onclick={() => toggleType("comment")}
                    title="{isTypeOn('comment') ? 'Disable' : 'Enable'} comments"
                >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 2h12v9H9l-3 3v-3H2V2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
                </button>
                <span class="sat-label">Notes</span>

            {:else if sat.id === "suggestions"}
                <button
                    class="sat-btn sat-type {isTypeOn('suggestion') ? 'sat-type-on sat-type-green' : ''}"
                    onclick={() => toggleType("suggestion")}
                    title="{isTypeOn('suggestion') ? 'Disable' : 'Enable'} suggestions"
                >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M8 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <span class="sat-label">Suggest</span>

            {:else if sat.id === "revisions"}
                <button
                    class="sat-btn sat-type {isTypeOn('revision') ? 'sat-type-on sat-type-purple' : ''}"
                    onclick={() => toggleType("revision")}
                    title="{isTypeOn('revision') ? 'Disable' : 'Enable'} revisions"
                >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 4h5l3 3v5H4V4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 4v3h3" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
                </button>
                <span class="sat-label">Revise</span>
            {/if}
        </div>
    {/each}

    <!-- Main bubble -->
    <button
        class="main-bubble"
        class:active={autoAIRunning && !locked}
        class:reviewing={isReviewing}
        class:locked
        onclick={toggleOpen}
        aria-label="AutoAI"
        aria-expanded={open}
        title={locked ? "Add an API key in settings to use AutoAI" : autoAIRunning ? "AutoAI active" : "AutoAI paused"}
    >
        {#if locked}
            <!-- Lock icon -->
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="3.5" y="7" width="9" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
                <path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        {:else}
            <!-- Quill icon -->
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M13 2C10 3 8 6 6 9C6 13 6 13 6 13C7 11 9 10 11 9C13 8 13 8 13 8C11 9 10 11 9 14L7.5 14C7.5 14 7 12 7 10C8 5 10 4 12 3Z" fill="currentColor" opacity="0.85"/>
                <circle cx="5.5" cy="13.5" r="1" fill="currentColor" opacity="0.5"/>
            </svg>
        {/if}
    </button>
</div>

<style>
    .autoai-root {
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 40;
        /* Size of main bubble — satellites are absolutely positioned relative to this */
        width: 40px;
        height: 40px;
    }

    /* ── Main bubble ── */
    .main-bubble {
        position: absolute;
        left: 0; top: 0;
        width: 40px;
        height: 40px;
        border-radius: 20px;
        border: 2px solid #d6b87a;
        background: #faf8f5;
        color: #92681a;
        box-shadow: 0 2px 6px rgba(0,0,0,0.12);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        z-index: 2;
    }

    .main-bubble:hover {
        transform: scale(1.08);
        box-shadow: 0 4px 10px rgba(0,0,0,0.16);
    }

    .main-bubble.locked {
        border-color: #d1d5db;
        color: #9ca3af;
        opacity: 0.6;
    }

    .main-bubble.active {
        border: 2px solid transparent;
        background:
            linear-gradient(#faf8f5, #faf8f5) padding-box,
            conic-gradient(from 0deg, #f59e0b, #ec4899, #8b5cf6, #3b82f6, #10b981, #f59e0b) border-box;
        color: #7c3aed;
    }

    .main-bubble.reviewing {
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

    /* ── Satellites ── */
    .satellite {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        transition: opacity 200ms ease, transform 200ms cubic-bezier(0.34, 1.4, 0.64, 1);
        z-index: 1;
    }

    .sat-btn {
        width: 36px;
        height: 36px;
        border-radius: 18px;
        border: 1.5px solid #e5ddd3;
        background: #faf8f5;
        color: #6b7280;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.10);
        transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.1s;
    }

    .sat-btn:hover {
        transform: scale(1.1);
        border-color: #d6b87a;
        color: #92681a;
    }

    /* Enable — amber when on */
    .sat-on {
        background: #fef3c7;
        border-color: #fcd34d;
        color: #92400e;
    }

    .sat-locked {
        opacity: 0.5;
        cursor: default;
    }

    /* Focus levels */
    .sat-focus-conservative { background: #f0fdf4; border-color: #86efac; color: #166534; }
    .sat-focus-balanced     { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
    .sat-focus-thorough     { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }

    /* Annotation type — off state */
    .sat-type { opacity: 0.45; }

    /* On states */
    .sat-type-on { opacity: 1; background: #fef9f0; border-color: #fcd34d; color: #92400e; }
    .sat-type-on.sat-type-green  { background: #f0fdf4; border-color: #86efac; color: #166534; }
    .sat-type-on.sat-type-purple { background: #faf5ff; border-color: #d8b4fe; color: #6b21a8; }

    .sat-label {
        font-size: 9px;
        font-weight: 500;
        color: #9ca3af;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        white-space: nowrap;
        user-select: none;
    }
</style>
