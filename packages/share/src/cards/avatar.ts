const AVATAR_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4"];

function normalizeDisplayName(displayName: string): string {
    return displayName.trim().replace(/\s+/g, " ");
}

export function initials(displayName: string): string {
    const normalized = normalizeDisplayName(displayName);
    if (!normalized) return "?";
    return normalized
        .split(" ")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

export function avatarColor(displayName: string): string {
    const normalized = normalizeDisplayName(displayName);
    if (!normalized) return AVATAR_COLORS[0];
    let hash = 0;
    for (let index = 0; index < normalized.length; index += 1) {
        hash = normalized.charCodeAt(index) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
