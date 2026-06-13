<!--
    AISidebar.svelte — Top-level container for all AI features.

    This component renders a floating, resizable sidebar anchored to the
    left edge of the viewport. It acts as a shell/router for the six AI
    panels: Chat, Feedback, Revise, DocumentContext, Readers, and AISettings.

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

    Dependencies: Chat, Feedback, Revise, DocumentContext, Readers, AISettings
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
 * Children: Chat, Feedback, Revise, DocumentContext, Readers, AISettings.
 *   All six sub-panels are mounted eagerly and toggled via CSS
 *   visibility to avoid re-mount jank on tab switches.
 *
 * Resize system:
 *   - `startResize` attaches window-level pointermove/pointerup listeners
 *     (pointer events so touch drags work on tablets too).
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
import Readers from "./Readers.svelte";
import {
    MessageCircleIcon,
    ZapIcon,
    PenLineIcon,
    XIcon,
    SettingsIcon,
    CompassIcon,
    Minimize2Icon,
    UsersIcon,
    SquareIcon,
} from "lucide-svelte";
import { aiProcessing, hasApiKey, ensureApiKeyLoaded, stopAllAi } from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";

type Action = null | "chat" | "feedback" | "revise" | "context" | "readers" | "settings";
let action = $state<Action>(null);

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const actions: {
    id: NonNullable<Action>;
    icon: typeof MessageCircleIcon;
    label: string;
    shortcut: string;
    activeClass: string;
    hoverClass: string;
    requiresApiKey: boolean;
    preferredWidth?: number;
    preferredHeight?: number;
}[] = [
    {
        id: "chat",
        icon: MessageCircleIcon,
        label: "Chat",
        shortcut: isMac ? "⌘⇧1" : "Ctrl+Shift+1",
        activeClass: "text-blue-600 bg-white/60",
        hoverClass: "hover:text-blue-600",
        requiresApiKey: true,
        preferredHeight: 600,
    },
    {
        id: "feedback",
        icon: ZapIcon,
        label: "Feedback",
        shortcut: isMac ? "⌘⇧2" : "Ctrl+Shift+2",
        activeClass: "text-green-600 bg-white/60",
        hoverClass: "hover:text-green-600",
        requiresApiKey: true,
        preferredHeight: 600,
    },
    {
        id: "revise",
        icon: PenLineIcon,
        label: "Revise",
        shortcut: isMac ? "⌘⇧3" : "Ctrl+Shift+3",
        activeClass: "text-purple-600 bg-white/60",
        hoverClass: "hover:text-purple-600",
        requiresApiKey: true,
        preferredHeight: 600,
    },
    {
        id: "context",
        icon: CompassIcon,
        label: "Document Context",
        shortcut: isMac ? "⌘⇧4" : "Ctrl+Shift+4",
        activeClass: "text-amber-600 bg-white/60",
        hoverClass: "hover:text-amber-600",
        requiresApiKey: true,
        preferredWidth: 380,
    },
    {
        id: "readers",
        icon: UsersIcon,
        label: "Readers",
        shortcut: isMac ? "⌘⇧5" : "Ctrl+Shift+5",
        activeClass: "text-rose-600 bg-white/60",
        hoverClass: "hover:text-rose-600",
        requiresApiKey: true,
        preferredWidth: 440,
    },
];

const panelTitles: Record<NonNullable<Action>, string> = {
    chat: "Chat with AI",
    feedback: "Get Feedback",
    revise: "Revise & Rewrite",
    context: "Document Context",
    readers: "Reader Personas",
    settings: "AI Settings",
};

const expanded = $derived(action !== null);
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 520;
const MIN_WIDTH = 240;
const MAX_WIDTH = 600;
const MIN_HEIGHT = 400;
const MAX_HEIGHT = 800;

// On narrow viewports the fixed MAX_WIDTH/MAX_HEIGHT (600/800) overflow the
// screen, so clamp to a viewport-relative cap. On desktop these caps are far
// larger than MAX_WIDTH/MAX_HEIGHT, so behavior is unchanged there.
function widthCap(): number {
    if (typeof window === "undefined") return MAX_WIDTH;
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 32));
}
function heightCap(): number {
    if (typeof window === "undefined") return MAX_HEIGHT;
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - 64));
}

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

