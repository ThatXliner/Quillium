<!--
    AuthButton.svelte — Top-right auth button.

    Per D-10: Auth UI in top-right area of the app.
    Per D-15: Logged out: faint "Sign In" button (gray/glassy styling).
    Per D-15b: Logged in: Avatar (from display name) + dropdown menu.

    Props:
      - onauthclick: () => void — callback when sign in button clicked
-->
<script lang="ts">
import { toast } from "svelte-sonner";
import AvatarDropdown from "./AvatarDropdown.svelte";
import ProfileModal from "./ProfileModal.svelte";
import { getCurrentUserName, getUserEmail, isAuthenticated, signOut } from "./auth.svelte";
import { avatarColor, initials } from "./avatarUtils";

const { onauthclick }: { onauthclick: () => void } = $props();

let dropdownOpen = $state(false);
let profileOpen = $state(false);

// Reactive derivations
const displayName = $derived(getCurrentUserName());
const email = $derived(getUserEmail() ?? "");
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
    {#if authenticated}
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
        <!-- Logged out: Sign In button per D-15 (glassy, matching StatusBar style)
             Two layers on purpose. The OUTER button carries the shadow + radius but
             NO overflow clip, and the INNER carries the backdrop-blur + radius +
             overflow-hidden + background. In WebKit (Tauri) a single element with
             backdrop-filter + border-radius leaks a square blur halo unless it has
             overflow:hidden — but overflow:hidden on an element with a box-shadow
             makes WebKit clip the shadow to a square. Splitting fixes both. -->
        <button
            onclick={onauthclick}
            class="rounded-full shadow-md hover:text-black/70 text-black/50 transition-colors"
        >
            <span
                class="flex px-4 py-2 text-xs font-medium bg-white/50 backdrop-blur-md
                    rounded-full inset-shadow-sm inset-shadow-white overflow-hidden
                    hover:bg-white/60 transition-colors"
            >
                Sign in
            </span>
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
