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
    getConnectionState,
    getUserEmail,
    isOffline,
    reconnectAuth,
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
let reconnecting = $state(false);

// Reactive derivations
const displayName = $derived(getCurrentUserName());
const email = $derived(getUserEmail() ?? "");
const loading = $derived(isLoading());
const authenticated = $derived(isAuthenticated());
const offline = $derived(isOffline());
const connectionState = $derived(getConnectionState());

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

async function handleReconnect() {
    reconnecting = true;
    try {
        const connected = await reconnectAuth();
        if (!connected) toast.error("Still offline");
    } catch (err) {
        toast.error("Still offline");
    } finally {
        reconnecting = false;
    }
}
</script>

<div class="relative">
    {#if loading && connectionState === "connecting" && reconnecting}
        <button
            disabled
            class="px-4 py-2 text-xs font-semibold text-red-700/60 bg-red-50/70 backdrop-blur-md
                rounded-full shadow-md inset-shadow-sm inset-shadow-white
                ring-1 ring-red-200/60 cursor-default"
        >
            Reconnecting
        </button>
    {:else if loading}
        <!-- Loading state: match the signed-out pill shape. -->
        <div class="h-8 w-[74px] rounded-full bg-black/[0.06] animate-pulse"></div>
    {:else if offline}
        <button
            onclick={handleReconnect}
            class="px-4 py-2 text-xs font-semibold text-red-700 bg-red-50/90 backdrop-blur-md
                rounded-full shadow-md inset-shadow-sm inset-shadow-white
                ring-1 ring-red-200/80 hover:text-red-800 hover:bg-red-100/90 transition-colors"
        >
            Reconnect
        </button>
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
