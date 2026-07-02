<script lang="ts">
import { isAnonymous } from "./auth.svelte";
import { avatarColor, initials } from "./avatarUtils";
import { Mail, LogOut, UserRound, X } from "lucide-svelte";

const {
    displayName,
    email,
    onlogout,
    onclose,
}: {
    displayName: string;
    email: string;
    onlogout: () => void;
    onclose: () => void;
} = $props();

let dialogEl = $state<HTMLDialogElement | undefined>(undefined);

const accountLabel = $derived(isAnonymous() ? "Guest collaborator" : "Signed-in account");
const emailLabel = $derived(email || "No email on this account");

$effect(() => {
    if (dialogEl && !dialogEl.open) {
        dialogEl.showModal();
    }
});

function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) onclose();
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        e.preventDefault();
        onclose();
    }
}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialogEl} class="profile-modal" onclick={handleBackdropClick}>
    <div class="profile-modal-inner">
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.06]">
            <h2 class="text-[13px] font-semibold text-black/60">Profile</h2>
            <button
                onclick={onclose}
                aria-label="Close profile"
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-black/25 hover:text-black/55 hover:bg-black/5 transition-colors"
            >
                <span class="text-[9px] font-mono text-black/20 leading-none">esc</span>
                <X size={15} />
            </button>
        </div>

        <div class="px-5 py-5 flex flex-col gap-4">
            <div class="flex items-center gap-3">
                <div
                    class="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-semibold shadow-md"
                    style="background: {avatarColor(displayName)};"
                >
                    {initials(displayName)}
                </div>
                <div class="min-w-0">
                    <div class="text-base font-semibold text-black/80 truncate">{displayName}</div>
                    <div class="text-xs text-black/45">{accountLabel}</div>
                </div>
            </div>

            <div class="rounded-2xl border border-black/[0.06] bg-black/[0.02] px-3 py-3 space-y-3">
                <div class="flex items-start gap-2.5">
                    <UserRound size={15} class="mt-0.5 text-black/35 shrink-0" />
                    <div class="min-w-0">
                        <div class="text-[11px] uppercase tracking-wider text-black/35">Username</div>
                        <div class="text-sm text-black/75 break-words">{displayName}</div>
                    </div>
                </div>
                <div class="flex items-start gap-2.5">
                    <Mail size={15} class="mt-0.5 text-black/35 shrink-0" />
                    <div class="min-w-0">
                        <div class="text-[11px] uppercase tracking-wider text-black/35">Email</div>
                        <div class="text-sm text-black/75 break-words">{emailLabel}</div>
                    </div>
                </div>
            </div>

            <button
                onclick={onlogout}
                class="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-medium text-white bg-black/80 rounded-xl hover:bg-black transition-colors"
            >
                <LogOut size={15} />
                Log out
            </button>
        </div>
    </div>
</dialog>

<style>
    .profile-modal {
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

    .profile-modal::backdrop {
        background: rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(4px);
    }

    .profile-modal-inner {
        width: 360px;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.2);
        overflow: hidden;
    }
</style>
