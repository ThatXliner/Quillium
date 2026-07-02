<!--
    Kbd.svelte — Consistent keyboard shortcut badge(s).

    Props:
      - keys: string | string[]  — one key or an array of keys to render
        as separate badges joined by "+"
      - variant: "default"  — white bg, dark text (standard, on light surfaces)
               "ghost"   — transparent bg, faint text (inactive hints)
               "red"     — red-tinted (inside danger buttons)
               "large"   — like default but larger (annotation floating hints)

    Special key rendering:
      - "⌘" / "Cmd" → Lucide Command icon (sized to match text)
-->
<script lang="ts">
import { Command } from "lucide-svelte";

interface Props {
    keys: string | string[];
    variant?: "default" | "white" | "ghost" | "red" | "large" | "whiteGhost" | "fullWhite";
}

const { keys, variant = "default" }: Props = $props();

const keyList = $derived(Array.isArray(keys) ? keys : [keys]);

const base = "inline-flex items-center justify-center font-mono leading-none";

const styles: Record<string, string> = {
    default: `${base} min-w-[20px] h-[18px] px-1 text-[10px] bg-white/80 border border-black/15 shadow-sm rounded text-black/60`,
    whiteGhost: `${base} min-w-[20px] h-[18px] px-1 text-[10px] bg-white/20 border border-white/40 shadow-sm rounded text-black/60`,
    fullWhite: `${base} min-w-[20px] h-[18px] px-1 text-[10px] bg-white border border-black/15 shadow-sm rounded text-black/60`,
    red: `${base} min-w-[20px] h-[18px] px-1 text-[10px] bg-red-50 border border-red-100 shadow-sm rounded text-red-400/80`,
    large: `${base} min-w-[24px] h-[22px] px-2 text-xs bg-white/90 border border-black/12 shadow-sm rounded-md text-black/55`,
};

const iconSize: Record<string, number> = {
    // XXX: dark mode?
    default: 10,
    white: 10,
    fullWhite: 10,
    whiteGhost: 10,
    red: 10,
    large: 12,
};

function isCommandKey(k: string) {
    return k === "⌘" || k.toLowerCase() === "cmd";
}
</script>
<div class={`${base} space-x-0.5`}>
{#each keyList as key}
    <kbd class={styles[variant]}>
        {#if isCommandKey(key)}
            <Command size={iconSize[variant]} strokeWidth={2}/>
        {:else}
            {key}
        {/if}
    </kbd>
{/each}
</div>
