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
    import { onMount } from "svelte";
    import { tutorialActive } from "$lib/stores";
    import { steps } from "./steps";
    import posthog from "posthog-js";

    const { onComplete }: { onComplete: () => void } = $props();

    // ── Local UI state ───────────────────────────────────────────
    let stepIndex = $state(0);
    let spotlightRect = $state<DOMRect | null>(null);
    let tooltipStyle = $state(
        "top: 50%; left: 50%; transform: translate(-50%, -50%);",
    );
    let visible = $state(false);

    // ── Derived values from step index ───────────────────────────
    const step = $derived(steps[stepIndex]);
    const isFirst = $derived(stepIndex === 0);
    const isLast = $derived(stepIndex === steps.length - 1);

    /** Resolve a CSS selector to a bounding rect, or null if
     *  no selector is given or the element isn't in the DOM. */
    function getTargetRect(
        selector: string | null,
    ): DOMRect | null {
        if (!selector) return null;
        const el = document.querySelector(selector);
        return el ? el.getBoundingClientRect() : null;
    }

    /**
     * Recompute spotlight rect and tooltip position for the
     * current step. Called on every step change and on mount.
     */
    function positionTooltip() {
	const rect = getTargetRect(step.selector);
	spotlightRect = rect;

	if (!rect || step.position === "center") {
		tooltipStyle = "top: 50%; left: 50%; transform: translate(-50%, -50%);";
		return;
	}

	const pad = 16;
	const tipW = 280;
	const tipH = 180;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	let top: number;
	let left: number;

	switch (step.position) {
		case "right":
			top = Math.min(
				Math.max(rect.top + rect.height / 2 - tipH / 2, pad),
				vh - tipH - pad,
			);
			left = Math.min(rect.right + pad, vw - tipW - pad);
			break;
		case "left":
			top = Math.min(
				Math.max(rect.top + rect.height / 2 - tipH / 2, pad),
				vh - tipH - pad,
			);
			left = Math.max(rect.left - tipW - pad, pad);
			break;
		case "bottom":
			top = Math.min(rect.bottom + pad, vh - tipH - pad);
			left = Math.min(
				Math.max(rect.left + rect.width / 2 - tipW / 2, pad),
				vw - tipW - pad,
			);
			break;
		case "top":
			top = Math.max(rect.top - tipH - pad, pad);
			left = Math.min(
				Math.max(rect.left + rect.width / 2 - tipW / 2, pad),
				vw - tipW - pad,
			);
			break;
		default:
			tooltipStyle =
				"top: 50%; left: 50%; transform: translate(-50%, -50%);";
			return;
	}

	tooltipStyle = `top: ${top}px; left: ${left}px; transition: top 220ms ease, left 220ms ease;`;
}

    /** Move to the next step, or finish the tour on the last step. */
    function advance() {
        if (isLast) complete();
        else stepIndex++;
    }

    /** Move to the previous step (no-op on the first step). */
    function back() {
        if (!isFirst) stepIndex--;
    }

    /**
     * End the tutorial — persist the "seen" flag, fire analytics,
     * hide the overlay, and notify the parent via onComplete.
     */
    function complete(skipped = false) {
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

    // Reposition spotlight + tooltip whenever the active step changes.
    $effect(() => {
        void step;
        positionTooltip();
    });

    // On mount, reveal the overlay and position the first step.
    onMount(() => {
        visible = true;
        positionTooltip();
    });
</script>

{#if visible}
    <div
        class="fixed inset-0 z-[9998]"
        style="pointer-events: all;"
        role="dialog"
        aria-modal="true"
        aria-label="Tutorial"
    >
        <!-- SVG spotlight mask -->
        <svg
            class="absolute inset-0 w-full h-full"
            style="pointer-events: none;"
            aria-hidden="true"
        >
            <defs>
                <mask id="tutorial-mask">
                    <rect width="100%" height="100%" fill="white" />
                    {#if spotlightRect}
                        <rect
                            x={spotlightRect.left - 6}
                            y={spotlightRect.top - 6}
                            width={spotlightRect.width + 12}
                            height={spotlightRect.height + 12}
                            rx="12"
                            ry="12"
                            fill="black"
                        />
                    {/if}
                </mask>
            </defs>
            <rect
                width="100%"
                height="100%"
                fill="rgba(0,0,0,0.55)"
                mask="url(#tutorial-mask)"
            />
        </svg>

        <!-- Spotlight ring -->
        {#if spotlightRect}
            <div
                class="absolute rounded-xl pointer-events-none"
                style="
                    top: {spotlightRect.top - 6}px;
                    left: {spotlightRect.left - 6}px;
                    width: {spotlightRect.width + 12}px;
                    height: {spotlightRect.height + 12}px;
                    box-shadow: 0 0 0 2px rgba(255,255,255,0.35);
                    transition: all 220ms ease;
                "
            ></div>
        {/if}

        <!-- Tooltip card -->
        <div
            class="fixed w-[280px] backdrop-blur-md bg-gray-300/80 border border-white/40 shadow-xl rounded-2xl p-5 flex flex-col gap-3"
            style="{tooltipStyle} pointer-events: all;"
            role="document"
        >
            <!-- Step counter -->
            <div class="flex items-center justify-between">
                <div class="flex gap-1">
                    {#each steps as _, i}
                        <div
                            class="w-1.5 h-1.5 rounded-full transition-colors duration-200 {i === stepIndex ? 'bg-blue-500' : 'bg-black/20'}"
                        ></div>
                    {/each}
                </div>
                <span class="text-[11px] text-black/40 font-medium">
                    {stepIndex + 1} / {steps.length}
                </span>
            </div>

            <!-- Content -->
            <div>
                <h3 class="text-sm font-semibold text-black/80 mb-1">
                    {step.title}
                </h3>
                <p class="text-xs text-black/60 leading-relaxed">
                    {step.body}
                </p>
            </div>

            <!-- Actions -->
            <div class="flex items-center justify-between">
                <button
                    onclick={() => complete(true)}
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
                        class="text-xs px-3 py-1.5 rounded-full bg-blue-500 hover:bg-blue-600 text-white transition-colors font-medium"
                    >
                        {isLast ? "Done" : "Next"}
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}
