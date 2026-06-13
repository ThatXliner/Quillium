<!--
    AuthModal.svelte — Login/signup modal dialog.

    Per D-17: Simple auth modal with tabs to switch between login/signup.
    Per D-16: Display name collected during sign-up.
    Per D-13: No email verification (instant activation).

    Props:
      - onclose: () => void — called when modal closes
-->
<script lang="ts">
import { OMNI_WAITLIST_URL } from "$lib/constants";
import { debugAuthWaitlistMode } from "$lib/debug/store.svelte";
import { X } from "lucide-svelte";
import { toast } from "svelte-sonner";
import { signIn, signUp } from "./auth.svelte";
import { loginSchema, signUpSchema } from "./schemas";

const { onclose }: { onclose: () => void } = $props();
const signupsEnabled = $derived(import.meta.env.DEV && !$debugAuthWaitlistMode);

let dialogEl = $state<HTMLDialogElement | undefined>(undefined);
let activeTab = $state<"login" | "signup">("login");

// Form state
let email = $state("");
let password = $state("");
let displayName = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

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

function resetForm() {
    email = "";
    password = "";
    displayName = "";
    error = null;
}

function switchTab(tab: "login" | "signup") {
    activeTab = tab;
    resetForm();
}

async function handleSubmit(e: Event) {
    e.preventDefault();
    error = null;
    submitting = true;

    try {
        if (activeTab === "login") {
            const result = loginSchema.safeParse({ email, password });
            if (!result.success) {
                error = result.error.issues[0]?.message ?? "Invalid input";
                submitting = false;
                return;
            }
            await signIn(email, password);
            toast.success("Welcome back!");
            onclose();
        } else {
            if (!signupsEnabled) {
                // This should never happen
                console.assert(false);
                window.open(OMNI_WAITLIST_URL, "_blank", "noopener,noreferrer");
                error = "New accounts are waitlist-only during beta.";
                return;
            }
            const result = signUpSchema.safeParse({ email, password, displayName });
            if (!result.success) {
                error = result.error.issues[0]?.message ?? "Invalid input";
                submitting = false;
                return;
            }
            await signUp(email, password, displayName);
            toast.success("Account created! You're now signed in.");
            onclose();
        }
    } catch (err) {
        error = err instanceof Error ? err.message : "Authentication failed";
    } finally {
        submitting = false;
    }
}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialogEl} class="auth-modal" onclick={handleBackdropClick}>
    <div class="auth-modal-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-[color:var(--border)]">
            <h2 class="text-[13px] font-semibold text-[color:var(--text-soft)]">
                {activeTab === "login" ? "Log In" : "Sign Up"}
            </h2>
            <button
                onclick={onclose}
                aria-label="Close"
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-[color:var(--text-ghost)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)] transition-colors"
            >
                <span class="text-[9px] font-mono text-[color:var(--text-ghost)] leading-none">esc</span>
                <X size={15} />
            </button>
        </div>

        <!-- Tab switcher -->
        <div class="flex gap-1 px-5 pt-4">
            <button
                onclick={() => switchTab("login")}
                class="px-4 py-1.5 text-xs font-medium rounded-full transition-colors
                    {activeTab === 'login' ? 'bg-[color:var(--selected-bg)] text-[color:var(--selected-text)]' : 'text-[color:var(--text-faint)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)]'}"
            >Log in</button>
            {#if signupsEnabled}
                <button
                    onclick={() => switchTab("signup")}
                    class="px-4 py-1.5 text-xs font-medium rounded-full transition-colors
                        {activeTab === 'signup' ? 'bg-[color:var(--selected-bg)] text-[color:var(--selected-text)]' : 'text-[color:var(--text-faint)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)]'}"
                >
                   Sign up
                </button>
            {:else}
                <a href={OMNI_WAITLIST_URL} target="_blank" rel="noreferrer" class="px-4 py-1.5 text-xs font-medium rounded-full transition-colors {activeTab === 'signup' ? 'bg-[color:var(--selected-bg)] text-[color:var(--selected-text)]' : 'text-[color:var(--text-faint)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)]'}">
                    Join the waitlist
                </a>
            {/if}

        </div>

        <!-- Form -->
        <form onsubmit={handleSubmit} class="px-5 py-4 flex flex-col gap-3">
            {#if activeTab === "signup"}
                <div class="flex flex-col gap-1.5">
                    <label for="displayName" class="text-xs font-medium text-[color:var(--text-soft)]">Display name</label>
                    <input
                        id="displayName"
                        type="text"
                        bind:value={displayName}
                        placeholder="Your name"
                        autocomplete="name"
                        class="px-3 py-2 text-sm border border-[color:var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-[color:var(--text-ghost)]"
                    />
                </div>
            {/if}

            <div class="flex flex-col gap-1.5">
                <label for="email" class="text-xs font-medium text-[color:var(--text-soft)]">Email</label>
                <input
                    id="email"
                    type="email"
                    bind:value={email}
                    placeholder="you@example.com"
                    autocomplete="email"
                    class="px-3 py-2 text-sm border border-[color:var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-[color:var(--text-ghost)]"
                />
            </div>

            <div class="flex flex-col gap-1.5">
                <label for="password" class="text-xs font-medium text-[color:var(--text-soft)]">Password</label>
                <input
                    id="password"
                    type="password"
                    bind:value={password}
                    placeholder={activeTab === "signup" ? "At least 8 characters" : "Your password"}
                    autocomplete={activeTab === "login" ? "current-password" : "new-password"}
                    class="px-3 py-2 text-sm border border-[color:var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-[color:var(--text-ghost)]"
                />
            </div>

            {#if error}
                <div class="text-xs text-[color:var(--accent-red-text)] bg-[color:var(--chip-red)] border border-[color:var(--chip-red-border)] px-3 py-2 rounded-lg">
                    {error}
                </div>
            {/if}

            <button
                type="submit"
                disabled={submitting}
                class="mt-2 px-4 py-2.5 text-sm font-medium text-[color:var(--accent-blue-text)] bg-[color:var(--chip-blue)] rounded-lg
                    hover:bg-[color:var(--chip-blue-strong)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {#if submitting}
                    {activeTab === "login" ? "Logging in..." : "Creating account..."}
                {:else}
                    {activeTab === "login" ? "Log in" : "Create account"}
                {/if}
            </button>
        </form>
    </div>
</dialog>

<style>
    .auth-modal {
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

    .auth-modal::backdrop {
        background: rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(4px);
    }

    .auth-modal-inner {
        width: 360px;
        background: var(--surface);
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(var(--shadow-color), 0.2);
        overflow: hidden;
    }
</style>
