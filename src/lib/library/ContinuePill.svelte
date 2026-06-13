<!--
    ContinuePill.svelte — Floating pill in the library that lets users
    return to their currently open document (YouTube PiP pattern).
-->
<script lang="ts">
import { currentDocumentTitle } from "$lib/stores";
import { goToEditor } from "$lib/navigation";
import { ArrowLeft } from "lucide-svelte";
import Kbd from "$lib/ui/Kbd.svelte";

interface Props {
    visible: boolean;
}

const { visible }: Props = $props();
</script>

{#if visible}
    <button
        onclick={goToEditor}
        class="group fixed bottom-6 left-6 flex items-center gap-2 px-5 py-3 rounded-full bg-[color:var(--surface)] border border-[color:var(--border)] shadow-xl backdrop-blur-md text-sm font-medium text-[color:var(--text)] hover:text-[color:var(--text-strong)] hover:bg-[color:var(--surface)] hover:shadow-2xl transition-all duration-200"
    >
        <ArrowLeft size={16} />
        Continue editing
        <span class="max-w-[140px] truncate text-[color:var(--text-soft)] font-normal">— {$currentDocumentTitle}</span>
        <Kbd keys="Esc" />
    </button>
{/if}