const defaultWidthForTab = $derived(
    actions.find((a) => a.id === action)?.preferredWidth ?? DEFAULT_WIDTH,
);
const defaultHeightForTab = $derived(
    actions.find((a) => a.id === action)?.preferredHeight ?? DEFAULT_HEIGHT,
);
const effectiveWidth = $derived(customWidth ?? defaultWidthForTab);
const effectiveHeight = $derived(customHeight ?? defaultHeightForTab);
const isCustomSize = $derived(customWidth !== null || customHeight !== null);

// Inline style when expanded: always set width/height so tab-specific defaults
// and reset-to-default transitions animate smoothly.
const containerSizeStyle = $derived(
    expanded ? `width: ${effectiveWidth}px; height: ${effectiveHeight}px;` : "",
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
let stripOverflows = $state(false);
let canScrollLeft = $state(false);
let canScrollRight = $state(false);

function updateScrollState() {
    if (!iconStrip) return;
    const el = iconStrip;
    stripOverflows = el.scrollWidth > el.clientWidth + 1;
    canScrollLeft = el.scrollLeft > 2;
    canScrollRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
}

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
        !(target as Element).closest?.(".cm-editor") &&
        !(target as Element).closest?.(".dictionary-popover") &&
        !(target as Element).closest?.(".dictionary-backdrop") &&
        !(target as Element).closest?.("#ai-stop-button")
    ) {
        action = null;
    }
}

function selectAction(id: NonNullable<Action>) {
    // Lazily load the API key from the keychain on first interaction,
    // avoiding the macOS keychain permission prompt on app startup.
    ensureApiKeyLoaded();
    const def = actions.find((a) => a.id === id);
    if (def?.requiresApiKey && !hasApiKey()) {
        action = "settings";
        return;
    }
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
        const offset = elRect.left - stripRect.left + elRect.width / 2 - stripRect.width / 2;
        iconStrip.scrollBy({ left: offset, behavior: "smooth" });
        // Update scroll state after animation settles
        setTimeout(updateScrollState, 350);
    });
}

function resetSize() {
    customWidth = null;
    customHeight = null;
}

// Pointer events (instead of mouse events) so dragging the resize handles
// works with touch on tablets as well as a mouse on desktop. The pointer is
// captured on the handle element so move/up events keep flowing even when the
// finger/cursor leaves the handle.
function startResize(e: PointerEvent, handle: "right" | "bottom" | "corner") {
    e.preventDefault();
    e.stopPropagation();
    activeHandle = handle;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartWidth = effectiveWidth;
    resizeStartHeight = effectiveHeight;
    isResizing = true;
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", onResizeEnd);
    window.addEventListener("pointercancel", onResizeEnd);
    document.body.style.userSelect = "none";
    document.body.style.cursor =
        handle === "right" ? "ew-resize" : handle === "bottom" ? "ns-resize" : "nwse-resize";
}

function onResizeMove(e: PointerEvent) {
    if (!activeHandle) return;
    const dx = e.clientX - resizeStartX;
    const dy = e.clientY - resizeStartY;
    if (activeHandle === "right" || activeHandle === "corner") {
        customWidth = Math.min(widthCap(), Math.max(MIN_WIDTH, resizeStartWidth + dx));
    }
    if (activeHandle === "bottom" || activeHandle === "corner") {
        customHeight = Math.min(heightCap(), Math.max(MIN_HEIGHT, resizeStartHeight + dy));
    }
}

function onResizeEnd() {
    isResizing = false;
    activeHandle = null;
    justResized = true;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeEnd);
    window.removeEventListener("pointercancel", onResizeEnd);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
}

function openAiSettingsFromExternalRequest() {
    action = "settings";
}

function openChatFromExternalRequest() {
    action = hasApiKey() ? "chat" : "settings";
}

// Center the active icon whenever the panel opens
$effect(() => {
    if (expanded && action && action !== "settings") {
        scrollActiveIntoCenter(action);
    }
});

// Track overflow/scroll state on the icon strip
$effect(() => {
    if (!iconStrip) return;
    const el = iconStrip;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
        el.removeEventListener("scroll", updateScrollState);
        ro.disconnect();
    };
});

