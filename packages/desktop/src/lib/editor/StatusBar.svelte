<!--
    StatusBar.svelte — Glassmorphic status strip at the bottom of the editor.

    Displays real-time writing statistics (word count, character count),
    the current save state, the Save dropdown menu, and a tutorial
    re-launch button. Floats as a pill-shaped bar with backdrop-blur
    matching the neumorphic design language.

    Props (from Editor.svelte):
      - words / chars: total document counts
      - selWords / selChars: selection-only counts (0 when nothing selected)
      - titleVisibility: "hover" | "always" | "never" — when to show the title

    State interactions:
      - Reads the `saveStatus` store (written by listeners.ts) to toggle
        the save-status indicator between green (saved) and yellow (saving).
      - Writes `tutorialActive` and `tutorialStartStep` stores when the ⌨
        button is clicked to jump directly to the shortcuts tutorial step.
-->
<script lang="ts">
import { initials } from "$lib/auth/avatarUtils";
import {
    MAX_RECONNECT_ATTEMPTS,
    collabPresenceUsers,
    collabState,
    followedClientId,
    pendingUpdatesCount,
    reconnectAttempt,
} from "$lib/collab";
import { debugPanelActive } from "$lib/debug/store.svelte";
import { type ExportFormat, exportDocument } from "$lib/export";
import { goToAuthorship, goToHistory, goToLibrary } from "$lib/navigation";
import { appSettings } from "$lib/settings.svelte";
import SettingsModal from "$lib/settings/SettingsModal.svelte";
import { editorView, saveStatus, settingsOpen, statsOpen, tutorialActive } from "$lib/stores";
import { BarChart3, Download, History, LayoutGrid, Play, Settings, X } from "lucide-svelte";

const { children, titleVisibility = "hover", titleForced = false } = $props();

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";
// settingsOpen is a shared store (see $lib/stores.ts)
let hovered = $state(false);
let hoverDelayed = $state(false);
let hoverDelayTimer: ReturnType<typeof setTimeout> | undefined;
let titleLinger = $state(false);
let lingerTimer: ReturnType<typeof setTimeout> | undefined;

// Scrollable secondary strip
let secondaryStrip = $state<HTMLDivElement>();
let stripOverflows = $state(false);
let canScrollLeft = $state(false);
let canScrollRight = $state(false);
let exportOpen = $state(false);
let exporting = $state(false);

const exportItems: { format: ExportFormat; label: string; hint: string }[] = [
    { format: "txt", label: "Plain Text", hint: "Document text only (.txt)" },
    {
        format: "txt+json",
        label: "Text + Annotations",
        hint: "Text with annotations appended (.txt)",
    },
    { format: "json", label: "JSON", hint: "Structured text + annotations (.json)" },
    { format: "md", label: "Markdown", hint: "Text with annotations as footnotes (.md)" },
    { format: "pdf", label: "PDF", hint: "Formatted document (.pdf)" },
    {
        format: "pdf+annotations",
        label: "PDF + Annotations",
        hint: "Document plus annotation cards (.pdf)",
    },
];

// Portal the export modal to <body>. The status bar uses backdrop-blur, which
// establishes a containing block AND a clip region for position:fixed
// descendants — so a modal rendered inline would be clipped to the bar instead
// of covering the viewport (#258). Re-parenting to <body> lets `fixed inset-0`
// resolve against the viewport, matching how the app's other modals mount.
function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
        destroy() {
            node.remove();
        },
    };
}

function updateScrollState() {
    if (!secondaryStrip) return;
    const el = secondaryStrip;
    stripOverflows = el.scrollWidth > el.clientWidth + 1;
    canScrollLeft = el.scrollLeft > 2;
    canScrollRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
}

$effect(() => {
    if (!secondaryStrip) return;
    const el = secondaryStrip;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
        el.removeEventListener("scroll", updateScrollState);
        ro.disconnect();
    };
});

