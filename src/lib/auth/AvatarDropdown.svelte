<!--
    AvatarDropdown.svelte — Dropdown menu for logged-in user.

    Shows user email and logout option.

    Props:
      - displayName: string — user's display name for avatar
      - email: string — user's email
      - onlogout: () => void — callback for logout action
      - onclose: () => void — callback to close dropdown
      - onviewprofile: () => void — callback when view profile is clicked
-->
<script lang="ts">
import { initials, avatarColor } from "./avatarUtils";
import { LogOut, UserRound } from "lucide-svelte";

const {
    displayName,
    email,
    onviewprofile,
    onlogout,
    onclose,
}: {
    displayName: string;
    email: string;
    onviewprofile: () => void;
    onlogout: () => void;
    onclose: () => void;
} = $props();

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
}

function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    // Don't close if clicking the avatar button itself (parent handles toggle)
    if (target.closest(".avatar-dropdown") || target.closest("[aria-label='Account menu']")) {
        return;
    }
    onclose();
}
</script>

<svelte:window onkeydown={handleKeydown} onmousedown={handleClickOutside} />

<div
    class="avatar-dropdown absolute right-0 top-full mt-1.5 w-56 bg-white rounded-xl shadow-lg border border-black/[0.08] py-1.5 z-50"
>
    <!-- User info -->
    <div class="px-3 py-2 border-b border-black/[0.06]">
        <div class="flex items-center gap-2.5">
            <div
                class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                style="background: {avatarColor(displayName)};"
            >
                {initials(displayName)}
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-black/80 truncate">
                    {displayName}
                </div>
                <div class="text-xs text-black/40 truncate">{email}</div>
            </div>
        </div>
    </div>

    <!-- Menu items -->
    <div class="py-1">
        <button
            onclick={onviewprofile}
            class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-black/70 hover:bg-black/[0.04] transition-colors"
        >
            <UserRound size={14} class="text-black/40" />
            View profile
        </button>
        <button
            onclick={onlogout}
            class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-black/70 hover:bg-black/[0.04] transition-colors"
        >
            <LogOut size={14} class="text-black/40" />
            Log out
        </button>
    </div>
</div>
