<!--
    AISidebar.svelte — Top-level container for all AI features.

    This component renders a floating, resizable sidebar anchored to the
    left edge of the viewport. It acts as a shell/router for the five AI
    panels: Chat, Feedback, Revise, DocumentContext, and AISettings.

    UI states:
      - Collapsed (pill): a narrow vertical strip of icon buttons.
      - Expanded: a resizable panel showing the active sub-panel with a
        header row of icon tabs, title bar, and close/settings controls.

    State variables:
      `action`         — which panel is active (null = collapsed).
      `customWidth/Height` — user-resized dimensions (null = defaults).
      `isResizing`     — true during a drag-resize (disables CSS
                         transitions so the panel tracks the cursor).

    The sidebar reads `aiProcessing.active` from settings.svelte.ts to
    show a rainbow glow animation while any AI request is in flight.

    All five sub-panels are mounted eagerly (visibility toggled via CSS)
    to avoid re-mount jank when switching tabs.

    Dependencies: Chat, Feedback, Revise, DocumentContext, AISettings
    components; aiProcessing from settings.svelte.ts; posthog analytics.
-->
<script lang="ts">
/*
 * AISidebar.svelte
 *
 * Top-level container and tab router for all AI feature panels.
 *
 * Renders:
 *   A fixed, resizable sidebar anchored to the left viewport edge.
 *   Two visual states: collapsed pill (icon buttons) and expanded
 *   panel (icon tabs + active sub-panel).
 *
 * Props: none (standalone root component).
 * Events: none dispatched.
 *
 * Stores read:
 *   - aiProcessing.active (settings.svelte.ts) — drives the rainbow
 *     glow animation while any AI request is in flight.
 *
 * Stores written: none.
 *
 * Children: Chat, Feedback, Revise, DocumentContext, AISettings.
 *   All five sub-panels are mounted eagerly and toggled via CSS
 *   visibility to avoid re-mount jank on tab switches.
 *
 * Resize system:
 *   - `startResize` attaches window-level mousemove/mouseup listeners.
 *   - `onResizeMove` clamps deltas to [MIN, MAX] width/height.
 *   - `onResizeEnd` cleans up listeners and resets cursor overrides.
 *   - `isResizing` disables CSS transitions so the panel tracks the
 *     cursor without animation lag.
 */
import { tick } from "svelte";
import Chat from "./Chat.svelte";
import Feedback from "./Feedback.svelte";
import Revise from "./Revise.svelte";
import AISettings from "./AISettings.svelte";
import DocumentContext from "./DocumentContext.svelte";
import {
	MessageCircleIcon,
	ZapIcon,
	PenLineIcon,
	XIcon,
	Settings2Icon,
	CompassIcon,
	Minimize2Icon,
} from "lucide-svelte";
import { aiProcessing } from "$lib/ai/settings.svelte";
import posthog from "posthog-js";

type Action = null | "chat" | "feedback" | "revise" | "context" | "settings";
let action = $state<Action>(null);

const actions: {
	id: NonNullable<Action>;
	icon: any;
	label: string;
	activeClass: string;
	hoverClass: string;
}[] = [
	{
		id: "chat",
		icon: MessageCircleIcon,
		label: "Chat",
		activeClass: "text-blue-600 bg-white/60",
		hoverClass: "hover:text-blue-600",
	},
	{
		id: "feedback",
		icon: ZapIcon,
		label: "Feedback",
		activeClass: "text-green-600 bg-white/60",
		hoverClass: "hover:text-green-600",
	},
	{
		id: "revise",
		icon: PenLineIcon,
		label: "Revise",
		activeClass: "text-purple-600 bg-white/60",
		hoverClass: "hover:text-purple-600",
	},
	{
		id: "context",
		icon: CompassIcon,
		label: "Document Context",
		activeClass: "text-amber-600 bg-white/60",
		hoverClass: "hover:text-amber-600",
	},
];

const panelTitles: Record<NonNullable<Action>, string> = {
	chat: "Chat with AI",
	feedback: "Get Feedback",
	revise: "Revise & Rewrite",
	context: "Document Context",
	settings: "AI Settings",
};

const expanded = $derived(action !== null);
// Remember to also update the CSS style on line 212
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 520;
const MIN_WIDTH = 240;
const MAX_WIDTH = 600;
const MIN_HEIGHT = 400;
const MAX_HEIGHT = 800;

