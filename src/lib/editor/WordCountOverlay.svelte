<!--
    WordCountOverlay.svelte — Glassmorphic pill showing word/char counts.

    Positioned by BottomLeftStack. No fixed positioning here.
    Click cycles display mode: "words" → "chars" → "both" → repeat.
    When text is selected, shows "sel / total" pattern.
    Visibility controlled by appSettings.showWordCount.
-->
<script lang="ts">
import { appSettings, persistSettings } from "$lib/settings.svelte";
import { writingStats } from "$lib/stores";

const modes = ["words", "chars", "both"] as const;

function cycleMode() {
    const next = modes[(modes.indexOf(appSettings.wordCountDisplayMode) + 1) % modes.length];
    appSettings.wordCountDisplayMode = next;
    persistSettings();
}

const label = $derived.by(() => {
    const { words, chars, selWords, selChars } = $writingStats;
    const mode = appSettings.wordCountDisplayMode;

    const wordStr = selWords > 0 ? `${selWords} / ${words} words` : `${words} words`;
    const charStr = selChars > 0 ? `${selChars} / ${chars} chars` : `${chars} chars`;

    if (mode === "words") return wordStr;
    if (mode === "chars") return charStr;
    return `${wordStr}  ·  ${charStr}`;
});
</script>

{#if appSettings.showWordCount}
<button
    onclick={cycleMode}
    aria-label="Word count — click to change display"
    title="Click to cycle display mode"
    class="backdrop-blur-md rounded-[2rem] bg-gray-300/70 border border-white/30 shadow-lg
           px-4 py-2 text-sm text-black/80 tabular-nums cursor-pointer
           hover:bg-gray-200/80 transition-colors select-none"
>
    {label}
</button>
{/if}
