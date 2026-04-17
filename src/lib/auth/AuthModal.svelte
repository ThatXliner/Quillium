<!--
    AuthModal.svelte — Login/signup modal dialog.

    Per D-17: Simple auth modal with tabs to switch between login/signup.
    Per D-16: Display name collected during sign-up.
    Per D-13: No email verification (instant activation).

    Props:
      - onclose: () => void — called when modal closes
-->
<script lang="ts">
import { signUp, signIn } from "./auth.svelte";
import { loginSchema, signUpSchema } from "./schemas";
import { toast } from "svelte-sonner";
import { X } from "lucide-svelte";

const { onclose }: { onclose: () => void } = $props();

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
                error = result.error.errors[0]?.message ?? "Invalid input";
                submitting = false;
                return;
            }
            await signIn(email, password);
            toast.success("Welcome back!");
            onclose();
        } else {
            const result = signUpSchema.safeParse({ email, password, displayName });
            if (!result.success) {
                error = result.error.errors[0]?.message ?? "Invalid input";
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
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.06]">
            <h2 class="text-[13px] font-semibold text-black/60">
                {activeTab === "login" ? "Log In" : "Sign Up"}
            </h2>
            <button
                onclick={onclose}
                aria-label="Close"
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-black/25 hover:text-black/55 hover:bg-black/5 transition-colors"
            >
                <span class="text-[9px] font-mono text-black/20 leading-none">esc</span>
                <X size={15} />
            </button>
        </div>

        <!-- Tab switcher -->
        <div class="flex gap-1 px-5 pt-4">
            <button
                onclick={() => switchTab("login")}
                class="px-4 py-1.5 text-xs font-medium rounded-full transition-colors
                    {activeTab === 'login' ? 'bg-blue-500 text-white' : 'text-black/40 hover:text-black/60 hover:bg-black/5'}"
            >Log in</button>
            <button
                onclick={() => switchTab("signup")}
                class="px-4 py-1.5 text-xs font-medium rounded-full transition-colors
                    {activeTab === 'signup' ? 'bg-blue-500 text-white' : 'text-black/40 hover:text-black/60 hover:bg-black/5'}"
            >Sign up</button>
        </div>

        <!-- Form -->
        <form onsubmit={handleSubmit} class="px-5 py-4 flex flex-col gap-3">
            {#if activeTab === "signup"}
                <div class="flex flex-col gap-1.5">
                    <label for="displayName" class="text-xs font-medium text-black/50">Display name</label>
                    <input
                        id="displayName"
                        type="text"
                        bind:value={displayName}
                        placeholder="Your name"
                        autocomplete="name"
                        class="px-3 py-2 text-sm border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-black/25"
                    />
                </div>
            {/if}

            <div class="flex flex-col gap-1.5">
                <label for="email" class="text-xs font-medium text-black/50">Email</label>
                <input
                    id="email"
                    type="email"
                    bind:value={email}
                    placeholder="you@example.com"
                    autocomplete="email"
                    class="px-3 py-2 text-sm border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-black/25"
                />
            </div>

            <div class="flex flex-col gap-1.5">
                <label for="password" class="text-xs font-medium text-black/50">Password</label>
                <input
                    id="password"
                    type="password"
                    bind:value={password}
                    placeholder={activeTab === "signup" ? "At least 8 characters" : "Your password"}
                    autocomplete={activeTab === "login" ? "current-password" : "new-password"}
                    class="px-3 py-2 text-sm border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-black/25"
                />
            </div>

            {#if error}
                <div class="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">
                    {error}
                </div>
            {/if}

            <button
                type="submit"
                disabled={submitting}
                class="mt-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg
                    hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.2);
        overflow: hidden;
    }
</style>
