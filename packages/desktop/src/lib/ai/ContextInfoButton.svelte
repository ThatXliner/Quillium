<!--
    ContextInfoButton.svelte — Header info (ℹ) button + context detail popover.

    Stands in for the in-panel context summary card whenever that card isn't
    shown. The popover lists each context source from the packet so the writer
    can see exactly what the AI will be shown.

    `open` is bindable: the sidebar coordinates dismissal (click elsewhere in
    the sidebar, Escape before the sidebar itself closes, panel switches), so
    the open state lives with the parent's event handlers.
-->
<script lang="ts">
import { InfoIcon } from "lucide-svelte";
import type { AiContextPacket } from "./context";
import { contextScopeDetail } from "./context";

let {
    packet,
    targetLabel = "Current draft",
    ringClass,
    open = $bindable(),
}: {
    packet: AiContextPacket;
    targetLabel?: string;
    /** Focus ring class matching the active panel's accent color. */
    ringClass: string;
    open: boolean;
} = $props();

const label = $derived(`Next turn: ${targetLabel.toLowerCase()}. ${contextScopeDetail(packet)} Refreshed when you send.`);
const sources = $derived(packet.sources ?? []);
</script>

<div class="relative shrink-0">
    <button
        type="button"
        data-context-info-button
        onclick={() => (open = !open)}
        aria-label="Context: {label}"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        class="p-1.5 rounded-full transition-colors focus:outline-none focus:ring-2 {ringClass}
            {open
            ? 'text-black/60 bg-white/60'
            : 'text-black/30 hover:text-black/60 hover:bg-white/40'}"
    >
        <InfoIcon size={14} />
    </button>
    {#if open}
        <!-- Two layers: outer carries shadow + radius (no overflow → shadow stays
             rounded); inner carries backdrop-blur + radius + overflow-hidden so the
             blur is clipped without WebKit squaring the shadow at the corners. -->
        <div
            class="context-popover absolute right-0 top-full mt-1.5 z-10 w-64
                rounded-xl shadow-lg"
            role="dialog"
            aria-label="AI context details"
        >
            <div
                class="rounded-xl border border-black/10 bg-white/95 backdrop-blur-md
                p-3 text-left overflow-hidden"
            >
                <p class="text-[11px] font-semibold text-black/70 leading-snug">
                    Next turn: {targetLabel.toLowerCase()}
                </p>
                <p class="mt-0.5 text-[10px] text-black/45 leading-relaxed">
                    {contextScopeDetail(packet)} Refreshed when you send. Draft passages and annotation discussions can be read on demand. Earlier responses describe the writing as it was then.
                </p>
                <div class="mt-2.5 flex flex-col gap-1.5">
                    {#each sources as source (source.id)}
                        <div class="flex items-start gap-2">
                            <span
                                class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full
                                    {source.active ? 'bg-emerald-500' : 'bg-black/15'}"
                            ></span>
                            <div class="min-w-0 flex-1">
                                <p
                                    class="text-[10px] font-medium leading-tight
                                        {source.active ? 'text-black/70' : 'text-black/35'}"
                                >
                                    {source.label}
                                </p>
                                <p class="text-[10px] text-black/40 leading-snug truncate">
                                    {source.detail}
                                </p>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
</div>
