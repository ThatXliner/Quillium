/**
 * avatar.ts — Pure avatar/persona presentation helpers.
 *
 * Copied from the desktop app (auth/avatarUtils.ts + readers/colors.ts) so the
 * shared annotation UI components render identical avatars in both the editor
 * and the web preview, with no app/Tauri coupling.
 */

/** A reader persona, reduced to what the thread avatar needs. */
export type Persona = { name: string; color: string; emoji?: string };

const AVATAR_COLORS = [
    "#3B82F6", // blue-500
    "#10B981", // emerald-500
    "#F59E0B", // amber-500
    "#8B5CF6", // violet-500
    "#EC4899", // pink-500
    "#06B6D4", // cyan-500
];

function normalizeDisplayName(displayName: string): string {
    return displayName.trim().replace(/\s+/g, " ");
}

/** Up to 2-character initials from a display name. */
export function initials(displayName: string): string {
    const normalized = normalizeDisplayName(displayName);
    if (!normalized) return "?";
    return normalized
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

/** Consistent avatar background color hashed from a display name. */
export function avatarColor(displayName: string): string {
    const normalized = normalizeDisplayName(displayName);
    if (!normalized) return AVATAR_COLORS[0];
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Lighten a hex color to ~90% lightness for persona avatar backgrounds. */
export function lightTint(hex: string): string {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * 0.85);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** Medium tint for persona avatar borders (~60% lightness). */
export function mediumTint(hex: string): string {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * 0.55);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
