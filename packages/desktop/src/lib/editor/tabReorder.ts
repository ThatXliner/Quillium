// tabReorder.ts — Pure reorder math for the document tab strip's custom drag.
//
// Extracted from DocumentTabs.svelte so the index logic is unit-testable
// without a real pointer drag (jsdom can't lay out elements or dispatch a
// faithful pointer-drag sequence). The component feeds in live geometry; this
// decides where the dragged tab lands.

/** Minimal rect for a tab: its left edge and width in strip-content coords. */
export type TabRect = { left: number; width: number };

/**
 * Given the dragged tab's current centre X (in the strip's content coordinate
 * space — i.e. including scrollLeft), the rects of every tab keyed by id, the
 * current id order, and the dragged tab's id, return the new id order.
 *
 * The dragged tab is placed at the index of the non-dragged tab whose centre
 * its own centre has passed: it sits before the first tab centred to its right,
 * and after every tab centred to its left. Returns a new array; never mutates.
 * If geometry is missing for the dragged tab, the order is returned unchanged.
 */
export function computeReorder(
    centerX: number,
    rects: Record<string, TabRect>,
    order: string[],
    draggedId: string,
): string[] {
    if (!rects[draggedId]) return order.slice();

    const others = order.filter((id) => id !== draggedId);

    // Walk the other tabs left-to-right; the insertion index is the count of
    // tabs whose centre is left of (or at) the dragged centre.
    let insertAt = 0;
    for (const id of others) {
        const r = rects[id];
        if (!r) {
            // No geometry (e.g. off-screen): keep its relative position by
            // treating it as "before" so the dragged tab doesn't jump past it.
            insertAt++;
            continue;
        }
        const center = r.left + r.width / 2;
        if (centerX > center) insertAt++;
        else break;
    }

    const next = others.slice();
    next.splice(insertAt, 0, draggedId);
    return next;
}
