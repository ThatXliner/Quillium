<!--
    AccountSection.svelte — Account management for SettingsModal.

    Shows login/signup form when logged out, user info + logout when logged in.
    Does NOT participate in the settings draft/save flow — auth actions
    take effect immediately.
-->
<script lang="ts">
import { LogIn, LogOut, User, Loader2 } from "lucide-svelte";
import { authState, login, signup, logout } from "$lib/sync/auth.svelte";

let mode = $state<"login" | "signup">("login");
let email = $state("");
let password = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

async function handleSubmit() {
    error = null;
    submitting = true;
    const result = mode === "login"
        ? await login(email, password)
        : await signup(email, password);
    submitting = false;
    if (result) {
        error = result;
    } else {
        email = "";
        password = "";
    }
}

async function handleLogout() {
    await logout();
}
</script>

{#if authState.loading}
    <div class="setting-row">
        <Loader2 size={14} class="animate-spin text-black/30" />
        <span class="text-[12px] text-black/40">Loading account...</span>
    </div>
{:else if authState.user}
    <div class="setting-row">
        <div class="flex items-center gap-2 flex-1 min-w-0">
            <User size={14} class="text-black/40 shrink-0" />
            <span class="text-[12px] text-black/70 truncate">
                {authState.user.email ?? "Anonymous user"}
            </span>
        </div>
        <button
            onclick={handleLogout}
            class="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-black/50 hover:text-black/70 hover:bg-black/5 transition-colors"
        >
            <LogOut size={12} />
            Sign out
        </button>
    </div>
{:else}
    <form
        onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}
        class="flex flex-col gap-2 px-1"
    >
        <div class="flex items-center gap-2">
            <input
                type="email"
                bind:value={email}
                placeholder="Email"
                required
                class="flex-1 px-2 py-1.5 rounded border border-black/10 text-[12px] bg-white/50 focus:outline-none focus:border-black/20"
            />
        </div>
        <div class="flex items-center gap-2">
            <input
                type="password"
                bind:value={password}
                placeholder="Password"
                required
                minlength={8}
                class="flex-1 px-2 py-1.5 rounded border border-black/10 text-[12px] bg-white/50 focus:outline-none focus:border-black/20"
            />
        </div>
        {#if error}
            <p class="text-[11px] text-red-500 px-0.5">{error}</p>
        {/if}
        <div class="flex items-center gap-2">
            <button
                type="submit"
                disabled={submitting}
                class="flex items-center gap-1 px-3 py-1.5 rounded text-[12px] font-medium bg-black/5 hover:bg-black/10 transition-colors disabled:opacity-50"
            >
                {#if submitting}
                    <Loader2 size={12} class="animate-spin" />
                {:else}
                    <LogIn size={12} />
                {/if}
                {mode === "login" ? "Sign in" : "Create account"}
            </button>
            <button
                type="button"
                onclick={() => { mode = mode === "login" ? "signup" : "login"; error = null; }}
                class="text-[11px] text-black/40 hover:text-black/60 transition-colors"
            >
                {mode === "login" ? "Create account" : "Sign in instead"}
            </button>
        </div>
    </form>
{/if}
