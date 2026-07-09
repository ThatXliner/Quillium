<!-- AutoAIWidget.svelte — Compact controls for Quillium's quiet reviewer. -->
<script lang="ts">
import { resolveWritingStage, type WritingStagePreference } from "$lib/ai/editor";
import { hasApiKey } from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { documentContent } from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
import { SettingsIcon, XIcon } from "lucide-svelte";
import { get } from "svelte/store";
import { onDestroy, onMount } from "svelte";
import AutoAIFace, { type FaceState } from "./AutoAIFace.svelte";
import {
    autoAIPhase,
    autoAIWritingStage,
    startAutoAI,
    stopAutoAI,
    triggerManualReview,
} from "./engine";
import { createFaceAnimation } from "./faceAnimation.svelte";
import { autoAISettings, persistAutoAISettings } from "./settings.svelte";

const stageOptions: Array<{ value: WritingStagePreference; label: string }> = [
    { value: "auto", label: "Auto" },
    { value: "discovering", label: "Discovering" },
    { value: "shaping", label: "Shaping" },
    { value: "refining", label: "Refining" },
    { value: "proofing", label: "Proofing" },
];

const stageLabels = {
    discovering: "Discovering",
    shaping: "Shaping",
    refining: "Refining",
    proofing: "Proofing",
} as const;

let open = $state(false);
let widgetEl = $state<HTMLDivElement | null>(null);
const noApiKey = $derived(!hasApiKey());
const inferredStage = $derived(resolveWritingStage("auto", $documentContent).stage);
const displayedStage = $derived(
    autoAISettings.stagePreference === "auto"
        ? stageLabels[inferredStage]
        : stageLabels[autoAISettings.stagePreference],
);

const face = createFaceAnimation({
    getWidgetEl: () => widgetEl,
    getIsPanelOpen: () => open,
    getCanSleep: () => autoAISettings.enabled && !noApiKey && get(autoAIPhase) === "idle",
});

const faceState = $derived<FaceState>(
    noApiKey
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

function toggleOpen(): void {
    open = !open;
    if (open) face.wakeSilently();
    else face.resetSleep();
}

function toggleEnabled(): void {
    if (noApiKey) return;
    autoAISettings.enabled = !autoAISettings.enabled;
    persistAutoAISettings();
    posthog.capture("autoai_toggled", { enabled: autoAISettings.enabled });
    if (autoAISettings.enabled) startAutoAI();
    else stopAutoAI();
}

function updateStage(event: Event): void {
    autoAISettings.stagePreference = (event.currentTarget as HTMLSelectElement)
        .value as WritingStagePreference;
    persistAutoAISettings();
    autoAIWritingStage.set(
        resolveWritingStage(autoAISettings.stagePreference, $documentContent).stage,
    );
    posthog.capture("autoai_stage_changed", {
        stage_preference: autoAISettings.stagePreference,
    });
}

function reviewNow(): void {
    posthog.capture("autoai_manual_review_triggered", {
        stage_preference: autoAISettings.stagePreference,
    });
    open = false;
    triggerManualReview();
}

function openSettings(): void {
    open = false;
    appEventBus.emit({ type: "ai-open-settings" });
}

function handleDocumentClick(event: MouseEvent): void {
    if (open && widgetEl && !widgetEl.contains(event.target as Node)) {
        open = false;
        face.resetSleep();
    }
}

onMount(() => {
    document.addEventListener("mousedown", handleDocumentClick);
    face.start();
    if (autoAISettings.enabled) startAutoAI();
});

onDestroy(() => {
    document.removeEventListener("mousedown", handleDocumentClick);
    face.stop();
    stopAutoAI();
});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={widgetEl}
    onclick={(event) => event.stopPropagation()}
    class="autoai-container {open ? 'is-open' : ''} {autoAISettings.enabled && !noApiKey && !open
        ? 'is-active'
        : ''}"
