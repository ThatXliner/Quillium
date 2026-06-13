<!--
    NameEntryModal.svelte — Name entry modal for anonymous users joining shared documents.

    Per D-22: Lightweight feel, not a full sign-up form.
    Per D-23: Triggers only when joining a shared document.
    Per D-26: Optional sign-in link for account upgrade flow.

    Props:
      - onclose: () => void — called when modal closes
      - onjoin: () => void — called after successful anonymous sign-in
-->
<script lang="ts">
import { X } from "lucide-svelte";
import { toast } from "svelte-sonner";
import { signInAnonymously } from "./auth.svelte";
import { avatarColor, initials } from "./avatarUtils";
import { displayNameSchema } from "./schemas";

const { onclose, onjoin }: { onclose: () => void; onjoin: () => void } = $props();

let dialogEl = $state<HTMLDialogElement | undefined>(undefined);
let inputEl = $state<HTMLInputElement | undefined>(undefined);

// Form state
let displayName = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

// Computed avatar values
const avatarInitials = $derived(displayName.trim() ? initials(displayName.trim()) : "?");
const avatarBg = $derived(displayName.trim() ? avatarColor(displayName.trim()) : "#3B82F6");

$effect(() => {
    if (dialogEl && !dialogEl.open) {
        dialogEl.showModal();
    }
});

$effect(() => {
    // Focus input on mount
    if (inputEl) {
        inputEl.focus();
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

function handleSignInClick() {
    // Close this modal so caller can show AuthModal
    onclose();
}

async function handleSubmit(e: Event) {
    e.preventDefault();
    error = null;
    submitting = true;

    try {
        const result = displayNameSchema.safeParse({ displayName });
        if (!result.success) {
            error = result.error.issues[0]?.message ?? "Invalid input";
            submitting = false;
            return;
        }

        const trimmedName = result.data.displayName;
        await signInAnonymously(trimmedName);
        toast.success(`Welcome, ${trimmedName}!`);
        onjoin();
    } catch (err: unknown) {
        // Preserve Supabase error context (codes, status) for debugging
        if (err && typeof err === "object" && "message" in err) {
            error = String(err.message);
        } else {
            error = "Failed to join";
        }
    } finally {
        submitting = false;
    }
}

// Validation for button disabled state
const isNameValid = $derived.by(() => {
    const trimmed = displayName.trim();
    return trimmed.length >= 2 && trimmed.length <= 50;
});
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialogEl} class="name-entry-modal" onclick={handleBackdropClick}>
    <div class="name-entry-modal-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-[color:var(--border)]">
            <h2 class="text-base font-semibold text-[color:var(--text-strong)]">Join Document</h2>
            <button
                onclick={onclose}
                aria-label="Close"
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-[color:var(--text-ghost)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)] transition-colors"
            >
                <span class="text-[9px] font-mono text-[color:var(--text-ghost)] leading-none">esc</span>
                <X size={15} />
            </button>
        </div>

        <!-- Form -->
        <form onsubmit={handleSubmit} class="px-5 py-4 flex flex-col gap-4">
            <!-- Avatar preview + Input row -->
            <div class="flex items-end gap-3">
                <!-- Avatar preview -->
                <div
                    class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style="background-color: {avatarBg}"
                >
                    <span class="text-xs font-semibold text-white">{avatarInitials}</span>
                </div>

                <!-- Input field -->
                <div class="flex flex-col gap-1.5 flex-1">
                    <label for="displayName" class="text-xs text-[color:var(--text-soft)]">Your name</label>
                    <input
                        bind:this={inputEl}
                        id="displayName"
                        type="text"
                        bind:value={displayName}
                        placeholder="How should others see you?"
                        autocomplete="name"
                        class="px-3 py-2 text-sm border border-[color:var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-[color:var(--text-ghost)]"
                    />
                </div>
            </div>

            {#if error}
                <div role="alert" class="text-xs text-[color:var(--accent-red-text)] bg-[color:var(--chip-red)] px-3 py-2 rounded-lg">
                    {error}
                </div>
            {/if}

            <button
                type="submit"
                disabled={submitting || !isNameValid}
                aria-disabled={submitting}
                class="w-full px-4 py-2 text-sm font-semibold text-[color:var(--accent-blue-text)] bg-[color:var(--chip-blue)] rounded-lg
                    hover:bg-[color:var(--chip-blue-strong)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {#if submitting}
                    Joining...
                {:else}
                    Join Document
                {/if}
            </button>

            <!-- Sign-in link per D-26 -->
            <button
                type="button"
                onclick={handleSignInClick}
                class="text-xs text-[color:var(--text-faint)] hover:text-blue-500 transition-colors"
            >
                Already have an account? Sign in
            </button>
        </form>
    </div>
</dialog>

<style>
    .name-entry-modal {
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

    .name-entry-modal::backdrop {
        background: rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(4px);
    }

    .name-entry-modal-inner {
        width: 320px;
        background: var(--surface);
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(var(--shadow-color), 0.2);
        overflow: hidden;
    }
</style>
