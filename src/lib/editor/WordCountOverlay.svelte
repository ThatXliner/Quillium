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
    class="backdrop-blur-md rounded-[2rem] bg-[color:var(--surface-2)] border border-[color:var(--border)] shadow-lg
           px-4 py-2 text-sm text-[color:var(--text)] tabular-nums cursor-pointer
           hover:bg-[color:var(--surface-3)] transition-colors select-none"
>
    {label}
</button>
{/if}
