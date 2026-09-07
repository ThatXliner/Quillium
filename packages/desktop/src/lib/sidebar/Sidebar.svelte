<!-- Sidebar.svelte — Built-in sidebar navigation, sizing, and panel lifecycle. -->
<script lang="ts">
import { collegeWorkspace, cancelCollegeTabPick } from "$lib/college/workspace.svelte";
import { collegeState, useCollegeEffects } from "$lib/college/state.svelte";
import { createCollegeCapabilities } from "$lib/college/capabilities";
import ContextInfoButton from "$lib/ai/ContextInfoButton.svelte";
import {
    aiProcessing,
    getEffectiveDocumentContext,
    ensureApiKeyLoaded,
    hasApiKey,
    stopAllAi,
    useDocumentContextEffects,
} from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import { builtInPanels } from "$lib/sidebar/builtInPanels";
import {
    type SidebarPanelContribution,
    type SidebarPanelSession,
    createSidebarPanelSession,
    createSidebarPanels,
} from "$lib/sidebar/panels";
import {
    activeAnnotation,
    annotations,
    currentDocumentId,
    currentDraftId,
    currentTabId,
    currentTabLabel,
    currentDraftLabel,
    currentDocumentTitle,
    documentContent,
    selectedText,
    selectedTextRange,
} from "$lib/stores";
import { pointerDrag } from "$lib/ui/pointerDrag";
import { Minimize2Icon, SquareIcon, XIcon } from "lucide-svelte";
import { onDestroy, tick, untrack } from "svelte";
import { derived, get } from "svelte/store";

import { buildAnnotationContextInputs } from "$lib/ai/annotationContext";
import { buildAiContextPacket, shouldShowContextSummary } from "$lib/ai/context";
import { PanelResizeController } from "$lib/ai/panelResize.svelte";

useDocumentContextEffects();
useCollegeEffects(stopAllAi);

let {
    contributions = builtInPanels,
    disabledPanelIds = [],
}: {
    contributions?: readonly SidebarPanelContribution[];
    disabledPanelIds?: readonly string[];
} = $props();
let action = $state<string | null>(null);
const panels = $derived(
    createSidebarPanels(contributions).filter(
        (panel) =>
            !disabledPanelIds.includes(panel.id) && (appSettings.aiEnabled || !panel.requiresAi),
    ),
);
const actions = $derived(panels.filter((panel) => panel.placement === "main"));
const utilities = $derived(panels.filter((panel) => panel.placement === "utility"));
const activePanel = $derived(panels.find((panel) => panel.id === action));
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
function shortcut(panel: SidebarPanelContribution): string {
    return panel.shortcutKey ? `${isMac ? "⌘⇧" : "Ctrl+Shift+"}${panel.shortcutKey}` : "";
}
let session = $state.raw<SidebarPanelSession | null>(null);
let disposeSession: (() => void) | undefined;
const readTarget = () => ({
    documentId: get(currentDocumentId),
    tabId: get(currentTabId),
    draftId: get(currentDraftId),
});
let targetEpoch = $state(0);
let previousTarget = JSON.stringify(readTarget());
const unsubscribeTarget = derived([currentDocumentId, currentTabId, currentDraftId], (ids) =>
    JSON.stringify(ids),
).subscribe(() => {
    const next = JSON.stringify(readTarget());
    if (next === previousTarget) return;
    previousTarget = next;
    disposeSession?.();
    stopAllAi();
    targetEpoch += 1;
});
$effect(() => {
    targetEpoch;
    const panel = activePanel;
    disposeSession?.();
    session = null;
    if (!panel) {
        if (action !== null) closePanel(true);
        return;
    }
    const current = untrack(() =>
        createSidebarPanelSession(readTarget(), {
            readTarget,
            readSelection: () => get(selectedText),
        }),
    );
    session = current.session;
    disposeSession = current.dispose;
    return current.dispose;
});
// A removed built-in must not leave its retained request running after unmount.
let previousPanelIds = new Set<string>();
$effect(() => {
    const next = new Set(panels.map((panel) => panel.id));
    if ([...previousPanelIds].some((id) => !next.has(id))) untrack(stopAllAi);
    previousPanelIds = next;
});
onDestroy(() => {
    unsubscribeTarget();
    disposeSession?.();
    stopAllAi();
});

