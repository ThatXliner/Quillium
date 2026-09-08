<!--
    DuplicateDraftWarning.svelte — Confirmation shown before creating another
    revision version when the active version matches its predecessor.
-->
<script lang="ts">
import { ModalResizeHandles, RestoreSizeButton } from "@quillium/share";
import { tick } from "svelte";

let {
    open = $bindable(false),
    onConfirm,
    onHideForOneHour,
    onNeverShowAgain,
}: {
    open: boolean;
    onConfirm: () => void;
    onHideForOneHour: () => void;
    onNeverShowAgain: () => void;
} = $props();

let dialogEl = $state<HTMLDialogElement>();
let confirmButton = $state<HTMLButtonElement>();
let dismissalChoice = $state<"none" | "hour" | "never">("none");

$effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
        dismissalChoice = "none";
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
    if (dismissalChoice === "hour") onHideForOneHour();
    if (dismissalChoice === "never") onNeverShowAgain();
    onConfirm();
}

let restoreSize = $state<(() => void) | undefined>();
</script>

<dialog
    bind:this={dialogEl}
    class="open:flex flex-col overflow-hidden duplicate-draft-warning m-auto w-[min(500px,calc(100vw-2rem))] rounded-2xl border
        border-purple-200/70 bg-[#fdfaff] p-0 text-black shadow-2xl"
    onclick={(event) => {
        if (event.target === dialogEl) cancel();
    }}
    oncancel={(event) => {
        event.preventDefault();
        cancel();
    }}
>
    <div class="min-h-0 overflow-y-auto px-5 pt-5 pb-4">
        <div class="flex min-h-[26px] items-center justify-between gap-2">
            <h2 class="text-[15px] font-semibold text-black/80">Create another draft?</h2>
            <RestoreSizeButton {restoreSize} />
        </div>
        <p class="mt-2 text-[13px] leading-relaxed text-black/55">
            This draft is nearly identical to the last one. The text content matches once Markdown
            formatting is ignored. Are you sure you want to create a new draft?
        </p>

        <div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <label class="flex cursor-pointer items-center gap-2 text-[12px] text-black/55">
                <input
                    type="radio"
                    name="duplicate-draft-dismissal"
                    checked={dismissalChoice === "hour"}
                    onchange={() => (dismissalChoice = "hour")}
                    class="size-3.5 accent-purple-500"
                />
                <span>Hide warnings for one hour</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-[12px] text-black/55">
                <input
                    type="radio"
                    name="duplicate-draft-dismissal"
                    checked={dismissalChoice === "never"}
                    onchange={() => (dismissalChoice = "never")}
                    class="size-3.5 accent-purple-500"
                />
                <span>Never show this warning again</span>
            </label>
        </div>
    </div>

    <div class="shrink-0 flex justify-end gap-2 border-t border-black/[0.07] bg-white/45 px-5 py-3">
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
    <ModalResizeHandles bind:restoreSize minHeight={220} />
</dialog>

<style>
    .duplicate-draft-warning::backdrop {
        background: rgba(24, 16, 32, 0.22);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
    }
</style>
