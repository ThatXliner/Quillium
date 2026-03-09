<!--
    ContinuePill.svelte — Floating pill in the library that lets users
    return to their currently open document (YouTube PiP pattern).
-->
<script lang="ts">
import { currentDocumentTitle } from "$lib/stores";
import { goToEditor } from "$lib/navigation";
import { ArrowLeft } from "lucide-svelte";

interface Props {
    visible: boolean;
}

const { visible }: Props = $props();
</script>

{#if visible}
    <button
        onclick={goToEditor}
        class="group fixed bottom-6 left-6 flex items-center gap-2 px-5 py-3 rounded-full bg-white/90 border border-white/60 shadow-xl backdrop-blur-md text-sm font-medium text-black/70 hover:text-black hover:bg-white hover:shadow-2xl transition-all duration-200"
    >
        <ArrowLeft size={16} />
        Continue editing
        <span class="max-w-[140px] truncate text-black/50 font-normal">— {$currentDocumentTitle}</span>
        <kbd class="text-[10px] font-mono bg-black/10 border border-black/10 rounded px-1 py-0.5 text-black/25 group-hover:text-black/40 transition-colors leading-none">Esc</kbd>
    </button>
{/if}
