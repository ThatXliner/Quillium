<!-- AutoAIWidget.svelte — Configurable background reviewer with morphing bubble UI. -->
<script lang="ts">
import { hasApiKey } from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import Kbd from "$lib/ui/Kbd.svelte";
import { PencilIcon, SettingsIcon, XIcon } from "lucide-svelte";
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

const annotationOptions: Array<{
    type: AutoAIAnnotationType;
    label: string;
    activeClass: string;
}> = [
    { type: "comment", label: "Comments", activeClass: "comment-active" },
    { type: "suggestion", label: "Suggestions", activeClass: "suggestion-active" },
    { type: "revision", label: "Revisions", activeClass: "revision-active" },
];

const depthLevels: AutoAIConservativeness[] = ["conservative", "balanced", "thorough"];
const depthLabels: Record<AutoAIConservativeness, string> = {
    conservative: "Conservative",
    balanced: "Balanced",
    thorough: "Thorough",
};
const depthDescriptions: Record<AutoAIConservativeness, string> = {
    conservative: "Clear issues only",
    balanced: "Style and clarity too",
    thorough: "Reviews everything",
};

let open = $state(false);
let editingName = $state(false);
let widgetEl = $state<HTMLDivElement | null>(null);
let nameInputEl = $state<HTMLInputElement | null>(null);

const noApiKey = $derived(!hasApiKey());
const locked = $derived(noApiKey || !autoAISettings.enabled);
const debounceSeconds = $derived(Math.round(autoAISettings.debounceMs / 1000));
const depthIndex = $derived(depthLevels.indexOf(autoAISettings.conservativeness));

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
    editingName = false;
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

function setMode(mode: AutoAIMode): void {
    autoAISettings.mode = mode;
    persistAutoAISettings();
    posthog.capture("autoai_mode_changed", { mode });
}

function updateDelay(event: Event): void {
    const seconds = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    if (Number.isNaN(seconds)) return;
    autoAISettings.debounceMs = seconds * 1000;
    persistAutoAISettings();
    posthog.capture("autoai_settings_changed", { setting: "delay", value: seconds });
}

function toggleAnnotationType(type: AutoAIAnnotationType): void {
    if (autoAISettings.annotationTypes.includes(type)) {
        if (autoAISettings.annotationTypes.length === 1) return;
        autoAISettings.annotationTypes = autoAISettings.annotationTypes.filter(
            (item) => item !== type,
        );
    } else {
        autoAISettings.annotationTypes = [...autoAISettings.annotationTypes, type];
    }
    persistAutoAISettings();
    posthog.capture("autoai_settings_changed", {
        setting: "annotation_types",
        value: autoAISettings.annotationTypes,
    });
}

function updateDepth(event: Event): void {
    const index = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    autoAISettings.conservativeness = depthLevels[index];
    persistAutoAISettings();
    posthog.capture("autoai_settings_changed", {
        setting: "depth",
        value: autoAISettings.conservativeness,
    });
}

function startEditingName(): void {
    editingName = true;
    setTimeout(() => nameInputEl?.focus(), 0);
}

function updateName(event: Event): void {
    autoAISettings.persona = (event.currentTarget as HTMLInputElement).value;
    persistAutoAISettings();
}

function finishEditingName(): void {
    editingName = false;
    if (!autoAISettings.persona.trim()) autoAISettings.persona = "AutoAI";
    persistAutoAISettings();
}

function handleNameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === "Escape") finishEditingName();
}