const collegeCapabilities = $derived.by(() => {
    $documentContent;
    $currentDocumentTitle;
    $currentTabLabel;
    $currentDraftLabel;
    return session ? createCollegeCapabilities(session, selectAction) : null;
});
$effect(() => { collegeState.hostEnabled = panels.some((panel) => panel.id === "college"); });
$effect(() => {
    if (!collegeWorkspace.setup) return;
    if (collegeWorkspace.documentId !== $currentDocumentId || !collegeState.hostEnabled) {
        untrack(cancelCollegeTabPick);
        return;
    }
    if (action === "college") untrack(() => closePanel());
});

const expanded = $derived(action !== null);
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 570;
const MIN_WIDTH = 240;
const MAX_WIDTH = 600;
const MIN_HEIGHT = 400;
const MAX_HEIGHT = 800;

const resize: PanelResizeController = new PanelResizeController({
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
    getEffectiveSize: (): { width: number; height: number } => ({
        width: effectiveWidth,
        height: effectiveHeight,
    }),
});

const defaultWidthForTab = $derived(activePanel?.preferredWidth ?? DEFAULT_WIDTH);
const defaultHeightForTab = $derived(activePanel?.preferredHeight ?? DEFAULT_HEIGHT);
const effectiveWidth = $derived(resize.customWidth ?? defaultWidthForTab);
const effectiveHeight = $derived(resize.customHeight ?? defaultHeightForTab);
const isCustomSize = $derived(resize.customWidth !== null || resize.customHeight !== null);
const contextPanelMode = $derived(activePanel?.contextMode ?? null);
const headerAnnotationContext = $derived(
    buildAnnotationContextInputs({
        annotations: $annotations,
        documentContent: $documentContent,
        selectedText: $selectedText,
        selectedTextRange: $selectedTextRange,
        activeAnnotation: $activeAnnotation,
    }),
);
const headerContextPacket = $derived(
    contextPanelMode
        ? buildAiContextPacket({
              mode: contextPanelMode,
              documentContent: $documentContent,
              selectedText: $selectedText,
              selectedTextRange: $selectedTextRange,
              documentContext: getEffectiveDocumentContext(),
              annotationContext: headerAnnotationContext,
          })
        : null,
);
// The header info (i) icon stands in for the in-panel context summary card
// whenever that card isn't shown — either because the packet doesn't warrant a
// full summary, or because the writer collapsed it via "Hide" / Settings
// (appSettings.collapseContextSummary). ContextLens hides its card under the
// same conditions, so exactly one of the two is visible at a time.
const showHeaderContextInfo = $derived(
    headerContextPacket !== null &&
        (appSettings.collapseContextSummary || !shouldShowContextSummary(headerContextPacket)),
);
const headerContextRing = $derived(activePanel?.contextRingClass ?? "focus:ring-blue-500");

// Context detail popover (opened by the header info button, rendered by
// ContextInfoButton). Closed on click-outside, Escape, panel switch, or when
// the info button itself stops rendering — the dismissal coordination lives
// in this component's window/sidebar handlers, so the open state does too.
let showContextPopover = $state(false);

// Auto-close the popover when the info button is no longer relevant (e.g. the
// user switched to a panel without context, or selection/draft state changed
// so the button stops rendering).
$effect(() => {
    if (!showHeaderContextInfo && showContextPopover) {
        showContextPopover = false;
    }
});

// Inline style when expanded: always set width/height so tab-specific defaults
// and reset-to-default transitions animate smoothly.
const collapsedHeight = $derived(
    Math.max(appSettings.aiEnabled ? 280 : 100, panels.length * 38 + 24),
);
const containerSizeStyle = $derived(
    expanded
        ? `width: min(${effectiveWidth}px, calc(100vw - 32px)); height: min(${effectiveHeight}px, calc(100dvh - 64px));`
        : `height: min(${collapsedHeight}px, calc(100dvh - 64px));`,
);

