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
    collabPresenceUsers,
    collabState,
    followedClientId,
    MAX_RECONNECT_ATTEMPTS,
    pendingUpdatesCount,
    reconnectAttempt,
} from "$lib/collab";
import { debugPanelActive } from "$lib/debug/store.svelte";
import { exportDocument, type ExportFormat } from "$lib/export";
import { goToHistory, goToLibrary } from "$lib/navigation";
import { appSettings } from "$lib/settings.svelte";
import SettingsModal from "$lib/settings/SettingsModal.svelte";
import { editorView, saveStatus, settingsOpen, statsOpen, tutorialActive } from "$lib/stores";
import { BarChart3, Download, History, LayoutGrid, Settings } from "lucide-svelte";

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
let exportWrapperEl = $state<HTMLDivElement>();
let exportButtonEl = $state<HTMLButtonElement>();
let exportMenuEl = $state<HTMLDivElement>();
let exportMenuStyle = $state("");
let exporting = $state(false);

const exportItems: { format: ExportFormat; label: string }[] = [
    { format: "txt", label: "Plain Text" },
    { format: "txt+json", label: "Text + Annotations" },
    { format: "json", label: "JSON" },
    { format: "md", label: "Markdown" },
    { format: "pdf", label: "PDF" },
    { format: "pdf+annotations", label: "PDF + Annotations" },
];

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

function handleWindowClick(e: MouseEvent) {
    const target = e.target as Node;
    if (
        exportOpen &&
        !exportWrapperEl?.contains(target) &&
        !exportMenuEl?.contains(target)
    ) {
        exportOpen = false;
    }
}

function positionExportMenu() {
    if (!exportButtonEl || typeof window === "undefined") return;

    const rect = exportButtonEl.getBoundingClientRect();
    const menuWidth = 192;
    const edgePadding = 12;
    const center = Math.min(
        window.innerWidth - edgePadding - menuWidth / 2,
        Math.max(edgePadding + menuWidth / 2, rect.left + rect.width / 2),
    );
    const top = Math.max(edgePadding, rect.top - 8);
    exportMenuStyle = `left: ${center}px; top: ${top}px;`;
}

function toggleExportMenu() {
    exportOpen = !exportOpen;
    if (exportOpen) {
        positionExportMenu();
    }
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

<svelte:window
    onclick={handleWindowClick}
    onresize={positionExportMenu}
    onscroll={positionExportMenu}
/>

{#if $settingsOpen}
    <SettingsModal
        scrollTo={typeof $settingsOpen === "string" ? $settingsOpen : undefined}
        onclose={() => ($settingsOpen = false)}
    />
{/if}

<div
    id="status-bar"
    role="region"
    aria-label="Status bar"
    class="relative max-w-[30rem] mx-auto backdrop-blur-md rounded-[2rem] bg-gray-300/70 border border-white/30 shadow-lg"
    onmouseenter={onMouseEnter}
    onmouseleave={onMouseLeave}
>
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
                class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors text-blue-400 hover:text-blue-600 shrink-0"
            >
                <LayoutGrid size={20} />
            </button>
            <button
                onclick={goToHistory}
                aria-label="Version history"
                title="Version History ({modKey}Shift+H)"
                class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors text-amber-400 hover:text-amber-600 shrink-0"
            >
                <History size={20} />
            </button>
            <button
                onclick={() => ($settingsOpen = !$settingsOpen)}
                aria-label="Open settings"
                title="Settings ({modKey},)"
                class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors shrink-0
                    {$settingsOpen ? 'text-gray-600' : 'text-gray-400 hover:text-gray-600'}"
            >
                <Settings size={20} />
            </button>
            <button
                onclick={() => ($statsOpen = !$statsOpen)}
                aria-label="Writing statistics"
                title="Writing Statistics"
                class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors shrink-0
                    {$statsOpen ? 'text-emerald-600' : 'text-emerald-400 hover:text-emerald-600'}"
            >
                <BarChart3 size={20} />
            </button>
            <div
                class="relative shrink-0"
                bind:this={exportWrapperEl}
            >
                <button
                    bind:this={exportButtonEl}
                    onclick={toggleExportMenu}
                    aria-label="Export document"
                    title="Export ({modKey}Shift+E)"
                    class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors
                        {exportOpen ? 'text-purple-600' : 'text-purple-400 hover:text-purple-600'}"
                >
                    <Download size={20} />
                </button>
                {#if exportOpen}
                    <div
                        bind:this={exportMenuEl}
                        class="fixed z-[80] w-48 -translate-x-1/2 -translate-y-full overflow-hidden rounded-xl border border-black/10 bg-white/95 py-1 shadow-xl backdrop-blur-md"
                        style={exportMenuStyle}
                    >
                        {#each exportItems as item}
                            <button
                                type="button"
                                onclick={() => doExport(item.format)}
                                disabled={exporting || !$editorView}
                                class="w-full px-3 py-2 text-left text-xs text-black/65 transition-colors hover:bg-purple-50 hover:text-purple-700 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                {item.label}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
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

<style>
    .status-bar-strip::-webkit-scrollbar {
        display: none;
    }
</style>
