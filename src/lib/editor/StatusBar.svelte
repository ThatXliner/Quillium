<script lang="ts">
import Save from "$lib/save/Save.svelte";
import { listen } from "@tauri-apps/api/event";
import { tutorialActive } from "$lib/stores";
const { words, chars, selWords, selChars } = $props();
let fileSaved = $state<boolean>(true);
listen("saved", () => {
	fileSaved = true;
});
listen("saving", () => {
	fileSaved = false;
});
</script>

<div
    id="status-bar"
    class="w-fit mx-auto py-4 px-8 backdrop-blur-md rounded-full bg-gray-300/70 border border-white/30 shadow-lg flex gap-4 items-center justify-center"
>
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
        onclick={() => ($tutorialActive = true)}
        aria-label="Take tour"
        title="Take tour"
        class="w-5 h-5 rounded-full bg-black/10 hover:bg-black/20 text-black/40 hover:text-black/70 transition-colors text-[11px] font-semibold leading-none flex items-center justify-center"
    >?</button>
</div>
