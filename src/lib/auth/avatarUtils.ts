/**
 * avatarUtils.ts — Avatar generation utilities.
 *
 * Generates initials and consistent colors from display names.
 * Per D-02: Avatars auto-generated from display name (client-side).
 */

/**
 * Extract up to 2-character initials from a display name.
 * Matches existing pattern in ThreadMessage.svelte.
 */
export function initials(displayName: string): string {
    if (!displayName) return "?";
    return displayName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

/**
 * Generate a consistent avatar background color from a display name.
 * Uses a simple hash to pick from a curated palette.
 */
export function avatarColor(displayName: string): string {
    const colors = [
        "#3B82F6", // blue-500
        "#10B981", // emerald-500
        "#F59E0B", // amber-500
        "#8B5CF6", // violet-500
        "#EC4899", // pink-500
        "#06B6D4", // cyan-500
    ];
    if (!displayName) return colors[0];
    let hash = 0;
    for (let i = 0; i < displayName.length; i++) {
        hash = displayName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}
