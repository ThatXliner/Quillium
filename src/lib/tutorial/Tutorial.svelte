<script lang="ts">
    import { onMount } from "svelte";
    import { tutorialActive } from "$lib/stores";
    import { steps } from "./steps";

    const { onComplete }: { onComplete: () => void } = $props();

    let stepIndex = $state(0);
    let spotlightRect = $state<DOMRect | null>(null);
    let tooltipEl = $state<HTMLDivElement | null>(null);
    let tooltipPos = $state({ top: 0, left: 0 });
    let visible = $state(false);

    const step = $derived(steps[stepIndex]);
    const isFirst = $derived(stepIndex === 0);
    const isLast = $derived(stepIndex === steps.length - 1);

    function getTargetRect(selector: string | null): DOMRect | null {
        if (!selector) return null;
        const el = document.querySelector(selector);
        return el ? el.getBoundingClientRect() : null;
    }

    function computeTooltipPos(
        rect: DOMRect | null,
        position: string,
        tipW: number,
        tipH: number,
    ): { top: number; left: number } {
        const pad = 16;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        if (!rect || position === "center") {
            return {
                top: vh / 2 - tipH / 2,
                left: vw / 2 - tipW / 2,
            };
        }

        switch (position) {
            case "right":
                return {
                    top: Math.min(
                        Math.max(rect.top + rect.height / 2 - tipH / 2, pad),
                        vh - tipH - pad,
                    ),
                    left: Math.min(rect.right + pad, vw - tipW - pad),
                };
            case "left":
                return {
                    top: Math.min(
                        Math.max(rect.top + rect.height / 2 - tipH / 2, pad),
                        vh - tipH - pad,
                    ),
                    left: Math.max(rect.left - tipW - pad, pad),
                };
            case "bottom":
                return {
                    top: Math.min(rect.bottom + pad, vh - tipH - pad),
                    left: Math.min(
                        Math.max(rect.left + rect.width / 2 - tipW / 2, pad),
                        vw - tipW - pad,
                    ),
                };
            case "top":
                return {
                    top: Math.max(rect.top - tipH - pad, pad),
                    left: Math.min(
                        Math.max(rect.left + rect.width / 2 - tipW / 2, pad),
                        vw - tipW - pad,
                    ),
                };
            default:
                return { top: vh / 2 - tipH / 2, left: vw / 2 - tipW / 2 };
        }
    }

    function positionTooltip() {
        const rect = getTargetRect(step.selector);
        spotlightRect = rect;

        if (!tooltipEl) return;
        const tipW = tooltipEl.offsetWidth || 280;
        const tipH = tooltipEl.offsetHeight || 180;
        tooltipPos = computeTooltipPos(rect, step.position, tipW, tipH);
    }

    function advance() {
        if (isLast) {
            complete();
        } else {
            stepIndex++;
        }
    }

    function back() {
        if (!isFirst) stepIndex--;
    }

    function complete() {
        visible = false;
        localStorage.setItem("quillium_tutorial_seen", "true");
        $tutorialActive = false;
        onComplete();
    }

    function skip() {
        complete();
    }

    // Reposition whenever step changes
    $effect(() => {
        void step; // track reactive dep
        // Wait a tick for DOM to settle
        setTimeout(positionTooltip, 60);
    });

    onMount(() => {
        visible = true;
        setTimeout(positionTooltip, 80);
    });
</script>

{#if visible}
    <!-- Overlay -->
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
            bind:this={tooltipEl}
            class="absolute w-[280px] backdrop-blur-md bg-gray-300/80 border border-white/40 shadow-xl rounded-2xl p-5 flex flex-col gap-3"
            style="
                top: {tooltipPos.top}px;
                left: {tooltipPos.left}px;
                transition: top 220ms ease, left 220ms ease;
                pointer-events: all;
            "
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
                        class="text-xs px-3 py-1.5 rounded-full bg-blue-500 hover:bg-blue-600 text-white transition-colors font-medium"
                    >
                        {isLast ? "Done" : "Next"}
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}
