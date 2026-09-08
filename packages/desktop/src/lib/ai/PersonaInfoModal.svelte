<!--
    PersonaInfoModal.svelte — "What are reader personas?" info button + modal.

    Rendered next to the "Reader personas" label in the Feedback and Revise
    tab headers. Clicking the (i) button opens a centered modal explaining
    what personas do and why they default to off (each enabled persona is a
    separate parallel AI request, so they cost more tokens — see issue #259).

    A modal (native <dialog> + showModal) is used instead of an inline popover
    because the AI sidebar is too narrow to hold the explanation without
    overflowing/clipping against the editor pane.

    Self-contained: owns its open state. Props: none. Theme-neutral so both
    panels (green / purple) can use it.
-->
<script lang="ts">
import { ModalResizeHandles } from "@quillium/share";
import { InfoIcon, UsersIcon, X } from "lucide-svelte";

let open = $state(false);
let dialogEl = $state<HTMLDialogElement | undefined>(undefined);

$effect(() => {
    if (open && dialogEl && !dialogEl.open) dialogEl.showModal();
});

function close() {
    open = false;
}

function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) close();
}
</script>

<button
    type="button"
    onclick={() => (open = true)}
    aria-label="About reader personas"
    aria-haspopup="dialog"
    title="What are reader personas?"
    class="inline-flex items-center justify-center text-black/30 hover:text-black/60 transition-colors"
>
    <InfoIcon class="w-3.5 h-3.5" />
</button>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <dialog
        bind:this={dialogEl}
        class="info-modal"
        onclick={handleBackdropClick}
        oncancel={(e) => {
            e.preventDefault();
            close();
        }}
    >
        <div class="info-inner">
            <!-- Header -->
            <div
                class="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.06] shrink-0"
            >
                <h2 class="text-[13px] font-semibold text-black/60">Reader personas</h2>
                <button
                    onclick={close}
                    aria-label="Close info"
                    class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-black/25 hover:text-black/55 hover:bg-black/5 transition-colors"
                >
                    <span class="text-[9px] font-mono text-black/20 leading-none">esc</span>
                    <X size={15} />
                </button>
            </div>

            <!-- Body -->
            <div class="px-5 py-4 flex flex-col gap-3 min-h-0 overflow-y-auto">
                <p class="text-sm text-black/70 leading-relaxed font-medium">
                    Personas let several AI "readers" review your writing at once, each from a
                    distinct perspective.
                </p>
                <p class="text-[13px] text-black/50 leading-relaxed">
                    When this is on, every reader you've enabled in the <span
                        class="inline-flex items-center gap-1 whitespace-nowrap font-medium text-black/65"
                    ><UsersIcon class="w-3.5 h-3.5" />Readers</span> tab responds in parallel,
                    attaching its own comments and revisions attributed to that reader. Turn it off
                    for a single, plain response.
                </p>
                <div class="px-3.5 py-3 rounded-xl bg-black/[0.03] border border-black/[0.05]">
                    <p class="text-[12px] text-black/45 leading-relaxed">
                        They're off by default because each reader is a separate AI request — turning
                        them on uses roughly that many times more tokens.
                    </p>
                </div>
            </div>
            <ModalResizeHandles />
        </div>
    </dialog>
{/if}

<style>
    .info-modal {
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
        z-index: 100;
    }

    .info-modal::backdrop {
        background: rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(2px);
    }

    .info-inner {
        display: flex;
        flex-direction: column;
        position: relative;
        max-width: 24rem;
        width: 85vw;
        background: white;
        border-radius: 0.875rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.2);
        overflow: hidden;
    }
</style>
