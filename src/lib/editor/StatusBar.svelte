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
import SettingsModal from "$lib/settings/SettingsModal.svelte";
import { tutorialActive, saveStatus, editorView } from "$lib/stores";
import { debugPanelActive } from "$lib/debug/store.svelte";
import { goToLibrary, goToHistory } from "$lib/navigation";
import { Settings2, LayoutGrid, History, Download } from "lucide-svelte";
import Kbd from "$lib/ui/Kbd.svelte";
import { exportDocument, type ExportFormat } from "$lib/export";

const {
    words,
    chars,
    selWords,
    selChars,
    children,
    titleVisibility = "hover",
    titleForced = false,
} = $props();

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";
let settingsOpen = $state(false);
let exportOpen = $state(false);
let hovered = $state(false);
let titleLinger = $state(false);
let lingerTimer: ReturnType<typeof setTimeout> | undefined;

function doExport(format: ExportFormat) {
    const view = $editorView;
    if (!view) return;
    exportDocument(view, format);
    exportOpen = false;
}

let exportButtonEl = $state<HTMLDivElement>();

function handleWindowClick(e: MouseEvent) {
    if (exportOpen && exportButtonEl && !exportButtonEl.contains(e.target as Node)) {
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
        }, 3000);
    } else {
        // editing started again — cancel any pending linger
        clearTimeout(lingerTimer);
        titleLinger = false;
    }
});
</script>

<svelte:window onclick={handleWindowClick} />

{#if settingsOpen}
    <SettingsModal onclose={() => (settingsOpen = false)} />
{/if}

<div
    id="status-bar"
    role="region"
    aria-label="Status bar"
    class="relative w-fit mx-auto backdrop-blur-md rounded-[2rem] bg-gray-300/70 border border-white/30 shadow-lg"
    onmouseenter={() => (hovered = true)}
    onmouseleave={() => (hovered = false)}
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
        </div>
        <div class="w-px h-8 bg-black/20"></div>
        <div class="flex flex-col items-center leading-tight">
            <span class="text-sm text-black/90">Words: {selWords > 0 ? selWords : words}</span>
            {#if selWords > 0}
                <span class="text-[10px] text-black/50">{words} total</span>
            {/if}
        </div>
        <!-- <div class="w-px h-4 bg-black/20"></div> -->
        <div class="flex flex-col items-center leading-tight">
            <span class="text-sm text-black/90">Characters: {selChars > 0 ? selChars : chars}</span>
            {#if selChars > 0}
                <span class="text-[10px] text-black/50">{chars} total</span>
            {/if}
        </div>
        <div class="w-px h-8 bg-black/20"></div>
        <button
            onclick={goToLibrary}
            title="Library ({modKey}O)"
            aria-label="Open library"
            class="group h-12 px-3 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center gap-2 hover:bg-gray-50/30 transition-colors text-black/50 hover:text-black/70"
        >
            <LayoutGrid size={20} />
            <Kbd keys={[modKey, "O"]} />
        </button>
        <button
            onclick={goToHistory}
            aria-label="Version history"
            title="Version History"
            class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors text-black/50 hover:text-black/70"
        >
            <History size={20} />
        </button>
        <button
            onclick={() => (settingsOpen = !settingsOpen)}
            aria-label="Open settings"
            title="Settings"
            class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors
                {settingsOpen ? 'text-blue-600' : 'text-black/50 hover:text-black/70'}"
        >
            <Settings2 size={20} />
        </button>
        <div class="relative" bind:this={exportButtonEl}>
            <button
                onclick={() => (exportOpen = !exportOpen)}
                aria-label="Export document"
                title="Export ({modKey}Shift+E)"
                class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors
                    {exportOpen ? 'text-blue-600' : 'text-black/50 hover:text-black/70'}"
            >
                <Download size={20} />
            </button>
            {#if exportOpen}
                <div
                    class="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md rounded-xl shadow-lg border border-white/40 overflow-hidden min-w-[10rem] z-50"
                    role="menu"
                >
                    <button
                        onclick={() => doExport("txt")}
                        role="menuitem"
                        class="w-full text-left px-4 py-2.5 text-sm text-black/80 hover:bg-black/5 transition-colors"
                    >Plain Text (.txt)</button>
                    <button
                        onclick={() => doExport("txt+json")}
                        role="menuitem"
                        class="w-full text-left px-4 py-2.5 text-sm text-black/80 hover:bg-black/5 transition-colors"
                    >Text with Annotations (.txt)</button>
                    <button
                        onclick={() => doExport("json")}
                        role="menuitem"
                        class="w-full text-left px-4 py-2.5 text-sm text-black/80 hover:bg-black/5 transition-colors"
                    >JSON (.json)</button>
                    <button
                        onclick={() => doExport("md")}
                        role="menuitem"
                        class="w-full text-left px-4 py-2.5 text-sm text-black/80 hover:bg-black/5 transition-colors"
                    >Markdown (.md)</button>
                </div>
            {/if}
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
    <div
        class="overflow-hidden transition-all duration-300 ease-in-out"
        style="max-height: {titleVisibility === 'always' || hovered || titleForced || titleLinger ? '4rem' : '0'}; opacity: {titleVisibility === 'always' || hovered || titleForced || titleLinger ? '1' : '0'};"
    >
        {@render children?.()}
    </div>
    {/if}
</div>