function onMouseEnter() {
    hovered = true;
    clearTimeout(hoverDelayTimer);
    const delay = appSettings.titleHoverDelay;
    if (delay <= 0) {
        hoverDelayed = true;
    } else {
        hoverDelayTimer = setTimeout(() => {
            hoverDelayed = true;
        }, delay);
    }
}

function onMouseLeave() {
    hovered = false;
    clearTimeout(hoverDelayTimer);
    hoverDelayed = false;
}

function toggleFollow(clientId: number) {
    followedClientId.set($followedClientId === clientId ? null : clientId);
}

function closeExport() {
    exportOpen = false;
}

function handleExportKeydown(e: KeyboardEvent) {
    if (exportOpen && e.key === "Escape") closeExport();
}

async function doExport(format: ExportFormat) {
    const view = $editorView;
    if (!view || exporting) return;
    exporting = true;
    try {
        await exportDocument(view, format);
    } finally {
        exporting = false;
        exportOpen = false;
    }
}

$effect(() => {
    if (!titleForced) {
        // titleForced just dropped — start the linger
        titleLinger = true;
        clearTimeout(lingerTimer);
        lingerTimer = setTimeout(() => {
            titleLinger = false;
        }, appSettings.titleLingerDuration);
    } else {
        // editing started again — cancel any pending linger
        clearTimeout(lingerTimer);
        titleLinger = false;
    }
});
</script>

<svelte:window onkeydown={handleExportKeydown} />

