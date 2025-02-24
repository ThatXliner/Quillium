<script lang="ts">
import Save from "$lib/save/Save.svelte";
import { listen } from "@tauri-apps/api/event";
const { words, chars, wpm } = $props();
let fileSaved = $state<boolean>(true);
listen("saved", () => {
	fileSaved = true;
});
listen("saving", () => {
	fileSaved = false;
});
</script>

<div
    class="w-fit mx-auto py-4 px-8 backdrop-blur-md rounded-full bg-white/20 border border-white/30 shadow-lg flex gap-4 items-center justify-center"
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
    <span class="text-sm text-black/90">Words: {words}</span>
    <div class="w-px h-8 bg-black/20"></div>
    <span class="text-sm text-black/90">Characters: {chars}</span>
    <div class="w-px h-8 bg-black/20"></div>
    <span class="text-sm text-black/90">WPM: {wpm.toFixed(1)}</span>
    <Save />
</div>
