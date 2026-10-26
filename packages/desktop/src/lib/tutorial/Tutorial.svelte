<!--
    Tutorial.svelte — Full-screen guided tour overlay.

    Renders a semi-transparent backdrop with an SVG spotlight mask
    that highlights one UI element at a time, alongside a floating
    tooltip card with step content and navigation controls.

    Lifecycle:
      1. On mount, the overlay fades in and the first step's target
         element is spotlighted.
      2. The user navigates forward/back through the step list defined
         in ./steps.ts. Each step change triggers repositioning of the
         spotlight and tooltip via the `$effect` on `step`.
      3. On completion (or skip), the component persists a
         "quillium_tutorial_seen" flag to localStorage, fires a PostHog
         analytics event, sets `tutorialActive = false`, and calls the
         parent's `onComplete` callback.

    State interactions:
      - Writes `tutorialActive` (store) to false on complete/skip.
      - Reads `steps` from ./steps.ts for step content and selectors.
      - Fires PostHog events: "tutorial_completed" / "tutorial_skipped".
-->
<script lang="ts">
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import type { Annotation, GenericAnnotation } from "$lib/editor/plugins/annotations";
import posthog from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import {
    annotations,
    modalStack,
    tutorialActive,
    tutorialModalGuide,
    tutorialNavCommand,
} from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
import { onDestroy, onMount } from "svelte";
import { type Step, steps } from "./steps";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";
const opt = isMac ? "⌥" : "Alt";

function resolveKeys(keys: string[]): string[] {
    return keys.map((k) => {
        if (k === "mod") return mod;
        if (k === "alt") return opt;
        return k;
    });
}

const shortcutGroups = [
    {
        title: "Navigation",
        shortcuts: [
            { keys: [mod, "O"], label: "Open library" },
            { keys: [mod, "Shift", "S"], label: "Name this version" },
        ],
    },
    {
        title: "AI Panels",
        shortcuts: [
            { keys: [mod, "⇧", "1"], label: "Chat" },
            { keys: [mod, "⇧", "2"], label: "Feedback" },
            { keys: [mod, "⇧", "3"], label: "Revise" },
            { keys: [mod, "⇧", "4"], label: "Context" },
            { keys: ["Esc"], label: "Close sidebar" },
        ],
    },
    {
        title: "Annotations",
        shortcuts: [
            { keys: [mod, "⇧", "C"], label: "Add comment" },
            { keys: [mod, opt, "K"], label: "Add revision" },
            { keys: [mod, "E"], label: "Enter revision editor" },
            { keys: [mod, "/"], label: "Reply to annotation" },
            { keys: [mod, "↵"], label: "New revision version (in editor)" },
            { keys: [mod, "↵"], label: "Send reply" },
        ],
    },
];

const { onComplete }: { onComplete: () => void } = $props();

type SectionKey = "ai" | "nested" | "shortcuts";

let stepIndex = $state(0);
let spotlightRects = $state<DOMRect[]>([]);
let tooltipEl = $state<HTMLDivElement | null>(null);
let tooltipPos = $state({ top: 0, left: 0 });
let visible = $state(false);
let sectionPickerOpen = $state(true);

let includeAi = $state(appSettings.aiEnabled);
let includeNested = $state(true);
let includeShortcuts = $state(true);

let lastStepId = $state<string | null>(null);

let nestedGuideState = $state({
    baselineTopLevelRevisionIds: null as number[] | null,
    createdRevisionId: null as number | null,
});

const activeSteps = $derived(
    steps.filter((s) => {
        if (s.section === "core") return true;
        if (s.section === "ai") return includeAi;
        if (s.section === "nested") return includeNested;
        if (s.section === "shortcuts") return includeShortcuts;
        return true;
    }),
);

const step = $derived(activeSteps[stepIndex]);
const isFirst = $derived(stepIndex === 0);
const isLast = $derived(stepIndex === activeSteps.length - 1);

