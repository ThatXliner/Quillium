<!--
    DuplicateDraftWarning.svelte — Confirmation shown before creating another
    revision version when the active version matches its predecessor.
-->
<script lang="ts">
import { tick } from "svelte";

let {
    open = $bindable(false),
    onConfirm,
    onNeverShowAgain,
}: {
    open: boolean;
    onConfirm: () => void;
    onNeverShowAgain: () => void;
} = $props();

let dialogEl = $state<HTMLDialogElement>();
let confirmButton = $state<HTMLButtonElement>();
let neverShowAgain = $state(false);

$effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
        neverShowAgain = false;
        dialogEl.showModal();
        void tick().then(() => confirmButton?.focus());
    } else if (!open && dialogEl.open) {
        dialogEl.close();
    }
});

function cancel(): void {
    open = false;
}

function confirm(): void {
    open = false;
    if (neverShowAgain) onNeverShowAgain();
    onConfirm();
}
</script>

<dialog
    bind:this={dialogEl}
    class="duplicate-draft-warning m-auto w-[min(420px,calc(100vw-2rem))] rounded-2xl border
        border-purple-200/70 bg-[#fdfaff] p-0 text-black shadow-2xl"
    onclick={(event) => {
        if (event.target === dialogEl) cancel();
    }}
    oncancel={(event) => {
        event.preventDefault();
        cancel();
    }}
>
    <div class="px-5 pt-5 pb-4">
        <h2 class="text-[15px] font-semibold text-black/80">Create another draft?</h2>
        <p class="mt-2 text-[13px] leading-relaxed text-black/55">
            This draft is nearly identical to the last one. The text content matches once Markdown
            formatting is ignored. Are you sure you want to create a new draft?
        </p>

        <label class="mt-4 flex cursor-pointer items-center gap-2 text-[12px] text-black/55">
            <input
                type="checkbox"
                bind:checked={neverShowAgain}
                class="size-3.5 accent-purple-500"
            />
            <span>Never show this warning again</span>
        </label>
    </div>

    <div class="flex justify-end gap-2 border-t border-black/[0.07] bg-white/45 px-5 py-3">
        <button
            class="rounded-lg px-3 py-1.5 text-[12px] font-medium text-black/55 transition-colors
                hover:bg-black/5 hover:text-black/75"
            onclick={cancel}
        >Cancel</button>
        <button
            bind:this={confirmButton}
            class="rounded-lg bg-purple-500 px-3 py-1.5 text-[12px] font-medium text-white
                shadow-sm transition-colors hover:bg-purple-600"
            onclick={confirm}
        >Create new draft</button>
    </div>
</dialog>

<style>
    .duplicate-draft-warning::backdrop {
        background: rgba(24, 16, 32, 0.22);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
    }
</style>