{#if $settingsOpen}
    <SettingsModal
        scrollTo={typeof $settingsOpen === "string" ? $settingsOpen : undefined}
        onclose={() => {
            $settingsOpen = false;
            // Return focus to the editor so the user can keep typing (#122)
            $editorView?.focus();
        }}
    />
{/if}

{#if exportOpen}
    <!-- Export modal — replaces the old upward-opening popup (#258): a centered
         dialog can't clip or spill off-screen and matches the app's other modals. -->
    <div
        use:portal
        class="fixed inset-0 z-[9999]"
        role="dialog"
        aria-modal="true"
        aria-label="Export document"
    >
        <button
            type="button"
            class="absolute inset-0 bg-black/55 border-0 p-0 cursor-default"
            aria-label="Close"
            tabindex="-1"
            onclick={closeExport}
        ></button>

        <div
            class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-w-[calc(100vw-2rem)] bg-white shadow-2xl rounded-2xl flex flex-col overflow-hidden border border-black/[0.06]"
            role="document"
        >
            <div class="flex items-start justify-between px-7 pt-7 pb-0 shrink-0">
                <div>
                    <h3 class="text-xl font-bold text-black/85 leading-tight">Export document</h3>
                    <p class="text-xs text-black/35 mt-1">Choose a format to save your document</p>
                </div>
                <button
                    type="button"
                    onclick={closeExport}
                    aria-label="Close"
                    class="flex items-center justify-center w-8 h-8 rounded-lg bg-black/[0.05] text-black/35 hover:text-black/60 hover:bg-black/[0.1] transition-colors"
                >
                    <X size={16} />
                </button>
            </div>

            <div class="px-7 pt-5 pb-7 grid grid-cols-1 gap-2">
                {#each exportItems as item}
                    <button
                        type="button"
                        onclick={() => doExport(item.format)}
                        disabled={exporting || !$editorView}
                        class="flex items-center gap-3 w-full px-4 py-3 text-left rounded-xl border border-black/[0.06] bg-black/[0.02] transition-colors hover:bg-purple-50 hover:border-purple-200 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        <Download size={18} class="text-purple-400 shrink-0" />
                        <span class="min-w-0">
                            <span class="block text-sm font-medium text-black/80">{item.label}</span>
                            <span class="block text-xs text-black/40 truncate">{item.hint}</span>
                        </span>
                    </button>
                {/each}
            </div>
        </div>
    </div>
{/if}

<!--
    Two layers on purpose. The OUTER wrapper carries the shadow + radius but NO
    overflow clip, and the INNER carries the backdrop-blur + radius + overflow-hidden.
    In WebKit (Tauri) a single element with backdrop-filter + border-radius leaks a
    square blur halo past the corners unless it has overflow:hidden — BUT adding
    overflow:hidden to an element that ALSO has a box-shadow makes WebKit clip the
    shadow to a square. Splitting the two responsibilities fixes both: the shadow
    stays rounded (outer, unclipped) and the blur is clipped to the radius (inner).
-->
<div
    id="status-bar"
    role="region"
    aria-label="Status bar"
    class="relative max-w-[30rem] mx-auto rounded-[2rem] shadow-lg"
    onmouseenter={onMouseEnter}
    onmouseleave={onMouseLeave}
>
  <div class="overflow-hidden backdrop-blur-md rounded-[2rem] bg-gray-300/70 border border-white/30">
    <div class="flex gap-4 items-center py-2 px-8 min-w-0">
        <!-- Save status (pinned left) -- shows collab state when active, otherwise save state -->
        <div class="flex items-center gap-2 shrink-0">
            {#if $collabState !== "disconnected"}
                <div
                    class={`w-2 h-2 rounded-full ${
                        $collabState === "connected"
                            ? "bg-green-400"
                            : $collabState === "syncing"
                              ? "bg-blue-400 animate-pulse"
                              : $collabState === "reconnecting"
                                ? "bg-yellow-400 animate-pulse"
                                : $collabState === "error"
                                  ? "bg-red-400"
                                  : "bg-yellow-400"
                    }`}
                ></div>
                <span class="text-sm text-black/90">
                    {#if $collabState === "connected"}
                        Synced
                    {:else if $collabState === "syncing"}
                        Syncing{$pendingUpdatesCount > 0 ? ` (${$pendingUpdatesCount})` : "..."}
                    {:else if $collabState === "reconnecting"}
                        Retrying{$reconnectAttempt > 0
                            ? ` (${$reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`
                            : "..."}
                    {:else if $collabState === "error"}
                        Disconnected
                    {:else}
                        Connecting...
                    {/if}
                </span>
                {#if $collabPresenceUsers.length > 0}
                    <div class="flex -space-x-1 pl-1" aria-label="Online collaborators">
                        {#each $collabPresenceUsers.slice(0, 4) as user (user.clientId)}
                            <button
                                type="button"
                                onclick={() => toggleFollow(user.clientId)}
                                aria-label={$followedClientId === user.clientId
                                    ? `Stop following ${user.name}`
                                    : `Follow ${user.name}`}
                                title={$followedClientId === user.clientId
                                    ? `Following ${user.name}`
                                    : `Follow ${user.name}`}
                                class="w-6 h-6 rounded-full border-2 text-[10px] font-semibold text-white leading-none flex items-center justify-center shadow-sm transition-transform hover:scale-105"
                                class:border-black={$followedClientId === user.clientId}
                                class:border-white={$followedClientId !== user.clientId}
                                style="background: {user.color};"
                            >
                                {initials(user.name)}
                            </button>
                        {/each}
                    </div>
                {/if}
            {:else}
                <div
                    class={`w-2 h-2 rounded-full ${$saveStatus === "saved" ? "bg-green-400" : $saveStatus === "error" ? "bg-red-400" : "bg-yellow-400"}`}
                ></div>
                <span class="text-sm text-black/90"
                    >{$saveStatus === "saved" ? "Saved" : $saveStatus === "error" ? "Error" : "Saving..."}</span
                >
            {/if}
        </div>
        <div class="w-px h-8 bg-black/20 shrink-0"></div>
        <!-- Middle buttons (scrollable) -->
        <div
            bind:this={secondaryStrip}
            class="status-bar-strip flex items-center gap-4 overflow-x-auto scroll-smooth min-w-0 -my-2 py-2"
            style="scrollbar-width: none; -ms-overflow-style: none;{stripOverflows
                ? ` mask-image: linear-gradient(to right, ${canScrollLeft ? 'transparent 0%, black 12%' : 'black 0%'}, ${canScrollRight ? 'black 88%, transparent 100%' : 'black 100%'}); -webkit-mask-image: linear-gradient(to right, ${canScrollLeft ? 'transparent 0%, black 12%' : 'black 0%'}, ${canScrollRight ? 'black 88%, transparent 100%' : 'black 100%'});`
                : ''}"
        >
            <button
                onclick={goToLibrary}
                title="Library ({modKey}O)"
                aria-label="Open library"
                class="w-12 h-12 rounded-full overflow-hidden bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors text-blue-400 hover:text-blue-600 shrink-0"
            >
                <LayoutGrid size={20} />
            </button>
            <button
                onclick={goToHistory}
                aria-label="Version history"
                title="Version History ({modKey}Shift+H)"
                class="w-12 h-12 rounded-full overflow-hidden bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors text-amber-400 hover:text-amber-600 shrink-0"
            >
                <History size={20} />
            </button>
            <button
                onclick={() => ($settingsOpen = !$settingsOpen)}
                aria-label="Open settings"
                title="Settings ({modKey},)"
                class="w-12 h-12 rounded-full overflow-hidden bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors shrink-0
                    {$settingsOpen ? 'text-gray-600' : 'text-gray-400 hover:text-gray-600'}"
            >
                <Settings size={20} />
            </button>
            <button
                onclick={() => ($statsOpen = !$statsOpen)}
                aria-label="Writing statistics"
                title="Writing Statistics"
                class="w-12 h-12 rounded-full overflow-hidden bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors shrink-0
                    {$statsOpen ? 'text-emerald-600' : 'text-emerald-400 hover:text-emerald-600'}"
            >
                <BarChart3 size={20} />
            </button>
            <button
                onclick={() => (exportOpen = true)}
                aria-label="Export document"
                title="Export ({modKey}Shift+E)"
                class="w-12 h-12 rounded-full overflow-hidden bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors shrink-0
                    {exportOpen ? 'text-purple-600' : 'text-purple-400 hover:text-purple-600'}"
            >
                <Download size={20} />
            </button>
            <button
                onclick={goToAuthorship}
                aria-label="Authorship playback"
                title="Authorship Report ({modKey}Shift+A)"
                class="w-12 h-12 rounded-full overflow-hidden bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors text-violet-400 hover:text-violet-600 shrink-0"
            >
                <Play size={20} />
            </button>
        </div>
        <div class="w-px h-8 bg-black/20 shrink-0"></div>
        <!-- Right side (pinned) -->
        <div class="flex items-center gap-2 shrink-0">
            <button
                onclick={() => ($tutorialActive = true)}
                aria-label="Take tour"
                title="Take tour"
                class="w-5 h-5 rounded-full bg-black/10 hover:bg-black/20 text-black/40 hover:text-black/70 transition-colors text-[11px] font-semibold leading-none flex items-center justify-center"
            >?</button>
            {#if import.meta.env.DEV}
                <button
                    onclick={() => ($debugPanelActive = true)}
                    aria-label="Open debug panel"
                    title="Debug scenarios"
                    class="w-5 h-5 rounded-full bg-amber-200/60 hover:bg-amber-300/80 text-amber-700 hover:text-amber-900 transition-colors text-[11px] leading-none flex items-center justify-center"
                >🐛</button>
            {/if}
        </div>
    </div>
    {#if titleVisibility !== "never"}
    {@const titleShown = titleVisibility === 'always' || hoverDelayed || titleForced || titleLinger}
    <div
        class="grid transition-[grid-template-rows,opacity] duration-300 ease-in-out"
        style="grid-template-rows: {titleShown ? '1fr' : '0fr'}; opacity: {titleShown ? '1' : '0'};"
    >
        <div class="overflow-hidden">
            {@render children?.()}
        </div>
    </div>
    {/if}
  </div>
</div>

<style>
    .status-bar-strip::-webkit-scrollbar {
        display: none;
    }
</style>
