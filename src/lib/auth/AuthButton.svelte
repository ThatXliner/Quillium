<!--
    AuthButton.svelte — Top-right auth button.

    Per D-10: Auth UI in top-right area of the app.
    Per D-15: Logged out: faint "Sign In" button (gray/glassy styling).
    Per D-15b: Logged in: Avatar (from display name) + dropdown menu.

    Props:
      - onauthclick: () => void — callback when sign in button clicked
-->
<script lang="ts">
import { getUser, getDisplayName, getUserEmail, signOut, isLoading, isAuthenticated } from "./auth.svelte";
import { initials, avatarColor } from "./avatarUtils";
import { toast } from "svelte-sonner";
import AvatarDropdown from "./AvatarDropdown.svelte";

const { onauthclick }: { onauthclick: () => void } = $props();

let dropdownOpen = $state(false);

// Reactive derivations
const user = $derived(getUser());
const displayName = $derived(getDisplayName() ?? "User");
const email = $derived(getUserEmail() ?? "");
const loading = $derived(isLoading());
const authenticated = $derived(isAuthenticated());

async function handleLogout() {
    try {
        await signOut();
        dropdownOpen = false;
        toast.success("Logged out");
    } catch (err) {
        toast.error("Failed to log out");
    }
}
</script>

<div class="relative">
    {#if loading}
        <!-- Loading state: show subtle placeholder -->
        <div class="w-7 h-7 rounded-full bg-black/[0.06] animate-pulse"></div>
    {:else if authenticated}
        <!-- Logged in: Avatar button per D-15b -->
        <button
            onclick={() => (dropdownOpen = !dropdownOpen)}
            class="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold
                hover:ring-2 hover:ring-black/10 transition-shadow"
            style="background: {avatarColor(displayName)};"
            aria-label="Account menu"
        >
            {initials(displayName)}
        </button>

        {#if dropdownOpen}
            <AvatarDropdown
                {displayName}
                {email}
                onlogout={handleLogout}
                onclose={() => (dropdownOpen = false)}
            />
        {/if}
    {:else}
        <!-- Logged out: Sign In button per D-15 (faint/glassy) -->
        <button
            onclick={onauthclick}
            class="px-3 py-1.5 text-xs font-medium text-black/40 bg-black/[0.04]
                border border-black/[0.06] rounded-full
                hover:text-black/60 hover:bg-black/[0.07] transition-colors"
        >
            Sign in
        </button>
    {/if}
</div>