// Disable transition during active drag; keep it for expand/collapse
const transitionClass = $derived(
    resize.isResizing
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

let returnFocus: HTMLElement | null = null;
function closePanel(restoreFocus = false): void {
    disposeSession?.();
    action = null;
    showContextPopover = false;
    if (restoreFocus)
        tick().then(() => {
            if (returnFocus?.isConnected && !returnFocus.closest("[inert]")) returnFocus.focus();
            else container?.querySelector<HTMLButtonElement>("button")?.focus();
        });
}
function navigateIcons(event: KeyboardEvent): void {
    const buttons = Array.from(
        event.currentTarget instanceof HTMLElement
            ? event.currentTarget.querySelectorAll<HTMLButtonElement>("button")
            : [],
    );
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
        next = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
        next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function handleClickOutside(e: MouseEvent) {
    // The click that ends a drag-resize must not collapse the panel.
    if (resize.consumeJustResized()) return;
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
        closePanel();
    }
}

function selectAction(id: string): void {
    const def = panels.find((panel) => panel.id === id);
    if (!def) return;
    if (!expanded)
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    showContextPopover = false;
    if (def.requiresModel) ensureApiKeyLoaded();
    const next =
        def.requiresModel && !hasApiKey()
            ? (panels.find((panel) => panel.id === "settings")?.id ?? null)
            : id;
    if (next !== action) disposeSession?.();
    action = next;
    posthog.capture("ai_sidebar_opened", { mode: action });
    if (action) scrollActiveIntoCenter(action);
    tick().then(() => {
        if (!expanded || !container) return;
        container
            .querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(action ?? "")}"]`)
            ?.focus({ preventScroll: true });
    });
}