>
    <div class="bubble-layer {open ? 'is-hidden' : ''}">
        <button
            type="button"
            onclick={toggleOpen}
            aria-label={noApiKey
                ? "Quillium — add an API key to enable"
                : autoAISettings.enabled
                  ? `Quillium active — ${displayedStage}`
                  : "Quillium paused"}
            aria-expanded={open}
            class="bubble-button"
        >
            <AutoAIFace
                faceState={faceState}
                eyeOffsetX={face.eyeOffsetX}
                eyeOffsetY={face.eyeOffsetY}
            />
        </button>
    </div>

    <div class="panel-layer {open ? '' : 'is-hidden'}">
        <header class="panel-header">
            <div class="mini-face">
                <AutoAIFace faceState={faceState} eyeOffsetX={0} eyeOffsetY={0} />
            </div>
            <div class="header-copy">
                <strong>Quillium</strong>
                <span>
                    {#if noApiKey}Not configured
                    {:else if $autoAIPhase === "reviewing"}Reviewing
                    {:else if $autoAIPhase === "thinking"}Waiting for your pause
                    {:else if autoAISettings.enabled}Quiet review on
                    {:else}Paused{/if}
                </span>
            </div>
            <button
                type="button"
                role="switch"
                aria-label="Quiet review"
                aria-checked={autoAISettings.enabled}
                disabled={noApiKey}
                onclick={toggleEnabled}
                class="toggle {autoAISettings.enabled && !noApiKey ? 'on' : ''}"
            ><span></span></button>
            <button type="button" onclick={toggleOpen} class="icon-button" aria-label="Close">
                <XIcon size={14} />
            </button>
        </header>

        <div class="panel-body">
            <label class="stage-row">
                <span>Writing stage</span>
                <select
                    value={autoAISettings.stagePreference}
                    onchange={updateStage}
                    disabled={noApiKey}
                >
                    {#each stageOptions as option}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
            </label>
            {#if autoAISettings.stagePreference === "auto"}
                <p class="stage-result">Detected: {displayedStage}</p>
            {/if}

            {#if noApiKey}
                <button type="button" onclick={openSettings} class="settings-button">
                    <SettingsIcon size={14} />
                    Configure AI
                </button>
            {:else}
                <button type="button" onclick={reviewNow} class="review-button">
                    Review now
                    <Kbd keys={["⌘", "⇧", "R"]} />
                </button>
            {/if}
        </div>
    </div>
</div>

<style>
    .autoai-container {
        position: relative;
        width: 67px;
        height: 67px;
        overflow: hidden;
        border: 2px solid #d6b87a;
        border-radius: 100px;
        background: #faf8f5;
        box-shadow: 0 4px 12px rgb(0 0 0 / 12%);
        transition: width 260ms ease, height 260ms ease, border-radius 260ms ease;
    }

    .autoai-container.is-open {
        width: 300px;
        height: 196px;
        border-color: #e4ddd1;
        border-radius: 8px;
    }

    .autoai-container.is-active {
        border-color: #2f8f78;
    }

    .bubble-layer,
    .panel-layer {
        position: absolute;
        inset: 0;
        transition: opacity 140ms ease;
    }

    .is-hidden {
        pointer-events: none;
        opacity: 0;
    }

    .bubble-button {
        display: flex;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: inherit;
        background: transparent;
        cursor: pointer;
    }

    .panel-layer {
        display: flex;
        flex-direction: column;
    }

    .panel-header {
        display: flex;
        min-height: 58px;
        align-items: center;
        gap: 8px;
        border-bottom: 1px solid rgb(0 0 0 / 8%);
        padding: 10px 12px;
    }

    .mini-face {
        display: flex;
        width: 34px;
        height: 34px;
        flex: 0 0 34px;
        transform: scale(0.7);
        align-items: center;
        justify-content: center;
    }

    .header-copy {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-direction: column;
        color: rgb(0 0 0 / 72%);
        font-size: 12px;
    }

    .header-copy span {
        margin-top: 2px;
        color: rgb(0 0 0 / 40%);
        font-size: 10px;
    }

    .toggle {
        position: relative;
        width: 30px;
        height: 18px;
        flex: 0 0 30px;
        border: 0;
        border-radius: 9px;
        background: rgb(0 0 0 / 15%);
        cursor: pointer;
    }

    .toggle span {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: white;
        transition: transform 160ms ease;
    }

    .toggle.on {
        background: #2f8f78;
    }

    .toggle.on span {
        transform: translateX(12px);
    }

    .icon-button {
        display: flex;
        width: 26px;
        height: 26px;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: rgb(0 0 0 / 35%);
        cursor: pointer;
    }

    .panel-body {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
    }

    .stage-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: rgb(0 0 0 / 55%);
        font-size: 11px;
        font-weight: 600;
    }

    .stage-row select {
        min-width: 112px;
        border: 1px solid rgb(0 0 0 / 12%);
        border-radius: 4px;
        background: white;
        padding: 5px 7px;
        color: rgb(0 0 0 / 68%);
        font-size: 11px;
    }

    .stage-result {
        margin: -3px 0 1px;
        color: rgb(0 0 0 / 36%);
        font-size: 10px;
        text-align: right;
    }

    .review-button,
    .settings-button {
        display: flex;
        min-height: 34px;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: 0;
        border-radius: 5px;
        background: #2f6f65;
        color: white;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }
</style>