let customWidth = $state<number | null>(null);
let customHeight = $state<number | null>(null);
let isResizing = $state(false);

// Plain vars — not reactive, only used inside handlers
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartWidth = 0;
let resizeStartHeight = 0;
let activeHandle: "right" | "bottom" | "corner" | null = null;
let justResized = false;

const effectiveWidth = $derived(customWidth ?? DEFAULT_WIDTH);
const effectiveHeight = $derived(customHeight ?? DEFAULT_HEIGHT);
const isCustomSize = $derived(customWidth !== null || customHeight !== null);

// Inline style only when expanded AND user has resized (overrides Tailwind)
const containerSizeStyle = $derived(
	expanded && (customWidth !== null || customHeight !== null)
		? `width: ${effectiveWidth}px; height: ${effectiveHeight}px;`
		: "",
);

// Disable transition during active drag; keep it for expand/collapse
const transitionClass = $derived(
	isResizing
		? ""
		: "transition-[width,height,border-radius] duration-[340ms] ease-[cubic-bezier(0.33,0,0.2,1)]",
);

let container: HTMLDivElement;
let iconStrip = $state<HTMLDivElement>();
let iconEls = $state<HTMLButtonElement[]>([]);

function handleClickOutside(e: MouseEvent) {
	if (justResized) {
		justResized = false;
		return;
	}
	const target = e.target as Node;
	if (
		expanded &&
		container &&
		!container.contains(target) &&
		!(target as Element).closest?.(".cm-editor")
	) {
		action = null;
	}
}

function selectAction(id: NonNullable<Action>) {
	action = id;
	posthog.capture("ai_sidebar_opened", { mode: id });
	scrollActiveIntoCenter(id);
}

function scrollActiveIntoCenter(id: NonNullable<Action>) {
	tick().then(() => {
		if (!iconStrip) return;
		const idx = actions.findIndex((a) => a.id === id);
		const el = iconEls[idx];
		if (!el) return;
		const stripRect = iconStrip.getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		const offset =
			elRect.left -
			stripRect.left +
			elRect.width / 2 -
			stripRect.width / 2;
		iconStrip.scrollBy({ left: offset, behavior: "smooth" });
	});
}

function resetSize() {
	customWidth = null;
	customHeight = null;
}

function startResize(e: MouseEvent, handle: "right" | "bottom" | "corner") {
	e.preventDefault();
	e.stopPropagation();
	activeHandle = handle;
	resizeStartX = e.clientX;
	resizeStartY = e.clientY;
	resizeStartWidth = effectiveWidth;
	resizeStartHeight = effectiveHeight;
	isResizing = true;
	window.addEventListener("mousemove", onResizeMove);
	window.addEventListener("mouseup", onResizeEnd);
	document.body.style.userSelect = "none";
	document.body.style.cursor =
		handle === "right"
			? "ew-resize"
			: handle === "bottom"
				? "ns-resize"
				: "nwse-resize";
}

function onResizeMove(e: MouseEvent) {
	if (!activeHandle) return;
	const dx = e.clientX - resizeStartX;
	const dy = e.clientY - resizeStartY;
	if (activeHandle === "right" || activeHandle === "corner") {
		customWidth = Math.min(
			MAX_WIDTH,
			Math.max(MIN_WIDTH, resizeStartWidth + dx),
		);
	}
	if (activeHandle === "bottom" || activeHandle === "corner") {
		customHeight = Math.min(
			MAX_HEIGHT,
			Math.max(MIN_HEIGHT, resizeStartHeight + dy),
		);
	}
}

function onResizeEnd() {
	isResizing = false;
	activeHandle = null;
	justResized = true;
	window.removeEventListener("mousemove", onResizeMove);
	window.removeEventListener("mouseup", onResizeEnd);
	document.body.style.userSelect = "";
	document.body.style.cursor = "";
}

// Center the active icon whenever the panel opens
$effect(() => {
	if (expanded && action && action !== "settings") {
		scrollActiveIntoCenter(action);
	}
});

// Cleanup resize listeners on unmount
$effect(() => {
	return () => {
		window.removeEventListener("mousemove", onResizeMove);
		window.removeEventListener("mouseup", onResizeEnd);
		document.body.style.userSelect = "";
		document.body.style.cursor = "";
	};
});
</script>

