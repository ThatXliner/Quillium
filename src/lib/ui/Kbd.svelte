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
    default: `${base} min-w-[20px] h-[18px] px-1 text-[10px] bg-[color:var(--surface)] border border-[color:var(--border-strong)] shadow-sm rounded text-[color:var(--text-soft)]`,
    whiteGhost: `${base} min-w-[20px] h-[18px] px-1 text-[10px] bg-[color:var(--surface-2)] border border-[color:var(--border)] shadow-sm rounded text-[color:var(--text-soft)]`,
    fullWhite: `${base} min-w-[20px] h-[18px] px-1 text-[10px] bg-[color:var(--surface)] border border-[color:var(--border-strong)] shadow-sm rounded text-[color:var(--text-soft)]`,
    red: `${base} min-w-[20px] h-[18px] px-1 text-[10px] bg-[color:var(--chip-red)] border border-[color:var(--chip-red-border)] shadow-sm rounded text-[color:var(--accent-red-text)]`,
    large: `${base} min-w-[24px] h-[22px] px-2 text-xs bg-[color:var(--surface)] border border-[color:var(--border-strong)] shadow-sm rounded-md text-[color:var(--text-soft)]`,
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
