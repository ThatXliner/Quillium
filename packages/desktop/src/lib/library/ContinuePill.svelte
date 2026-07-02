<!--
    ContinuePill.svelte — Floating pill in the library that lets users
    return to their currently open document (YouTube PiP pattern).
-->
<script lang="ts">
import { goToEditor } from "$lib/navigation";
import { currentDocumentTitle } from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
import { ArrowLeft } from "lucide-svelte";

interface Props {
    visible: boolean;
}

const { visible }: Props = $props();
</script>

{#if visible}
    <!-- Two layers: outer carries shadow + radius (no overflow → shadow stays rounded);
         inner carries backdrop-blur + radius + overflow-hidden (clips the blur to the
         corner). In WebKit a single element with backdrop-filter + radius + overflow-hidden
         + box-shadow squares the shadow at the corners; splitting avoids it while still
         clipping the blur. -->
    <button
        onclick={goToEditor}
        class="group fixed bottom-6 left-6 rounded-full shadow-xl hover:shadow-2xl transition-all duration-200"
    >
        <div
            class="flex items-center gap-2 overflow-hidden px-5 py-3 rounded-full bg-white/90 border border-white/60 backdrop-blur-md text-sm font-medium text-black/70 group-hover:text-black group-hover:bg-white transition-all duration-200"
        >
            <ArrowLeft size={16} />
            Continue editing
            <span class="max-w-[140px] truncate text-black/50 font-normal">— {$currentDocumentTitle}</span>
            <Kbd keys="Esc" />
        </div>
    </button>
{/if}
