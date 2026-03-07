<!--
    StatusBar.svelte — Glassmorphic status strip at the bottom of the editor.

    Displays real-time writing statistics (word count, character count),
    the current save state, the Save dropdown menu, and a tutorial
    re-launch button. Floats as a pill-shaped bar with backdrop-blur
    matching the neumorphic design language.

    Props (from Editor.svelte):
      - words / chars: total document counts
      - selWords / selChars: selection-only counts (0 when nothing selected)

    State interactions:
      - Listens to Tauri "saved" / "saving" events to toggle the
        save-status indicator between green (saved) and yellow (saving).
      - Writes `tutorialActive` store when the "?" button is clicked.
-->
<script lang="ts">
    import Save from "$lib/save/Save.svelte";
    import SettingsModal from "$lib/settings/SettingsModal.svelte";
    import { listen } from "@tauri-apps/api/event";
    import { tutorialActive } from "$lib/stores";
    import { debugPanelActive } from "$lib/debug/store.svelte";
    import { Settings2 } from "lucide-svelte";

    const { words, chars, selWords, selChars } = $props();

    /**
     * Tracks whether the current document is persisted to disk.
     * Toggled by Tauri backend events emitted during the auto-save
     * cycle: "saving" (write started) and "saved" (write completed).
     */
    let fileSaved = $state<boolean>(true);
    let settingsOpen = $state(false);

    // Tauri event listeners — fire whenever the Rust backend starts
    // or finishes writing the document file.
    listen("saved", () => {
        fileSaved = true;
    });
    listen("saving", () => {
        fileSaved = false;
    });
</script>

<div
    id="status-bar"
    class="relative w-fit mx-auto py-4 px-8 backdrop-blur-md rounded-full bg-gray-300/70 border border-white/30 shadow-lg flex gap-4 items-center justify-center"
>
    {#if settingsOpen}
        <SettingsModal onclose={() => (settingsOpen = false)} />
    {/if}
    <div class="flex items-center gap-2">
        <div
            class={`w-2 h-2 rounded-full ${fileSaved ? "bg-green-400" : "bg-yellow-400"}`}
        ></div>
        <span class="text-sm text-black/90"
            >{fileSaved ? "Saved" : "Saving..."}</span
        >
    </div>
    <div class="w-px h-8 bg-black/20"></div>
    <div class="flex flex-col items-center leading-tight">
        <span class="text-sm text-black/90">Words: {selWords > 0 ? selWords : words}</span>
        {#if selWords > 0}
            <span class="text-[10px] text-black/50">{words} total</span>
        {/if}
    </div>
    <div class="w-px h-8 bg-black/20"></div>
    <div class="flex flex-col items-center leading-tight">
        <span class="text-sm text-black/90">Characters: {selChars > 0 ? selChars : chars}</span>
        {#if selChars > 0}
            <span class="text-[10px] text-black/50">{chars} total</span>
        {/if}
    </div>
    <Save />
    <div class="w-px h-8 bg-black/20"></div>
    <button
        onclick={() => (settingsOpen = !settingsOpen)}
        aria-label="Open settings"
        title="Settings"
        class="w-12 h-12 rounded-full bg-white/50 backdrop-blur-md inset-shadow-sm inset-shadow-white shadow-md flex items-center justify-center hover:bg-gray-50/30 transition-colors
            {settingsOpen ? 'text-blue-600' : 'text-black/50 hover:text-black/70'}"
    >
        <Settings2 size={20} />
    </button>
    <button
        onclick={() => ($tutorialActive = true)}
        aria-label="Take tour"
        title="Take tour"
        class="w-5 h-5 rounded-full bg-black/10 hover:bg-black/20 text-black/40 hover:text-black/70 transition-colors text-[11px] font-semibold leading-none flex items-center justify-center"
    >?</button>
    {#if import.meta.env.DEV}
        <div class="w-px h-8 bg-black/20"></div>
        <button
            onclick={() => ($debugPanelActive = true)}
            aria-label="Open debug panel"
            title="Debug scenarios"
            class="w-5 h-5 rounded-full bg-amber-200/60 hover:bg-amber-300/80 text-amber-700 hover:text-amber-900 transition-colors text-[11px] leading-none flex items-center justify-center"
        >🐛</button>
    {/if}
</div>