<svelte:window onclick={handleClickOutside} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    id="ai-sidebar"
    bind:this={container}
    onclick={(e) => e.stopPropagation()}
    style={containerSizeStyle}
    class="
        fixed left-4 top-1/2 -translate-y-1/2 z-50
        backdrop-blur-md bg-gray-300/70 border border-white/30 shadow-lg
        overflow-hidden {transitionClass}
        {expanded ? 'w-[320px] h-[520px] rounded-[14px]' : 'w-[52px] h-[240px] rounded-[100px]'}
        {aiProcessing.active ? 'ai-processing' : ''}
    "
>
    <!-- Collapsed pill icons -->
    <div
        class="absolute inset-0 flex flex-col items-center py-3 px-2 transition-opacity duration-150
            {expanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}"
    >
        <div class="flex flex-col gap-1">
            {#each actions as a}
                <button
                    id="ai-tab-{a.id}"
                    onclick={() => { action = a.id; posthog.capture("ai_sidebar_opened", { mode: a.id }); }}
                    aria-label={a.label}
                    title={a.label}
                    class="p-2 rounded-full text-black/50 transition-colors {a.hoverClass}"
                >
                    <a.icon size={18} />
                </button>
            {/each}
        </div>
        <div class="flex-1"></div>
        <button
            onclick={() => (action = "settings")}
            aria-label="AI Settings"
            title="AI Settings"
            class="p-2 rounded-full text-black/30 hover:text-black/60 transition-colors"
        >
            <Settings2Icon size={15} />
        </button>
    </div>

    <!-- Expanded panel -->
    <div
        class="w-full h-full flex flex-col transition-opacity duration-150
            {expanded ? 'opacity-100 delay-[80ms]' : 'opacity-0 pointer-events-none'}"
    >
        <!-- Row 1: icon wheel -->
        <div class="shrink-0 pt-2.5 pb-1">
            <div
                bind:this={iconStrip}
                class="flex items-center gap-0.5 overflow-x-auto px-4 scroll-smooth"
                style="scrollbar-width: none; -ms-overflow-style: none; mask-image: linear-gradient(to right, transparent 0%, black 18%, black 82%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0%, black 18%, black 82%, transparent 100%);"
            >
                {#each actions as a, i}
                    {@const activeIdx = actions.findIndex(x => x.id === action)}
                    {@const dist = Math.abs(i - activeIdx)}
                    {@const scale = activeIdx < 0 ? 1 : dist === 0 ? 1 : dist === 1 ? 0.88 : 0.76}
                    {@const opacity = activeIdx < 0 ? 0.5 : dist === 0 ? 1 : dist === 1 ? 0.45 : 0.25}
                    <button
                        bind:this={iconEls[i]}
                        onclick={() => selectAction(a.id)}
                        aria-label={a.label}
                        title={a.label}
                        style="transform: scale({scale}); opacity: {opacity};"
                        class="p-2 rounded-full shrink-0 transition-all duration-200
                            {action === a.id
                                ? a.activeClass
                                : 'text-black/70 hover:bg-white/30'}"
                    >
                        <a.icon size={16} />
                    </button>
                {/each}
            </div>
        </div>

        <!-- Row 2: title + reset + settings + close -->
        <div class="flex items-center px-3 pb-2 shrink-0">
            <span class="flex-1 text-xs font-semibold text-black/50 truncate">
                {action ? panelTitles[action] : ""}
            </span>
            {#if isCustomSize}
                <button
                    onclick={resetSize}
                    aria-label="Reset to default size"
                    title="Reset size"
                    class="p-1.5 rounded-full text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors shrink-0"
                >
                    <Minimize2Icon size={14} />
                </button>
            {/if}
            <button
                onclick={() => (action = action === "settings" ? null : "settings")}
                aria-label="AI Settings"
                title="AI Settings"
                class="p-1.5 rounded-full transition-colors shrink-0
                    {action === 'settings'
                        ? 'text-black/60 bg-white/60'
                        : 'text-black/30 hover:text-black/60 hover:bg-white/40'}"
            >
                <Settings2Icon size={14} />
            </button>
            <button
                onclick={() => (action = null)}
                aria-label="Close"
                class="p-1.5 rounded-full text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors shrink-0"
            >
                <XIcon size={14} />
            </button>
        </div>

        <div class="w-full h-px bg-black/10 shrink-0"></div>

        <!-- Content — all panels mounted upfront to avoid mount-time jank -->
        <div class="flex-1 flex flex-col min-h-0 relative">
            <div class="absolute inset-0 flex flex-col {action === 'chat' ? '' : 'hidden'}"><Chat /></div>
            <div class="absolute inset-0 flex flex-col {action === 'feedback' ? '' : 'hidden'}"><Feedback /></div>
            <div class="absolute inset-0 flex flex-col {action === 'revise' ? '' : 'hidden'}"><Revise /></div>
            <div class="absolute inset-0 overflow-y-auto {action === 'context' ? '' : 'hidden'}"><DocumentContext /></div>
            <div class="absolute inset-0 flex flex-col {action === 'settings' ? '' : 'hidden'}"><AISettings /></div>
        </div>
    </div>

    {#if expanded}
        <div
            role="separator"
            aria-label="Resize width"
            aria-orientation="vertical"
            class="resize-handle resize-handle-right"
            onmousedown={(e) => startResize(e, "right")}
        ></div>
        <div
            role="separator"
            aria-label="Resize height"
            aria-orientation="horizontal"
            class="resize-handle resize-handle-bottom"
            onmousedown={(e) => startResize(e, "bottom")}
        ></div>
        <div
            role="separator"
            aria-label="Resize panel"
            class="resize-handle resize-handle-corner"
            onmousedown={(e) => startResize(e, "corner")}
        ></div>
    {/if}
</div>

<style>
    div[style*="scrollbar-width"]::-webkit-scrollbar {
        display: none;
    }

    .resize-handle {
        position: absolute;
        z-index: 10;
    }

    .resize-handle-right {
        top: 14px;
        bottom: 14px;
        right: 0;
        width: 6px;
        cursor: ew-resize;
    }

    .resize-handle-bottom {
        left: 14px;
        right: 14px;
        bottom: 0;
        height: 6px;
        cursor: ns-resize;
    }

    .resize-handle-corner {
        right: 0;
        bottom: 0;
        width: 14px;
        height: 14px;
        cursor: nwse-resize;
    }

    .resize-handle-right::after {
        content: "";
        position: absolute;
        top: 25%;
        bottom: 25%;
        right: 2px;
        width: 2px;
        border-radius: 9999px;
        background-color: transparent;
        transition: background-color 200ms ease;
    }

    .resize-handle-right:hover::after {
        background-color: rgba(0, 0, 0, 0.18);
    }

    .resize-handle-bottom::after {
        content: "";
        position: absolute;
        left: 25%;
        right: 25%;
        bottom: 2px;
        height: 2px;
        border-radius: 9999px;
        background-color: transparent;
        transition: background-color 200ms ease;
    }

    .resize-handle-bottom:hover::after {
        background-color: rgba(0, 0, 0, 0.18);
    }

    .resize-handle-corner::after {
        content: "";
        position: absolute;
        right: 3px;
        bottom: 3px;
        width: 5px;
        height: 5px;
        border-right: 2px solid rgba(0, 0, 0, 0.2);
        border-bottom: 2px solid rgba(0, 0, 0, 0.2);
        border-radius: 1px;
        opacity: 0;
        transition: opacity 200ms ease;
    }

    .resize-handle-corner:hover::after {
        opacity: 1;
    }

    /* AI processing glow — reads aiProcessing.active from settings.svelte.ts.
       To remove this effect, delete this block and the {aiProcessing.active ? 'ai-processing' : ''}
       class binding on the container div. No other files need changing. */
    @keyframes rainbow-glow {
        0%   { box-shadow: 0 0 0 2px rgba(99,102,241,0.5),  0 0 16px 4px rgba(99,102,241,0.25); }
        25%  { box-shadow: 0 0 0 2px rgba(168,85,247,0.5),  0 0 16px 4px rgba(168,85,247,0.25); }
        50%  { box-shadow: 0 0 0 2px rgba(236,72,153,0.5),  0 0 16px 4px rgba(236,72,153,0.25); }
        75%  { box-shadow: 0 0 0 2px rgba(251,146,60,0.5),  0 0 16px 4px rgba(251,146,60,0.25); }
        100% { box-shadow: 0 0 0 2px rgba(99,102,241,0.5),  0 0 16px 4px rgba(99,102,241,0.25); }
    }

    .ai-processing {
        animation: rainbow-glow 2s linear infinite;
    }

    @media (prefers-reduced-motion: reduce) {
        * { transition-duration: 0.01ms !important; }
        .ai-processing { animation: none; }
    }
</style>