const requirementState = $derived(getRequirementState(step));
const nextDisabled = $derived(!!requirementState && !requirementState.met);
const stepNeedsInteraction = $derived(!!requirementState && !requirementState.met);
const useInlineModalGuide = $derived(
    !sectionPickerOpen && !!step?.requirement && $modalStack.length > 0,
);

function setSection(section: SectionKey, checked: boolean) {
    if (section === "ai") includeAi = checked;
    if (section === "nested") includeNested = checked;
    if (section === "shortcuts") includeShortcuts = checked;
}

function resetNestedGuideState() {
    nestedGuideState = {
        baselineTopLevelRevisionIds: null,
        createdRevisionId: null,
    };
}

function getTopLevelRevisions(): Annotation<"revision">[] {
    const annotationValues: GenericAnnotation[] = Array.isArray($annotations)
        ? $annotations
        : Object.values($annotations ?? {});
    return annotationValues.filter(
        (annotation): annotation is Annotation<"revision"> => annotation._type === "revision",
    );
}

function handleStepEnter(currentStep: Step) {
    if (currentStep.section !== "nested" && $modalStack.length > 0) {
        modalStack.clear();
    }

    if (!includeNested) return;

    if (currentStep.requirement === "createRevision") {
        nestedGuideState.baselineTopLevelRevisionIds = getTopLevelRevisions().map((r) => r.id);
        nestedGuideState.createdRevisionId = null;
    }
}

function getEffectiveSelector(currentStep: Step | undefined): string | null {
    if (!currentStep) return null;
    if (currentStep.selector) return currentStep.selector;

    if (currentStep.requirement === "openRevisionModal") {
        if (nestedGuideState.createdRevisionId !== null) {
            return `.annotation-scroll-container [data-tutorial-action="expand-revision-modal"][data-revision-id="${nestedGuideState.createdRevisionId}"]`;
        }
        return '.annotation-scroll-container [data-tutorial-action="expand-revision-modal"]';
    }

    return null;
}

function getTargetRects(currentStep: Step | undefined): DOMRect[] {
    const selector = getEffectiveSelector(currentStep);
    const rects: DOMRect[] = [];

    if (selector) {
        const el = document.querySelector(selector);
        if (el) rects.push(el.getBoundingClientRect());
    }

    return rects;
}

/**
 * Recompute spotlight rect and tooltip position for the
 * current step. Called on every step change and on mount.
 */
function positionTooltip() {
    if (sectionPickerOpen) return;
    const rects = getTargetRects(step);
    spotlightRects = rects;
    const primaryRect = rects[0] ?? null;

    if (!tooltipEl || !step) return;
    const tipW = tooltipEl.offsetWidth || 320;
    const tipH = tooltipEl.offsetHeight || 220;
    tooltipPos = computeTooltipPos(primaryRect, step.position, tipW, tipH);
}

function getRequirementState(currentStep: Step | undefined): { met: boolean; hint: string } | null {
    if (!currentStep?.requirement) return null;

    if (currentStep.requirement === "createRevision") {
        return {
            met: nestedGuideState.createdRevisionId !== null,
            hint: `Action required: select some text, and press ${mod}+${opt}+K`,
        };
    }

    if (currentStep.requirement === "openRevisionModal") {
        const createdId = nestedGuideState.createdRevisionId;
        const opened =
            createdId !== null &&
            $modalStack.some(
                (entry) => entry.type === "revision" && entry.revisionId === createdId,
            );
        return {
            met: opened,
            hint:
                createdId === null
                    ? "Create your first revision first."
                    : "Action required: click the expand button on the revision card.",
        };
    }

    return null;
}

function startTour() {
    sectionPickerOpen = false;
    lastStepId = null;
    resetNestedGuideState();
    // If shortcuts is the only optional section selected, jump straight to it.
    if (includeShortcuts && !includeAi && !includeNested) {
        const idx = activeSteps.findIndex((s) => s.id === "keyboard-shortcuts");
        stepIndex = idx >= 0 ? idx : 0;
    } else {
        stepIndex = 0;
    }
    posthog.capture("tutorial_started", {
        total_steps: activeSteps.length,
        include_ai: includeAi,
        include_nested: includeNested,
        include_shortcuts: includeShortcuts,
    });
    setTimeout(positionTooltip, 80);
}

