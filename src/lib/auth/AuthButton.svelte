<!--
    AuthButton.svelte — Top-right auth button.

    Per D-10: Auth UI in top-right area of the app.
    Per D-15: Logged out: faint "Sign In" button (gray/glassy styling).
    Per D-15b: Logged in: Avatar (from display name) + dropdown menu.

    Props:
      - onauthclick: () => void — callback when sign in button clicked
-->
<script lang="ts">
import {
    getCurrentUserName,
    getUserEmail,
    signOut,
    isLoading,
    isAuthenticated,
} from "./auth.svelte";
import { initials, avatarColor } from "./avatarUtils";
import { toast } from "svelte-sonner";
import AvatarDropdown from "./AvatarDropdown.svelte";
import ProfileModal from "./ProfileModal.svelte";

const { onauthclick }: { onauthclick: () => void } = $props();

let dropdownOpen = $state(false);
let profileOpen = $state(false);

// Reactive derivations
const displayName = $derived(getCurrentUserName());
const email = $derived(getUserEmail() ?? "");
const loading = $derived(isLoading());
const authenticated = $derived(isAuthenticated());

async function handleLogout() {
    try {
        await signOut();
        dropdownOpen = false;
        profileOpen = false;
        toast.success("Logged out");
    } catch (err) {
        toast.error("Failed to log out");
    }
}

function openProfile() {
    dropdownOpen = false;
    profileOpen = true;
}
</script>

<div class="relative">
    {#if loading}
        <!-- Loading state: show subtle placeholder -->
        <div class="w-10 h-10 rounded-full bg-black/[0.06] animate-pulse"></div>
    {:else if authenticated}
        <!-- Logged in: Avatar button per D-15b -->
        <button
            onclick={() => (dropdownOpen = !dropdownOpen)}
            title={displayName}
            class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold
                shadow-md hover:ring-2 hover:ring-black/10 transition-shadow"
            style="background: {avatarColor(displayName)};"
            aria-label="Account menu"
        >
            {initials(displayName)}
        </button>

        {#if dropdownOpen}
            <AvatarDropdown
                {displayName}
                {email}
                onviewprofile={openProfile}
                onlogout={handleLogout}
                onclose={() => (dropdownOpen = false)}
            />
        {/if}
    {:else}
        <!-- Logged out: Sign In button per D-15 (glassy, matching StatusBar style) -->
        <button
            onclick={onauthclick}
            class="px-4 py-2 text-xs font-medium text-black/50 bg-white/50 backdrop-blur-md
                rounded-full shadow-md inset-shadow-sm inset-shadow-white
                hover:text-black/70 hover:bg-white/60 transition-colors"
        >
            Sign in
        </button>
    {/if}
</div>

{#if profileOpen && authenticated}
    <ProfileModal
        {displayName}
        {email}
        onlogout={handleLogout}
        onclose={() => (profileOpen = false)}
    />
{/if}
