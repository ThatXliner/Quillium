/**
 * groupColor.ts — Stable presentation colors for linked revision groups.
 *
 * Group ids are persisted while their labels may change, so colors are keyed
 * by id. Keeping this in the shared package lets desktop and read-only surfaces
 * render the same group with the same color without sharing editor state.
 */
const GROUP_COLORS = ["#3b82f6", "#f97316", "#a855f7", "#14b8a6", "#ec4899", "#eab308"];

export function groupColor(groupId: string): string {
    let hash = 0;
    for (let index = 0; index < groupId.length; index += 1) {
        hash = (hash * 31 + groupId.charCodeAt(index)) >>> 0;
    }
    return GROUP_COLORS[hash % GROUP_COLORS.length];
}
