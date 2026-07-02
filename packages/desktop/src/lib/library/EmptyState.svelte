<!--
    EmptyState.svelte — Shown when no documents exist yet.
-->
<script lang="ts">
import { BookOpen, Plus } from "lucide-svelte";
import Kbd from "$lib/ui/Kbd.svelte";

interface Props {
    onNew: () => void;
}

const { onNew }: Props = $props();
</script>

<div class="flex-1 flex flex-col items-center justify-center gap-5 p-12 text-center">
    <div class="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center">
        <BookOpen size={28} class="text-blue-400" />
    </div>
    <div>
        <h3 class="text-base font-semibold text-black/60 mb-1">No documents yet</h3>
        <p class="text-sm text-black/40 max-w-xs">
            Start a new document and your writing will appear here.
        </p>
    </div>
    <button
        onclick={onNew}
        class="group flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium shadow-sm transition-colors"
    >
        <Plus size={16} />
        Create first document
        <Kbd variant="fullWhite" keys="N" />
    </button>
</div>
