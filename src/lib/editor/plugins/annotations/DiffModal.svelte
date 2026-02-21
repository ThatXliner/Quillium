<script lang="ts">
    import { SparklesIcon, X } from "lucide-svelte";
    import { tick } from "svelte";
    import { activeModal, type DiffOp } from "$lib/stores";

    const { ops }: { ops: DiffOp[] } = $props();

    let dialogEl = $state<HTMLDialogElement>();

    function close() {
        activeModal.set(null);
    }

    $effect(() => {
        tick().then(() => {
            if (dialogEl && !dialogEl.open) dialogEl.showModal();
        });
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="diff-modal"
    onclick={(e) => { if (e.target === dialogEl) close(); }}
>
    <div class="diff-modal-inner">
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-green-100/80 shrink-0">
            <div class="flex items-center gap-2">
                <SparklesIcon size={13} class="text-green-500/70" />
                <span class="text-xs font-semibold text-green-700/70 uppercase tracking-wider">Changes</span>
            </div>
            <button
                class="p-1 rounded-md text-black/30 hover:text-black/60 hover:bg-black/5 transition-colors"
                onclick={close}
            >
                <X size={16} />
            </button>
        </div>
        <div class="overflow-y-auto px-5 py-4 text-sm leading-relaxed font-mono flex-1">
            {#each ops as op}
                {#if op.type === "equal"}
                    <span>{op.text}</span>
                {:else if op.type === "delete"}
                    <span class="bg-red-100/80 text-red-700 line-through rounded-sm px-0.5">{op.text}</span>
                {:else}
                    <span class="bg-green-100/80 text-green-700 rounded-sm px-0.5">{op.text}</span>
                {/if}
            {/each}
        </div>
    </div>
</dialog>

<style>
    .diff-modal {
        border: none;
        padding: 0;
        background: transparent;
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .diff-modal::backdrop {
        background: rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(4px);
    }

    .diff-modal-inner {
        display: flex;
        flex-direction: column;
        width: 680px;
        max-height: 72vh;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        overflow: hidden;
    }
</style>