// App-level event bus for cross-component AI navigation.
$effect(() => {
    return appEventBus.on("ai-open-settings", openAiSettingsFromExternalRequest);
});

// Cleanup resize listeners on unmount
$effect(() => {
    return () => {
        window.removeEventListener("pointermove", onResizeMove);
        window.removeEventListener("pointerup", onResizeEnd);
        window.removeEventListener("pointercancel", onResizeEnd);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
    };
});

// App-level requests to open the chat panel.
$effect(() => {
    return appEventBus.on("ai-open-chat", openChatFromExternalRequest);
});

// Keyboard shortcuts for the sidebar
const actionKeys: Record<string, NonNullable<Action>> = {
    "1": "chat",
    "2": "feedback",
    "3": "revise",
    "4": "context",
    "5": "readers",
};

function handleKeydown(e: KeyboardEvent) {
    // Escape closes the sidebar
    if (e.key === "Escape" && expanded) {
        // Only close if focus is not inside an input/textarea in the sidebar
        const target = e.target as HTMLElement;
        const isInInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
        if (!isInInput) {
            action = null;
        }
        return;
    }
    // Cmd/Ctrl+Shift+1-4 to open specific panels
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && actionKeys[e.key]) {
        e.preventDefault();
        selectAction(actionKeys[e.key]);
    }
}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