function scrollActiveIntoCenter(id: string) {
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

function openAiSettingsFromExternalRequest() {
    selectAction("settings");
}

function openChatFromExternalRequest() {
    selectAction("chat");
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

// App-level requests to open the chat panel.
$effect(() => {
    return appEventBus.on("ai-open-chat", openChatFromExternalRequest);
});

// Keyboard shortcuts for the sidebar
// Dismiss the context popover when clicking anywhere inside the sidebar that
// isn't the info button or the popover itself. The sidebar container stops
// click propagation to the window, so handleClickOutside never fires for
// in-sidebar clicks — this handler covers that gap.
function handleSidebarClick(e: MouseEvent) {
    e.stopPropagation();
    if (!showContextPopover) return;
    const target = e.target as Element;
    if (target.closest?.(".context-popover") || target.closest?.("[data-context-info-button]")) {
        return;
    }
    showContextPopover = false;
}

function handleKeydown(e: KeyboardEvent) {
    // Escape closes the context popover first, before the sidebar itself.
    if (e.key === "Escape" && showContextPopover) {
        showContextPopover = false;
        e.stopPropagation();
        return;
    }
    // Escape closes the sidebar
    if (e.key === "Escape" && expanded) {
        // Only close if focus is not inside an input/textarea in the sidebar
        const target = e.target as HTMLElement;
        const isInInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
        if (!isInInput) {
            closePanel(true);
        }
        return;
    }
    // Shortcuts come from the same contributions as the icon strips.
    const panel = panels.find((panel) => panel.shortcutKey === e.key);
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && panel) {
        e.preventDefault();
        selectAction(panel.id);
    }
}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

{#snippet kbdHint(key: string)}
  <span
    class="ml-auto text-[9px] font-mono opacity-50 bg-black/10 px-1 py-0.5 rounded"
    >{key}</span
  >
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- Two layers: outer carries shadow + radius (no overflow → shadow stays rounded);
     inner carries backdrop-blur + radius + overflow-hidden (clips the blur to the
     corner). In WebKit a single element with backdrop-filter + radius + overflow-hidden
     + box-shadow squares the shadow at the corners; splitting avoids it while still
     clipping the blur. The .ai-processing animation targets box-shadow, so it stays on
     the outer layer alongside the radius. Resize handles and the context popover live
     inside the inner layer so its overflow-hidden still clips their intentional overhang. -->
<div
  id="ai-sidebar"
  bind:this={container}
  onclick={handleSidebarClick}
  style={containerSizeStyle}
  class="
        fixed left-4 top-1/2 -translate-y-1/2 z-50 shadow-lg {transitionClass}
        {expanded ? 'w-[320px] h-[520px] rounded-[14px]' : 'w-[52px] h-[280px] rounded-[100px]'}
        {aiProcessing.active ? 'ai-processing' : ''}
    "
>
  <div
    class="w-full h-full backdrop-blur-md bg-gray-300/70 border border-white/30
        overflow-hidden {transitionClass}
        {expanded ? 'rounded-[14px]' : 'rounded-[100px]'}"
  >
  <!-- Collapsed pill icons -->
  <div
    inert={expanded}
    role="toolbar" tabindex="-1" aria-label="Sidebar panels" onkeydown={navigateIcons}
    class="absolute inset-0 flex flex-col items-center py-3 px-2 overflow-y-auto transition-opacity duration-150
            {expanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}"
  >
    <div class="flex flex-col gap-1">
      {#each actions as a (a.id)}
        {@const disabled = a.requiresModel && !hasApiKey()}
        <button
          id="ai-tab-{a.id}"
          onclick={() => selectAction(a.id)}
          aria-label={disabled
            ? `${a.label} (add API key in settings)`
            : `${a.label}${shortcut(a) ? ` (${shortcut(a)})` : ""}`}
          title={disabled
            ? `${a.label} — add an API key in settings`
            : `${a.label} ${shortcut(a)}`}
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
    {#each utilities as panel (panel.id)}
      <button onclick={() => selectAction(panel.id)} aria-label={panel.label} title={panel.title}
        class="p-2 rounded-full text-black/30 {panel.hoverClass}">
        <panel.icon size={15} />
      </button>
    {/each}
  </div>

  <!-- Expanded panel -->
  <div
    inert={!expanded}
    class="w-full h-full flex flex-col transition-opacity duration-150
            {expanded
      ? 'opacity-100 delay-[80ms]'
      : 'opacity-0 invisible pointer-events-none'}"
  >
    <!-- Row 1: icon wheel -->
    <div class="shrink-0 pt-2.5 pb-1">
      <div
        role="toolbar" tabindex="-1" aria-label="Sidebar panels" onkeydown={navigateIcons}
        bind:this={iconStrip}
        class="flex items-center gap-0.5 overflow-x-auto px-4 scroll-smooth"
        style="scrollbar-width: none; -ms-overflow-style: none;{stripOverflows
          ? ` mask-image: linear-gradient(to right, ${canScrollLeft ? 'transparent 0%, black 18%' : 'black 0%'}, ${canScrollRight ? 'black 82%, transparent 100%' : 'black 100%'}); -webkit-mask-image: linear-gradient(to right, ${canScrollLeft ? 'transparent 0%, black 18%' : 'black 0%'}, ${canScrollRight ? 'black 82%, transparent 100%' : 'black 100%'});`
          : ''}"
      >
        {#each actions as a, i (a.id)}
          {@const activeIdx = actions.findIndex((x) => x.id === action)}
          {@const dist = activeIdx < 0 ? 0 : Math.abs(i - activeIdx)}
          {@const maxDist =
            activeIdx < 0
              ? 1
              : Math.max(activeIdx, actions.length - 1 - activeIdx)}
          {@const t = maxDist === 0 ? 0 : dist / maxDist}
          {@const opacity = activeIdx < 0 ? 0.7 : 1 - (1 - 0.45) * Math.sqrt(t)}
          {@const disabled = a.requiresModel && !hasApiKey()}
          <button
            aria-pressed={action === a.id}
            bind:this={iconEls[i]}
            onclick={() => selectAction(a.id)}
            aria-label={disabled
              ? `${a.label} (add API key in settings)`
              : `${a.label}${shortcut(a) ? ` (${shortcut(a)})` : ""}`}
            title={disabled
              ? `${a.label} — add an API key in settings`
              : `${a.label} ${shortcut(a)}`}
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
        {activePanel?.title ?? ""}
      </span>
      {#if isCustomSize}
        <button
          onclick={() => resize.reset()}
          aria-label="Reset to default size"
          title="Reset size"
          class="p-1.5 rounded-full text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors shrink-0"
        >
          <Minimize2Icon size={14} />
        </button>
      {/if}
      {#if showHeaderContextInfo && headerContextPacket}
        <ContextInfoButton
          packet={headerContextPacket}
          ringClass={headerContextRing}
          bind:open={showContextPopover}
        />
      {/if}
      {#each utilities as panel (panel.id)}
        <button onclick={() => action === panel.id ? closePanel(true) : selectAction(panel.id)}
          aria-label={panel.label} title={panel.title} aria-pressed={action === panel.id}
          class="p-1.5 rounded-full transition-colors shrink-0 {action === panel.id ? panel.activeClass : 'text-black/30 ' + panel.hoverClass}">
          <panel.icon size={14} />
        </button>
      {/each}
      <button
        onclick={() => closePanel(true)}
        aria-label="Close"
        class="p-1.5 rounded-full text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors shrink-0"
      >
        <XIcon size={14} />
      </button>
    </div>

    <div class="w-full h-px bg-black/10 shrink-0"></div>

    <!-- Retained built-ins keep their conversations while hidden; active-only panels dispose on hide. -->
    <div class="flex-1 flex flex-col min-h-0 relative">
      {#each panels as panel (panel.id)}
        {#if panel.mount === "eager" || action === panel.id}
          <div data-panel-id={panel.id} role="region" aria-label={panel.title} tabindex="-1"
            inert={action !== panel.id}
            class="absolute inset-0 outline-none {panel.contentClass} {action === panel.id ? '' : 'hidden'}">
            <svelte:boundary onerror={(error) => {
                if (action === panel.id) disposeSession?.();
                stopAllAi();
                console.error("[Sidebar] panel failed", panel.id, error);
              }}>
              <panel.component active={action === panel.id} session={action === panel.id ? session : null} college={action === panel.id ? collegeCapabilities : null} />
              {#snippet failed(error, reset)}
                <div role="alert" class="p-4 text-sm text-black/70">
                  <p>{panel.label} could not be displayed.</p>
                  <button class="mt-2 underline" onclick={() => { targetEpoch += 1; reset(); }}>Try again</button>
                </div>
              {/snippet}
            </svelte:boundary>
          </div>
        {/if}
      {/each}
    </div>
  </div>

  {#if expanded}
    <div
      role="separator"
      aria-label="Resize width"
      aria-orientation="vertical"
      class="resize-handle resize-handle-right"
      use:pointerDrag={resize.dragOptions("right")}
    ></div>
    <div
      role="separator"
      aria-label="Resize height"
      aria-orientation="horizontal"
      class="resize-handle resize-handle-bottom"
      use:pointerDrag={resize.dragOptions("bottom")}
    ></div>
    <div
      role="separator"
      aria-label="Resize panel"
      class="resize-handle resize-handle-corner"
      use:pointerDrag={resize.dragOptions("corner")}
    ></div>
  {/if}
  </div>
</div>

<!-- Stop button — appears below the sidebar when AI is processing -->
{#if aiProcessing.active}
  <!-- Two layers: outer carries shadow + radius (no overflow → shadow stays rounded);
       inner button carries backdrop-blur + radius + overflow-hidden so the blur is
       clipped without WebKit squaring the shadow. (rounded-full makes the squaring
       geometrically invisible here, but split for consistency.) -->
  <div
    class="fixed left-4 z-50 rounded-full shadow-lg animate-fade-in"
    style="top: calc(50% + min({(expanded ? effectiveHeight : collapsedHeight) / 2}px, calc((100dvh - 64px) / 2)) + 8px);"
  >
    <button
      id="ai-stop-button"
      onclick={stopAllAi}
      aria-label="Stop AI"
      title="Stop AI request"
      class="flex items-center gap-1.5 px-3 py-1.5
              backdrop-blur-md bg-red-500/80 hover:bg-red-600/90
              text-white text-xs font-medium rounded-full
              transition-all duration-200 overflow-hidden"
    >
      <SquareIcon size={12} fill="currentColor" />
      Stop
    </button>
  </div>
{/if}

<style>
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
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
    0% {
      box-shadow:
        0 0 0 2px rgba(99, 102, 241, 0.5),
        0 0 16px 4px rgba(99, 102, 241, 0.25);
    }
    25% {
      box-shadow:
        0 0 0 2px rgba(168, 85, 247, 0.5),
        0 0 16px 4px rgba(168, 85, 247, 0.25);
    }
    50% {
      box-shadow:
        0 0 0 2px rgba(236, 72, 153, 0.5),
        0 0 16px 4px rgba(236, 72, 153, 0.25);
    }
    75% {
      box-shadow:
        0 0 0 2px rgba(251, 146, 60, 0.5),
        0 0 16px 4px rgba(251, 146, 60, 0.25);
    }
    100% {
      box-shadow:
        0 0 0 2px rgba(99, 102, 241, 0.5),
        0 0 16px 4px rgba(99, 102, 241, 0.25);
    }
  }

  .ai-processing {
    animation: rainbow-glow 2s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      transition-duration: 0.01ms !important;
    }
    .ai-processing {
      animation: none;
    }
  }
</style>