function computeTooltipPos(
    rect: DOMRect | null,
    position: Step["position"],
    tipW: number,
    tipH: number,
): { top: number; left: number } {
    const pad = 16;
    const vw = window.innerWidth;
    // Clamp to the VISUAL viewport, not the layout viewport: on mobile the
    // software keyboard shrinks visualViewport but NOT window.innerHeight, so
    // clamping to innerHeight lets the tooltip slide under the keyboard. Falls
    // back to innerHeight on desktop / when the API is unavailable.
    const vh = window.visualViewport?.height ?? window.innerHeight;

    if (!rect || position === "center") {
        return {
            top: vh / 2 - tipH / 2,
            left: vw / 2 - tipW / 2,
        };
    }

    let top: number;
    let left: number;

    switch (position) {
        case "right":
            top = Math.min(Math.max(rect.top + rect.height / 2 - tipH / 2, pad), vh - tipH - pad);
            left = Math.min(rect.right + pad, vw - tipW - pad);
            break;
        case "left":
            top = Math.min(Math.max(rect.top + rect.height / 2 - tipH / 2, pad), vh - tipH - pad);
            left = Math.max(rect.left - tipW - pad, pad);
            break;
        case "bottom":
            top = Math.min(rect.bottom + pad, vh - tipH - pad);
            left = Math.min(Math.max(rect.left + rect.width / 2 - tipW / 2, pad), vw - tipW - pad);
            break;
        case "top":
            top = Math.max(rect.top - tipH - pad, pad);
            left = Math.min(Math.max(rect.left + rect.width / 2 - tipW / 2, pad), vw - tipW - pad);
            break;
        default:
            return { top: vh / 2 - tipH / 2, left: vw / 2 - tipW / 2 };
    }

    return { top, left };
}

/** Move to the next step, or finish the tour on the last step. */
function advance() {
    if (nextDisabled) return;
    if (isLast) {
        complete();
        return;
    }
    posthog.capture("tutorial_step_advanced", {
        from_step: step.id,
        from_step_index: stepIndex + 1,
        total_steps: activeSteps.length,
    });
    stepIndex++;
}

/** Move to the previous step (no-op on the first step). */
function back() {
    if (!isFirst) {
        posthog.capture("tutorial_step_back", {
            from_step: step.id,
            from_step_index: stepIndex + 1,
            total_steps: activeSteps.length,
        });
        stepIndex--;
    }
}

/**
 * End the tutorial — persist the "seen" flag, fire analytics,
 * hide the overlay, and notify the parent via onComplete.
 */
function complete(skipped = false) {
    tutorialModalGuide.set({
        visible: false,
        title: "",
        body: "",
        hint: null,
        nextDisabled: false,
        isLast: false,
        canBack: false,
    });
    visible = false;
    localStorage.setItem("quillium_tutorial_seen", "true");
    if (skipped) {
        posthog.capture("tutorial_skipped", {
            step_reached: stepIndex + 1,
            total_steps: steps.length,
        });
    } else {
        posthog.capture("tutorial_completed", { total_steps: steps.length });
    }
    $tutorialActive = false;
    onComplete();
}

function skip() {
    complete(true);
}

$effect(() => {
    const command = $tutorialNavCommand;
    if (!command) return;
    tutorialNavCommand.set(null);

    if (command === "next") advance();
    if (command === "back") back();
    if (command === "skip") skip();
});