function reviewNow(): void {
    posthog.capture("autoai_manual_review_triggered", {
        mode: autoAISettings.mode,
        depth: autoAISettings.conservativeness,
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
    class="autoai-container {open ? 'is-open' : ''} {autoAISettings.enabled && !locked && !open
        ? 'is-active'
        : ''}"
>
    <div class="layer bubble-layer {open ? 'hidden-layer' : ''}">
        <button
            type="button"
            onclick={toggleOpen}
            aria-label={noApiKey
                ? "AutoAI — add an API key to enable"
                : autoAISettings.enabled
                  ? "AutoAI active — click to configure"
                  : "AutoAI paused — click to configure"}
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

    <div class="layer panel-layer {open ? '' : 'hidden-layer'}">
        <header class="panel-header">
            <div class="mini-face">
                <AutoAIFace faceState={faceState} eyeOffsetX={0} eyeOffsetY={0} />
            </div>
            <div class="name-wrap">
                {#if editingName}
                    <input
                        bind:this={nameInputEl}
                        value={autoAISettings.persona}
                        oninput={updateName}
                        onblur={finishEditingName}
                        onkeydown={handleNameKeydown}
                        maxlength="20"
                        aria-label="AutoAI name"
                        class="name-input"
                    />
                {:else}
                    <strong>{autoAISettings.persona}</strong>
                    <button type="button" onclick={startEditingName} aria-label="Edit name" class="icon-button small">
                        <PencilIcon size={10} />
                    </button>
                {/if}
                <span>
                    {#if noApiKey}Not configured
                    {:else if $autoAIPhase === "reviewing"}Reviewing
                    {:else if $autoAIPhase === "thinking"}Waiting
                    {:else if autoAISettings.enabled && autoAISettings.mode === "continuous"}Active · {debounceSeconds}s
                    {:else if autoAISettings.enabled}Active · manual
                    {:else}Paused{/if}
                </span>
            </div>
            <button
                type="button"
                role="switch"
                aria-label="Enable AutoAI"
                aria-checked={autoAISettings.enabled}
                disabled={noApiKey}
                onclick={toggleEnabled}
                class="toggle {autoAISettings.enabled && !noApiKey ? 'on' : ''}"
            ><span></span></button>
            <button type="button" onclick={toggleOpen} class="icon-button" aria-label="Close">
                <XIcon size={13} />
            </button>
        </header>

        <div class="panel-body {locked ? 'locked' : ''}">
            <div class="field-row">
                <span class="field-label">MODE</span>
                <div class="segmented">
                    <button
                        type="button"
                        onclick={() => setMode("continuous")}
                        class:active={autoAISettings.mode === "continuous"}
                    >Auto</button>
                    <button
                        type="button"
                        onclick={() => setMode("manual")}
                        class:active={autoAISettings.mode === "manual"}
                    >Manual</button>
                </div>
            </div>

            {#if autoAISettings.mode === "continuous"}
                <div class="field-stack">
                    <div class="field-heading">
                        <label for="autoai-delay" class="field-label">DELAY</label>
                        <span>{debounceSeconds}s</span>
                    </div>
                    <input
                        id="autoai-delay"
                        type="range"
                        min="2"
                        max="60"
                        value={debounceSeconds}
                        oninput={updateDelay}
                    />
                </div>
            {/if}

            <div class="field-stack">
                <span class="field-label">FIND</span>
                <div class="pills">
                    {#each annotationOptions as option}
                        <button
                            type="button"
                            aria-pressed={autoAISettings.annotationTypes.includes(option.type)}
                            onclick={() => toggleAnnotationType(option.type)}
                            class="pill {autoAISettings.annotationTypes.includes(option.type)
                                ? option.activeClass
                                : ''}"
                        >{option.label}</button>
                    {/each}
                </div>
            </div>

            <div class="field-stack">
                <div class="field-heading">
                    <span class="field-label">DEPTH</span>
                    <span>{depthLabels[autoAISettings.conservativeness]} · {depthDescriptions[autoAISettings.conservativeness]}</span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="2"
                    value={depthIndex}
                    oninput={updateDepth}
                    aria-label="Review depth"
                />
            </div>
        </div>

        <footer class="panel-footer">
            {#if noApiKey}
                <button type="button" onclick={openSettings} class="settings-button">
                    <SettingsIcon size={13} /> Configure AI
                </button>
            {:else}
                <button type="button" onclick={reviewNow} class="review-button">
                    Review now <Kbd keys={["⌘", "⇧", "R"]} />
                </button>
            {/if}
        </footer>
    </div>
</div>

<style>
    .autoai-container {
        position: relative;
        width: 67px;
        height: 67px;
        overflow: hidden;
        border: 2px solid #d6b87a;
        /*
         * IMPORTANT: keep this finite and equal to half the collapsed size.
         * `rounded-full`/9999px makes WebKit interpolate toward an effectively
         * infinite radius, which snaps at the end and breaks the morph animation.
         */
        border-radius: 33.5px;
        background: #faf8f5;
        box-shadow: 0 4px 12px rgb(0 0 0 / 12%), 0 1px 3px rgb(0 0 0 / 8%);
        transition:
            width 340ms cubic-bezier(0.33, 0, 0.2, 1),
            height 340ms cubic-bezier(0.33, 0, 0.2, 1),
            border-radius 340ms cubic-bezier(0.33, 0, 0.2, 1),
            border-color 200ms ease;
    }

    .autoai-container.is-open {
        width: 320px;
        height: 360px;
        border-color: #e8e0d4;
        border-radius: 16px;
    }

    .autoai-container.is-active {
        border-color: #d6b87a;
        box-shadow: 0 0 0 2px rgb(214 184 122 / 15%), 0 4px 12px rgb(0 0 0 / 12%);
    }

    .layer {
        position: absolute;
        inset: 0;
        transition: opacity 150ms ease;
    }

    .hidden-layer {
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
        gap: 7px;
        border-bottom: 1px solid rgb(0 0 0 / 8%);
        padding: 9px 11px;
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

    .name-wrap {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-wrap: wrap;
        align-items: center;
        gap: 3px;
        color: rgb(0 0 0 / 72%);
        font-size: 12px;
    }

    .name-wrap span {
        width: 100%;
        color: rgb(0 0 0 / 38%);
        font-size: 10px;
    }

    .name-input {
        width: 105px;
        border: 0;
        border-bottom: 1px solid rgb(0 0 0 / 18%);
        background: transparent;
        color: rgb(0 0 0 / 72%);
        font-size: 12px;
        font-weight: 600;
        outline: none;
    }

    .icon-button {
        display: flex;
        width: 25px;
        height: 25px;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: rgb(0 0 0 / 32%);
        cursor: pointer;
    }

    .icon-button:hover {
        background: rgb(255 255 255 / 65%);
        color: rgb(0 0 0 / 55%);
    }

    .icon-button.small {
        width: 18px;
        height: 18px;
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
        background: #b68d42;
    }

    .toggle.on span {
        transform: translateX(12px);
    }

    .panel-body {
        display: flex;
        min-height: 0;
        flex: 1;
        flex-direction: column;
        gap: 15px;
        overflow-y: auto;
        padding: 13px 14px;
        transition: opacity 160ms ease;
    }

    .panel-body.locked {
        pointer-events: none;
        opacity: 0.42;
    }

    .field-row,
    .field-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
    }

    .field-stack {
        display: flex;
        flex-direction: column;
        gap: 7px;
    }

    .field-label {
        color: rgb(0 0 0 / 36%);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0;
    }

    .field-heading > span:last-child {
        color: rgb(0 0 0 / 40%);
        font-size: 10px;
    }

    .segmented {
        display: grid;
        width: 164px;
        grid-template-columns: 1fr 1fr;
        border-radius: 5px;
        background: rgb(0 0 0 / 6%);
        padding: 2px;
    }

    .segmented button {
        border: 0;
        border-radius: 4px;
        background: transparent;
        padding: 5px 7px;
        color: rgb(0 0 0 / 42%);
        font-size: 10px;
        cursor: pointer;
    }

    .segmented button.active {
        background: white;
        box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
        color: rgb(0 0 0 / 68%);
    }

    input[type="range"] {
        width: 100%;
        accent-color: #b68d42;
    }

    .pills {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 5px;
    }

    .pill {
        min-width: 0;
        border: 1px solid rgb(0 0 0 / 10%);
        border-radius: 5px;
        background: rgb(255 255 255 / 45%);
        padding: 6px 4px;
        color: rgb(0 0 0 / 35%);
        font-size: 10px;
        cursor: pointer;
    }

    .comment-active {
        border-color: rgb(59 130 246 / 25%);
        background: rgb(59 130 246 / 9%);
        color: #2563eb;
    }

    .suggestion-active {
        border-color: rgb(16 185 129 / 25%);
        background: rgb(16 185 129 / 9%);
        color: #047857;
    }

    .revision-active {
        border-color: rgb(139 92 246 / 25%);
        background: rgb(139 92 246 / 9%);
        color: #7c3aed;
    }

    .panel-footer {
        border-top: 1px solid rgb(0 0 0 / 8%);
        padding: 10px 12px;
    }

    .review-button,
    .settings-button {
        display: flex;
        width: 100%;
        min-height: 33px;
        align-items: center;
        justify-content: center;
        gap: 7px;
        border: 0;
        border-radius: 5px;
        background: #a47c35;
        color: white;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
    }
</style>
