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
import { debugPanelActive } from "$lib/debug/store.svelte";
import { type ExportFormat, exportDocument } from "$lib/export";
import { goToHistory, goToLibrary } from "$lib/navigation";
import { appSettings } from "$lib/settings.svelte";
import SettingsModal from "$lib/settings/SettingsModal.svelte";
import { editorView, saveStatus, settingsOpen, statsOpen, tutorialActive } from "$lib/stores";
import { BarChart3, Download, History, LayoutGrid, Settings } from "lucide-svelte";

const { children, titleVisibility = "hover", titleForced = false } = $props();

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";
// settingsOpen is a shared store (see $lib/stores.ts)
let exportOpen = $state(false);
let hovered = $state(false);
let hoverDelayed = $state(false);
let hoverDelayTimer: ReturnType<typeof setTimeout> | undefined;
let titleLinger = $state(false);
let lingerTimer: ReturnType<typeof setTimeout> | undefined;

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

function doExport(format: ExportFormat) {
    const view = $editorView;
    if (!view) return;
    exportDocument(view, format);
    exportOpen = false;
}

let exportButtonEl = $state<HTMLDivElement>();
let exportMenuEl = $state<HTMLDivElement>();
let exportPillStyle = $state("");
let hoveredExportIdx = $state(-1);

function handleWindowClick(e: MouseEvent) {
    if (exportOpen && exportButtonEl && !exportButtonEl.contains(e.target as Node)) {
        exportOpen = false;
        hoveredExportIdx = -1;
    }
}

$effect(() => {
    if (!exportMenuEl || hoveredExportIdx < 0) {
        exportPillStyle = "opacity: 0;";
        return;
    }
    const buttons = exportMenuEl.querySelectorAll<HTMLButtonElement>(".export-item");
    const btn = buttons[hoveredExportIdx];
    if (!btn) {
        exportPillStyle = "opacity: 0;";
        return;
    }
    exportPillStyle = `opacity: 1; top: ${btn.offsetTop}px; height: ${btn.offsetHeight}px;`;
});

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

<svelte:window onclick={handleWindowClick} />

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
    class="relative w-fit mx-auto backdrop-blur-md rounded-[2rem] bg-gray-300/70 border border-white/30 shadow-lg"
    onmouseenter={onMouseEnter}
    onmouseleave={onMouseLeave}
>
    <div class="flex gap-4 items-center py-2 px-8">
        <!-- <div class="w-px h-8 bg-black/20"></div> -->
        <div class="flex items-center gap-2">
            <div
                class={`w-2 h-2 rounded-full ${$saveStatus === "saved" ? "bg-green-400" : $saveStatus === "error" ? "bg-red-400" : "bg-yellow-400"}`}
            ></div>
            <span class="text-sm text-black/90"
                >{$saveStatus === "saved" ? "Saved" : $saveStatus === "error" ? "Error" : "Saving..."}</span
            >
            <!-- {#if $saveStatus !== "saved"}
                <span class="text-sm text-black/90"
                    >{$saveStatus === "error" ? "Error" : "Saving..."}</span
                >
            {/if} -->
        </div>
        <div class="w-px h-8 bg-black/20"></div>
        <button
            onclick={goToLibrary}
            title="Library ({modKey}O)"
            aria-label="Open library"
            class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors text-black/50 hover:text-black/70"
        >
            <LayoutGrid size={20} />
        </button>
        <button
            onclick={goToHistory}
            aria-label="Version history"
            title="Version History ({modKey}Shift+H)"
            class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors text-black/50 hover:text-black/70"
        >
            <History size={20} />
        </button>
        <button
            onclick={() => ($statsOpen = !$statsOpen)}
            aria-label="Writing statistics"
            title="Writing Statistics"
            class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors
                {$statsOpen ? 'text-blue-600' : 'text-black/50 hover:text-black/70'}"
        >
            <BarChart3 size={20} />
        </button>
        <button
            onclick={() => ($settingsOpen = !$settingsOpen)}
            aria-label="Open settings"
            title="Settings ({modKey},)"
            class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors
                {$settingsOpen ? 'text-blue-600' : 'text-black/50 hover:text-black/70'}"
        >
            <Settings size={20} />
        </button>
        <div class="relative w-12 h-12" bind:this={exportButtonEl}>
            <div
                onclick={() => (exportOpen = !exportOpen)}
                role="menu"
                tabindex="0"
                aria-label="Export document"
                title="Export"
                class="absolute top-0 left-1/2 -translate-x-1/2 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md overflow-hidden cursor-pointer z-50
                    transition-[width,height,border-radius,background-color] duration-[340ms] ease-[cubic-bezier(0.33,0,0.2,1)]
                    {exportOpen ? 'w-[11rem] h-fit rounded-[14px] py-1 px-2 bg-[color-mix(in_srgb,theme(colors.gray.300),white_30%)]' : 'w-12 h-12 rounded-[24px] bg-[color-mix(in_srgb,white,theme(colors.gray.300)_50%)]'}"
            >
                <!-- Icon (visible when collapsed) -->
                <div class="absolute inset-0 flex items-center justify-center transition-opacity duration-150
                    {exportOpen ? 'opacity-0 pointer-events-none' : 'opacity-100 text-black/50 hover:text-black/70'}">
                    <Download size={20} />
                </div>
                <!-- Menu items (visible when expanded) -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    bind:this={exportMenuEl}
                    class="relative flex flex-col py-1 transition-opacity duration-150 {exportOpen ? 'opacity-100 delay-100' : 'opacity-0 pointer-events-none'}"
                    onmouseleave={() => (hoveredExportIdx = -1)}
                >
                    <div
                        class="absolute inset-x-0 rounded-lg bg-white/70 backdrop-blur-sm shadow-[0_1px_3px_rgba(0,0,0,0.12)] inset-shadow-[0_1px_0_rgba(255,255,255,0.9)] pointer-events-none transition-[top,height] duration-250 ease-[cubic-bezier(0.34,1.2,0.64,1)]"
                        style={exportPillStyle}
                    ></div>
                    {#each [
                        { format: "txt", label: "Plain Text (.txt)" },
                        { format: "txt+json", label: "Text + Annotations (.txt)" },
                        { format: "json", label: "JSON (.json)" },
                        { format: "md", label: "Markdown (.md)" },
                    ] as item, i}
                        <button
                            onclick={() => doExport(item.format)}
                            onmouseenter={() => (hoveredExportIdx = i)}
                            role="menuitem"
                            class="export-item relative z-[1] px-1 w-full text-left py-2.5 text-sm text-black/80 whitespace-nowrap"
                        >{item.label}</button>
                    {/each}
                </div>
            </div>
        </div>
        <div class="w-px h-8 bg-black/20"></div>
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
    {#if titleVisibility !== "never"}
    {@const titleShown = titleVisibility === 'always' || (hoverDelayed && !exportOpen) || titleForced || titleLinger}
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