// Detect nested tutorial progress from live app state
$effect(() => {
    if (!includeNested || sectionPickerOpen) return;

    void $annotations;
    void $modalStack;

    if (
        nestedGuideState.createdRevisionId === null &&
        nestedGuideState.baselineTopLevelRevisionIds !== null
    ) {
        const baseline = nestedGuideState.baselineTopLevelRevisionIds;
        const newRevision = getTopLevelRevisions().find(
            (revision) => !baseline.includes(revision.id),
        );
        if (newRevision) nestedGuideState.createdRevisionId = newRevision.id;
    }
});

// Handle step-enter side effects
$effect(() => {
    if (sectionPickerOpen) return;
    const currentStep = step;
    if (!currentStep) return;
    if (lastStepId === currentStep.id) return;

    lastStepId = currentStep.id;
    handleStepEnter(currentStep);
    setTimeout(positionTooltip, 60);
});

// Reposition while UI changes during interactive steps
$effect(() => {
    if (sectionPickerOpen) return;
    void stepIndex;
    void $annotations;
    void $modalStack;
    setTimeout(positionTooltip, 60);
});

$effect(() => {
    if (!useInlineModalGuide || !step) {
        tutorialModalGuide.set({
            visible: false,
            title: "",
            body: "",
            hint: null,
            nextDisabled: false,
            isLast: false,
            canBack: false,
        });
        return;
    }

    tutorialModalGuide.set({
        visible: true,
        title: step.title,
        body: step.body,
        hint: requirementState?.met
            ? "Action complete. Continue when ready."
            : (requirementState?.hint ?? null),
        nextDisabled,
        isLast,
        canBack: !isFirst,
    });
});

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") skip();
}

// On mount, reveal the overlay.
// Re-clamp the tooltip when the software keyboard opens/closes — visualViewport
// resizes (window does not), and a step's tooltip can otherwise be left under
// the keyboard. See computeTooltipPos for the matching clamp.
const onViewportResize = () => positionTooltip();

onMount(() => {
    visible = true;
    window.visualViewport?.addEventListener("resize", onViewportResize);
});

onDestroy(() => {
    window.visualViewport?.removeEventListener("resize", onViewportResize);
    tutorialModalGuide.set({
        visible: false,
        title: "",
        body: "",
        hint: null,
        nextDisabled: false,
        isLast: false,
        canBack: false,
    });
});

let restoreSize = $state<(() => void) | undefined>();
</script>

<svelte:window onkeydown={handleKeydown} />

