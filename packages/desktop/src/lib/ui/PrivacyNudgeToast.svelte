<script lang="ts">
import { Check, Copy, Settings } from "lucide-svelte";

interface Props {
    summary: string;
    code: string;
    onaction: () => void;
    ondismiss: () => void;
}

let { summary, code, onaction, ondismiss }: Props = $props();
let copied = $state(false);

function copyCode() {
    navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => {
        copied = false;
    }, 1500);
}
</script>

<!-- Two layers: outer carries shadow + radius (no overflow → shadow stays rounded);
     inner carries backdrop-blur + radius + overflow-hidden (clips the blur to the
     corner). In WebKit a single element with backdrop-filter + radius + overflow-hidden
     + box-shadow squares the shadow at the corners; splitting avoids it while still
     clipping the blur. -->
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="w-[340px] rounded-xl shadow-lg">
    <div
        class="flex flex-col gap-2.5 px-4 py-3.5 rounded-xl overflow-hidden
            bg-gray-300/70 backdrop-blur-md border border-white/30
            text-[13px] text-black/80"
    >
        <div class="flex items-start justify-between gap-2">
            <p class="leading-snug">{summary}</p>
            <button
                onclick={ondismiss}
                class="shrink-0 text-black/25 hover:text-black/50 transition-colors text-[11px] mt-0.5"
                aria-label="Dismiss"
            >&times;</button>
        </div>

        <!-- Incident code -->
        <div class="flex items-center gap-2">
            <span class="text-black/40 text-[11px]">Code</span>
            <span
                class="font-mono text-[12px] bg-black/[0.06] rounded px-1.5 py-0.5 text-black/70 select-all"
            >{code}</span>
            <button
                onclick={copyCode}
                class="text-black/30 hover:text-black/60 transition-colors"
                aria-label="Copy code"
            >
                {#if copied}
                    <Check size={13} class="text-green-600" />
                {:else}
                    <Copy size={13} />
                {/if}
            </button>
        </div>

        <p class="text-[11px] text-black/40 leading-snug">
            Enable "Share your document" in settings to help us fix this.
        </p>

        <button
            onclick={onaction}
            class="flex items-center justify-center gap-1.5 w-full py-1.5
                rounded-lg bg-blue-500/90 hover:bg-blue-500 text-white text-[12px]
                font-medium transition-colors"
        >
            <Settings size={13} />
            Open Settings
        </button>
    </div>
</div>
