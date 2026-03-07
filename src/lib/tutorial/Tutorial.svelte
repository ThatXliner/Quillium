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
    import { onMount, onDestroy } from "svelte";
    import { tutorialActive, annotations, modalStack, tutorialModalGuide, tutorialNavCommand } from "$lib/stores";
    import type { Annotation, GenericAnnotation } from "$lib/editor/plugins/annotations";
    import { steps, type Step } from "./steps";
    import posthog from "posthog-js";

    const { onComplete }: { onComplete: () => void } = $props();

    type SectionKey = "ai" | "nested";

    let stepIndex = $state(0);
    let spotlightRects = $state<DOMRect[]>([]);
    let tooltipEl = $state<HTMLDivElement | null>(null);
    let tooltipPos = $state({ top: 0, left: 0 });
    let visible = $state(false);
    let sectionPickerOpen = $state(true);

    let includeAi = $state(true);
    let includeNested = $state(true);

    let lastStepId = $state<string | null>(null);

    let nestedGuideState = $state({
        baselineTopLevelRevisionIds: [] as number[],
        createdRevisionId: null as number | null,
        baselineNestedRevisionIds: [] as number[],
        createdNestedRevisionId: null as number | null,
    });

    const activeSteps = $derived(
        steps.filter((s) => {
            if (s.section === "core") return true;
            if (s.section === "ai") return includeAi;
            if (s.section === "nested") return includeNested;
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
        !sectionPickerOpen
            && !!step?.requirement
            && $modalStack.length > 0,
    );

    function setSection(section: SectionKey, checked: boolean) {
        if (section === "ai") includeAi = checked;
        if (section === "nested") includeNested = checked;
    }

    function resetNestedGuideState() {
        nestedGuideState = {
            baselineTopLevelRevisionIds: [],
            createdRevisionId: null,
            baselineNestedRevisionIds: [],
            createdNestedRevisionId: null,
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

    function getRevisionById(id: number): Annotation<"revision"> | undefined {
        return getTopLevelRevisions().find((revision) => revision.id === id);
    }

    function getNestedRevisionIds(revision: Annotation<"revision"> | undefined): number[] {
        if (!revision) return [];
        const activeVersion = revision.versions[revision.currentlySelected] as Record<string, unknown> | undefined;
        if (!activeVersion || !("annotationField" in activeVersion)) return [];

        const annotationField = activeVersion.annotationField;
        if (!annotationField || typeof annotationField !== "object") return [];

        const nested = Object.values(annotationField as Record<string, unknown>)
            .filter((x): x is { _type: string; id: number } => (
                typeof x === "object"
                && x !== null
                && "_type" in x
                && "id" in x
                && (x as { _type: string })._type === "revision"
                && typeof (x as { id: unknown }).id === "number"
            ))
            .map((x) => x.id);

        return nested;
    }

    function handleStepEnter(currentStep: Step) {
        if (currentStep.section !== "nested" && $modalStack.length > 0) {
            modalStack.clear();
        }

        if (!includeNested) return;

        if (currentStep.requirement === "createRevision") {
            nestedGuideState.baselineTopLevelRevisionIds = getTopLevelRevisions().map((r) => r.id);
            nestedGuideState.createdRevisionId = null;
            nestedGuideState.baselineNestedRevisionIds = [];
            nestedGuideState.createdNestedRevisionId = null;
        }

        if (currentStep.requirement === "createNestedRevision" && nestedGuideState.createdRevisionId !== null) {
            const revision = getRevisionById(nestedGuideState.createdRevisionId);
            nestedGuideState.baselineNestedRevisionIds = getNestedRevisionIds(revision);
            nestedGuideState.createdNestedRevisionId = null;
        }
    }

    function getEffectiveSelector(currentStep: Step | undefined): string | null {
        if (!currentStep) return null;
        if (currentStep.selector) return currentStep.selector;

        if (currentStep.requirement === "openRevisionModal") {
            if (nestedGuideState.createdRevisionId !== null) {
                return `.annotation-scroll-container [data-tutorial-action="expand-revision-modal"][data-revision-id="${nestedGuideState.createdRevisionId}"]`;
            }
            return ".annotation-scroll-container [data-tutorial-action=\"expand-revision-modal\"]";
        }

        if (currentStep.requirement === "openNestedRevisionModal") {
            if (nestedGuideState.createdNestedRevisionId !== null) {
                return `.revision-modal [data-tutorial-action="expand-revision-modal"][data-revision-id="${nestedGuideState.createdNestedRevisionId}"]`;
            }
            return ".revision-modal [data-tutorial-action=\"expand-revision-modal\"]";
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

        // During nested-creation, also spotlight the nested revision expand button
        // once it appears so users can immediately see the next control.
        if (currentStep?.requirement === "createNestedRevision") {
            const expandSelector = nestedGuideState.createdNestedRevisionId !== null
                ? `.revision-modal [data-tutorial-action="expand-revision-modal"][data-revision-id="${nestedGuideState.createdNestedRevisionId}"]`
                : ".revision-modal [data-tutorial-action=\"expand-revision-modal\"]";
            const expandButton = document.querySelector(expandSelector);
            if (expandButton) rects.push(expandButton.getBoundingClientRect());
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
                hint: "Action required: create a revision with Ctrl/Cmd + Alt + K on selected text.",
            };
        }

        if (currentStep.requirement === "openRevisionModal") {
            const createdId = nestedGuideState.createdRevisionId;
            const opened = createdId !== null
                && $modalStack.some((entry) => entry.type === "revision" && entry.revisionId === createdId);
            return {
                met: opened,
                hint: createdId === null
                    ? "Create your first revision first."
                    : "Action required: click the expand button on the revision card.",
            };
        }

        if (currentStep.requirement === "createNestedRevision") {
            return {
                met: nestedGuideState.createdNestedRevisionId !== null,
                hint: "Action required: in the modal editor, select text and press Ctrl/Cmd + Alt + K.",
            };
        }

        if (currentStep.requirement === "openNestedRevisionModal") {
            const nestedId = nestedGuideState.createdNestedRevisionId;
            const topModal = $modalStack[$modalStack.length - 1];
            const opened = nestedId !== null
                && $modalStack.length >= 2
                && topModal?.type === "revision"
                && topModal.revisionId === nestedId;
            return {
                met: opened,
                hint: nestedId === null
                    ? "Create a nested revision in the modal first."
                    : "Action required: expand the nested revision from the modal sidebar.",
            };
        }

        return null;
    }

    function startTour() {
        sectionPickerOpen = false;
        stepIndex = 0;
        lastStepId = null;
        resetNestedGuideState();
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
        const vh = window.innerHeight;

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
        stepIndex++;
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

        if (nestedGuideState.createdRevisionId === null && nestedGuideState.baselineTopLevelRevisionIds.length > 0) {
            const newRevision = getTopLevelRevisions().find(
                (revision) => !nestedGuideState.baselineTopLevelRevisionIds.includes(revision.id),
            );
            if (newRevision) nestedGuideState.createdRevisionId = newRevision.id;
        }

        if (nestedGuideState.createdRevisionId !== null && nestedGuideState.createdNestedRevisionId === null) {
            const revision = getRevisionById(nestedGuideState.createdRevisionId);
            const nestedIds = getNestedRevisionIds(revision);
            const newNestedRevisionId = nestedIds.find(
                (id) => !nestedGuideState.baselineNestedRevisionIds.includes(id),
            );
            if (newNestedRevisionId !== undefined) nestedGuideState.createdNestedRevisionId = newNestedRevisionId;
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
            hint: requirementState?.met ? "Action complete. Continue when ready." : (requirementState?.hint ?? null),
            nextDisabled,
            isLast,
            canBack: !isFirst,
        });
    });

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") skip();
    }

    // On mount, reveal the overlay.
    onMount(() => {
        visible = true;
    });

    onDestroy(() => {
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
            <button
                type="button"
                class="absolute inset-0 bg-black/55 border-0 p-0"
                aria-label="Dismiss tutorial"
                onclick={skip}
            ></button>
        {/if}

        {#if sectionPickerOpen}
            <div
                class="absolute pointer-events-auto top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] backdrop-blur-md bg-gray-300/85 border border-white/40 shadow-xl rounded-2xl p-5 flex flex-col gap-4"
                role="document"
            >
                <div>
                    <h3 class="text-sm font-semibold text-black/80 mb-1">Choose Tutorial Sections</h3>
                    <p class="text-xs text-black/60 leading-relaxed">Core editor basics are always included. Toggle optional sections below.</p>
                </div>

                <div class="flex flex-col gap-2">
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
        {:else if step && !useInlineModalGuide}
            <div
                bind:this={tooltipEl}
                class="absolute pointer-events-auto w-[320px] backdrop-blur-md bg-gray-300/80 border border-white/40 shadow-xl rounded-2xl p-5 flex flex-col gap-3"
                style="
                    top: {tooltipPos.top}px;
                    left: {tooltipPos.left}px;
                    transition: top 220ms ease, left 220ms ease;
                "
                role="document"
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
                </div>

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
        {/if}
    </div>
{/if}