{#snippet kbdHint(key: string)}
    <span class="ml-auto text-[9px] font-mono opacity-50 bg-black/10 px-1 py-0.5 rounded">{key}</span>
{/snippet}

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
        {expanded ? 'w-[320px] h-[520px] rounded-[14px]' : 'w-[52px] h-[280px] rounded-[100px]'}
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
                {@const disabled = a.requiresApiKey && !hasApiKey()}
                <button
                    id="ai-tab-{a.id}"
                    onclick={() => selectAction(a.id)}
                    aria-label={disabled ? `${a.label} (add API key in settings)` : `${a.label} (${a.shortcut})`}
                    title={disabled ? `${a.label} — add an API key in settings` : `${a.label} ${a.shortcut}`}
                    class="p-2 rounded-full transition-colors
                        {disabled
                            ? 'text-black/20 cursor-pointer'
                            : 'text-black/50 ' + a.hoverClass}"
                >
                    <a.icon size={18} />
                </button>
            {/each}
        </div>
        <div class="flex-1"></div>
        <button
            onclick={() => (action = "settings")}
            aria-label={hasApiKey() ? "AI Settings" : "AI Settings — add an API key to get started"}
            title={hasApiKey() ? "AI Settings" : "AI Settings — add an API key to get started"}
            class="relative p-2 rounded-full transition-colors
                {hasApiKey() ? 'text-black/30 hover:text-black/60' : 'text-amber-600/80 hover:text-amber-700'}"
        >
            <SettingsIcon size={15} />
            {#if !hasApiKey()}
                <span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            {/if}
        </button>
    </div>

    <!-- Expanded panel -->
    <div
        class="w-full h-full flex flex-col transition-opacity duration-150
            {expanded ? 'opacity-100 delay-[80ms]' : 'opacity-0 invisible pointer-events-none'}"
    >
        <!-- Row 1: icon wheel -->
        <div class="shrink-0 pt-2.5 pb-1">
            <div
                bind:this={iconStrip}
                class="flex items-center gap-0.5 overflow-x-auto px-4 scroll-smooth"
                style="scrollbar-width: none; -ms-overflow-style: none;{stripOverflows
                    ? ` mask-image: linear-gradient(to right, ${canScrollLeft ? 'transparent 0%, black 18%' : 'black 0%'}, ${canScrollRight ? 'black 82%, transparent 100%' : 'black 100%'}); -webkit-mask-image: linear-gradient(to right, ${canScrollLeft ? 'transparent 0%, black 18%' : 'black 0%'}, ${canScrollRight ? 'black 82%, transparent 100%' : 'black 100%'});`
                    : ''}"
            >
                {#each actions as a, i}
                    {@const activeIdx = actions.findIndex(x => x.id === action)}
                    {@const dist = activeIdx < 0 ? 0 : Math.abs(i - activeIdx)}
                    {@const maxDist = activeIdx < 0 ? 1 : Math.max(activeIdx, actions.length - 1 - activeIdx)}
                    {@const t = maxDist === 0 ? 0 : dist / maxDist}
                    {@const opacity = activeIdx < 0 ? 0.7 : 1 - (1 - 0.45) * Math.sqrt(t)}
                    {@const disabled = a.requiresApiKey && !hasApiKey()}
                    <button
                        bind:this={iconEls[i]}
                        onclick={() => selectAction(a.id)}
                        aria-label={disabled ? `${a.label} (add API key in settings)` : `${a.label} (${a.shortcut})`}
                        title={disabled ? `${a.label} — add an API key in settings` : `${a.label} ${a.shortcut}`}
                        style="opacity: {disabled ? opacity * 0.4 : opacity};"
                        class="p-2 rounded-full shrink-0 transition-all duration-200
                            {action === a.id
                                ? a.activeClass
                                : disabled
                                    ? 'text-black/30'
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
                <SettingsIcon size={14} />
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
            <div class="absolute inset-0 flex flex-col {action === 'readers' ? '' : 'hidden'}"><Readers /></div>
            {#if action === 'settings'}<div class="absolute inset-0 flex flex-col"><AISettings /></div>{/if}
        </div>
    </div>

    {#if expanded}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            role="separator"
            aria-label="Resize width"
            aria-orientation="vertical"
            class="resize-handle resize-handle-right"
            onpointerdown={(e) => startResize(e, "right")}
        ></div>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            role="separator"
            aria-label="Resize height"
            aria-orientation="horizontal"
            class="resize-handle resize-handle-bottom"
            onpointerdown={(e) => startResize(e, "bottom")}
        ></div>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            role="separator"
            aria-label="Resize panel"
            class="resize-handle resize-handle-corner"
            onpointerdown={(e) => startResize(e, "corner")}
        ></div>
    {/if}
</div>

<!-- Stop button — appears below the sidebar when AI is processing -->
{#if aiProcessing.active}
    <button
        id="ai-stop-button"
        onclick={stopAllAi}
        aria-label="Stop AI"
        title="Stop AI request"
        class="fixed left-4 z-50 flex items-center gap-1.5 px-3 py-1.5
            backdrop-blur-md bg-red-500/80 hover:bg-red-600/90
            text-white text-xs font-medium rounded-full
            shadow-lg transition-all duration-200
            animate-fade-in"
        style="top: calc(50% + {expanded ? effectiveHeight / 2 : 280 / 2}px + 8px);"
    >
        <SquareIcon size={12} fill="currentColor" />
        Stop
    </button>
{/if}

<style>
    @keyframes fade-in {
        from { opacity: 0; transform: scale(0.9); }
        to { opacity: 1; transform: scale(1); }
    }

    .animate-fade-in {
        animation: fade-in 150ms ease-out;
    }
    div[style*="scrollbar-width"]::-webkit-scrollbar {
        display: none;
    }

    .resize-handle {
        position: absolute;
        z-index: 10;
        /* Prevent the browser from treating a drag on the handle as a scroll
           gesture on touch devices, so pointer drags resize the panel. */
        touch-action: none;
        /*background: transparent;
        border: 0;
        padding: 0;*/
    }

    .resize-handle-right {
        top: 14px;
        bottom: 14px;
        right: -2px;
        width: 10px;
        cursor: ew-resize;
    }

    .resize-handle-bottom {
        left: 14px;
        right: 14px;
        bottom: -2px;
        height: 10px;
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
        right: 4px;
        width: 2px;
        border-radius: 9999px;
        background-color: rgba(0, 0, 0, 0.08);
        opacity: 0;
        transition:
            background-color 200ms ease,
            opacity 200ms ease;
    }

    .resize-handle-right:hover::after {
        background-color: rgba(0, 0, 0, 0.18);
        opacity: 1;
    }

    .resize-handle-bottom::after {
        content: "";
        position: absolute;
        left: 25%;
        right: 25%;
        bottom: 4px;
        height: 2px;
        border-radius: 9999px;
        background-color: rgba(0, 0, 0, 0.08);
        opacity: 0;
        transition:
            background-color 200ms ease,
            opacity 200ms ease;
    }

    .resize-handle-bottom:hover::after {
        background-color: rgba(0, 0, 0, 0.18);
        opacity: 1;
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