{#if visible}
    <div
        class="fixed inset-0 z-[9998]"
        style="pointer-events: {sectionPickerOpen || !stepNeedsInteraction ? 'all' : 'none'};"
        role="dialog"
        aria-modal="true"
        aria-label="Tutorial"
    >
        {#if !sectionPickerOpen}
            <svg
                class="absolute inset-0 w-full h-full"
                style="pointer-events: none;"
                aria-hidden="true"
            >
                <defs>
                    <mask id="tutorial-mask">
                        <rect width="100%" height="100%" fill="white" />
                        {#each spotlightRects as rect}
                            <rect
                                x={rect.left - 6}
                                y={rect.top - 6}
                                width={rect.width + 12}
                                height={rect.height + 12}
                                rx="12"
                                ry="12"
                                fill="black"
                            />
                        {/each}
                    </mask>
                </defs>
                <rect
                    width="100%"
                    height="100%"
                    fill="rgba(0,0,0,0.55)"
                    mask="url(#tutorial-mask)"
                />
            </svg>

            {#each spotlightRects as rect}
                <div
                    class="absolute rounded-xl pointer-events-none"
                    style="
                        top: {rect.top - 6}px;
                        left: {rect.left - 6}px;
                        width: {rect.width + 12}px;
                        height: {rect.height + 12}px;
                        box-shadow: 0 0 0 2px rgba(255,255,255,0.35);
                        transition: all 220ms ease;
                    "
                ></div>
            {/each}
        {:else}
            <!--
                Backdrop dismiss is intentionally only available on the
                section-picker (this initial modal), not during the guided
                tour. Once the tour is running the overlay locks the user in
                so they can't accidentally exit mid-flow by clicking outside.
                The only way to exit the tour is via the explicit "End tour"
                / "Skip" button inside the tooltip card.
            -->
            <button
                type="button"
                class="absolute inset-0 bg-black/55 border-0 p-0"
                aria-label="Dismiss tutorial"
                onclick={skip}
            ></button>
        {/if}

        {#if sectionPickerOpen}
            <!--
                Two layers on purpose. The OUTER wrapper carries the shadow + radius but NO
                overflow clip; the INNER carries the backdrop-blur + radius + overflow-hidden.
                In WebKit (Tauri) backdrop-filter + radius leaks a square blur halo unless
                overflow:hidden, but overflow:hidden + box-shadow squares the shadow. Splitting
                fixes both: shadow stays rounded (outer) and blur is clipped to radius (inner).
            -->
            <div
                class="flex flex-col absolute pointer-events-auto top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] shadow-xl rounded-2xl"
                role="document"
            >
              <div
                class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto backdrop-blur-md bg-gray-300/85 border border-white/40 rounded-2xl p-5 flex flex-col gap-4"
              >
                <div>
                    <div class="flex min-h-[26px] items-center justify-between gap-2">
                        <h3 class="text-sm font-semibold text-black/80 mb-1">Choose Tutorial Sections</h3>
                        <RestoreSizeButton {restoreSize} />
                    </div>
                    <p class="text-xs text-black/60 leading-relaxed">Core editor basics are always included. Toggle optional sections below.</p>
                </div>

                <div class="flex flex-col gap-2">
                    <label class="flex items-start gap-2 p-2 rounded-lg bg-white/45 border border-white/40">
                        <input
                            type="checkbox"
                            checked={includeNested}
                            onchange={(e) => setSection("nested", (e.currentTarget as HTMLInputElement).checked)}
                            class="mt-0.5"
                        />
                        <span>
                            <span class="block text-xs font-medium text-black/80">Nested Revision Walkthrough</span>
                            <span class="block text-[11px] text-black/55">Interactive steps for creating and expanding nested revisions</span>
                        </span>
                    </label>

                    {#if appSettings.aiEnabled}
                    <label class="flex items-start gap-2 p-2 rounded-lg bg-white/45 border border-white/40">
                        <input
                            type="checkbox"
                            checked={includeAi}
                            onchange={(e) => setSection("ai", (e.currentTarget as HTMLInputElement).checked)}
                            class="mt-0.5"
                        />
                        <span>
                            <span class="block text-xs font-medium text-black/80">AI Tools Tour</span>
                            <span class="block text-[11px] text-black/55">Chat, Feedback, Revise, and Context buttons</span>
                        </span>
                    </label>
                    {/if}

                    <label class="flex items-start gap-2 p-2 rounded-lg bg-white/45 border border-white/40">
                        <input
                            type="checkbox"
                            checked={includeShortcuts}
                            onchange={(e) => setSection("shortcuts", (e.currentTarget as HTMLInputElement).checked)}
                            class="mt-0.5"
                        />
                        <span>
                            <span class="block text-xs font-medium text-black/80">Keyboard Shortcuts</span>
                            <span class="block text-[11px] text-black/55">Quick reference for all keyboard shortcuts</span>
                        </span>
                    </label>
                </div>

                <div class="flex items-center justify-between">
                    <button
                        onclick={skip}
                        class="text-[11px] text-black/35 hover:text-black/55 transition-colors"
                    >
                        Skip tour
                    </button>
                    <button
                        onclick={startTour}
                        class="text-xs px-3 py-1.5 rounded-full bg-blue-500 hover:bg-blue-600 text-white transition-colors font-medium"
                    >
                        Start tour
                    </button>
                </div>
              </div>
                <ModalResizeHandles bind:restoreSize />
            </div>
        {:else if step && !useInlineModalGuide}
            <!--
                Two layers on purpose. The OUTER wrapper carries the shadow + radius (and the
                bind:this + positioning style used for measurement/placement) but NO overflow
                clip; the INNER carries the backdrop-blur + radius + overflow-hidden. In WebKit
                (Tauri) backdrop-filter + radius leaks a square blur halo unless overflow:hidden,
                but overflow:hidden + box-shadow squares the shadow. Splitting fixes both: shadow
                stays rounded (outer) and blur is clipped to radius (inner).
            -->
            <div
                bind:this={tooltipEl}
                class="absolute pointer-events-auto shadow-xl rounded-2xl
                    {step.showShortcuts ? 'w-[420px]' : 'w-[320px]'}"
                style="
                    top: {tooltipPos.top}px;
                    left: {tooltipPos.left}px;
                    transition: top 220ms ease, left 220ms ease;
                "
                role="document"
            >
              <div
                class="overflow-hidden backdrop-blur-md bg-gray-300/90 border border-white/40 rounded-2xl p-5 flex flex-col gap-3"
              >
                <div class="flex items-center justify-between">
                    <div class="flex gap-1">
                        {#each activeSteps as _, i}
                            <div
                                class="w-1.5 h-1.5 rounded-full transition-colors duration-200 {i === stepIndex ? 'bg-blue-500' : 'bg-black/20'}"
                            ></div>
                        {/each}
                    </div>
                    <span class="text-[11px] text-black/40 font-medium">
                        {stepIndex + 1} / {activeSteps.length}
                    </span>
                </div>

                <div>
                    <h3 class="text-sm font-semibold text-black/80 mb-1">
                        {step.title}
                    </h3>
                    <p class="text-xs text-black/60 leading-relaxed">
                        {step.body}
                    </p>
                    {#if step.shortcutHint}
                        <div class="flex items-center gap-1.5 mt-1.5">
                            {#if step.shortcutHint.prefix}
                                <span class="text-[11px] text-black/50">{step.shortcutHint.prefix}</span>
                            {/if}
                            <Kbd keys={resolveKeys(step.shortcutHint.keys)} />
                        </div>
                    {/if}
                </div>

                {#if step.showShortcuts}
                    <div class="space-y-3 border-t border-black/10 pt-3">
                        {#each shortcutGroups as group}
                            <div>
                                <h4 class="text-[9px] font-semibold text-black/40 uppercase tracking-widest mb-1.5">
                                    {group.title}
                                </h4>
                                <div class="space-y-1">
                                    {#each group.shortcuts as shortcut}
                                        <div class="flex items-center justify-between">
                                            <span class="text-[11px] text-black/65">{shortcut.label}</span>
                                            <div class="flex items-center gap-0.5">
                                                <Kbd keys={shortcut.keys} />
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if requirementState}
                    <div
                        class="text-[11px] rounded-md px-2 py-1.5 border {requirementState.met
                            ? 'bg-green-50/80 text-green-700 border-green-200/80'
                            : 'bg-amber-50/80 text-amber-700 border-amber-200/80'}"
                    >
                        {requirementState.met ? "Action complete. Continue when ready." : requirementState.hint}
                    </div>
                {/if}

                <div class="flex items-center justify-between">
                    <button
                        onclick={skip}
                        class="text-[11px] text-black/35 hover:text-black/55 transition-colors"
                    >
                        Skip tour
                    </button>
                    <div class="flex gap-2">
                        {#if !isFirst}
                            <button
                                onclick={back}
                                class="text-xs px-3 py-1.5 rounded-full bg-white/50 hover:bg-white/70 text-black/60 hover:text-black/80 transition-colors border border-white/30"
                            >
                                Back
                            </button>
                        {/if}
                        <button
                            onclick={advance}
                            disabled={nextDisabled}
                            class="text-xs px-3 py-1.5 rounded-full text-white transition-colors font-medium {nextDisabled ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}"
                        >
                            {isLast ? "Done" : "Next"}
                        </button>
                    </div>
                </div>
              </div>
            </div>
        {/if}
    </div>
{/if}
