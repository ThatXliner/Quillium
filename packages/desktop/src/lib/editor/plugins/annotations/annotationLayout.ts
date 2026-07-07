/**
 * annotationLayout.ts — Pure layout math for the floating annotation columns.
 *
 * Extracted from Annotations.svelte so the trickiest layout logic is
 * DOM-free and unit-testable: the component measures the DOM (card heights,
 * viewport coordinates) and applies the results; everything in here is a
 * deterministic function of its inputs.
 */

export type ColumnSide = "left" | "right";

/** One card as the layout sees it: its id, natural Y, and measured height. */
export type LayoutItem = { id: number; viewportY: number; height: number };
export type BalanceItem = LayoutItem & { viewportX: number };

/** Minimum vertical gap kept between stacked cards. */
export const MIN_SPACING = 8;
/** Cards never start above this viewport Y (below the toolbar). */
export const TOP_CLAMP = 64;

/**
 * Balancing core for the "visual-split" layout: assign each card to the
 * column whose running bottom is higher up (more open vertical room near
 * this card's Y), so the two columns stay roughly even and cards land near
 * their text. Ties break toward the side the text sits on, then by id for
 * stability. Deterministic — no randomness — so assignments are stable
 * across re-renders given stable inputs.
 */
export function balanceColumns(
    items: BalanceItem[],
    viewportCenterX: number,
): { [id: number]: ColumnSide } {
    const sorted = [...items].sort((a, b) =>
        a.viewportY !== b.viewportY ? a.viewportY - b.viewportY : a.id - b.id,
    );
    const side: { [id: number]: ColumnSide } = {};
    let leftBottom = TOP_CLAMP;
    let rightBottom = TOP_CLAMP;
    for (const item of sorted) {
        let chosen: ColumnSide;
        if (leftBottom < rightBottom) {
            chosen = "left";
        } else if (rightBottom < leftBottom) {
            chosen = "right";
        } else {
            // Even columns: prefer the side the text leans toward.
            chosen = item.viewportX <= viewportCenterX ? "left" : "right";
        }
        side[item.id] = chosen;
        const top = Math.max(item.viewportY, chosen === "left" ? leftBottom : rightBottom);
        const nextBottom = top + item.height + MIN_SPACING;
        if (chosen === "left") leftBottom = nextBottom;
        else rightBottom = nextBottom;
    }
    return side;
}

export type ColumnLayout = {
    /** Final top position per card id, after the overhead shift. */
    adjustedY: { [id: number]: number };
    /**
     * How far positions were shifted down so the minimum Y is 0. The scroll
     * container scrolls by exactly this so the active card (or topmost card)
     * lands at its correct viewport position.
     */
    overhead: number;
    /** Total inner height needed to hold all cards. */
    maxBottom: number;
};

/**
 * Core layout algorithm for one floating column: assigns each card a top
 * position aligned to its annotation's viewport Y.
 *
 * Google Docs-style: the active card anchors at its natural text Y first.
 * Cards above it are pushed upward to avoid overlap; cards below it are
 * pushed downward. This ensures the selected card always sits next to its
 * highlighted text rather than being displaced by earlier cards.
 *
 * When no card in this column is active, a simple top-to-bottom pass keeps
 * every card at (or pushed below) its natural Y.
 */
export function layoutColumnPositions(cards: LayoutItem[], activeId: number | null): ColumnLayout {
    const sortedByPos = [...cards].sort((a, b) => a.viewportY - b.viewportY);
    const adjustedY: { [id: number]: number } = {};

    const activeIdx = activeId === null ? -1 : sortedByPos.findIndex((c) => c.id === activeId);

    if (activeIdx === -1) {
        // No active card: simple top-to-bottom pass (original behaviour)
        let lastBottom = TOP_CLAMP;
        for (const { id, viewportY, height } of sortedByPos) {
            const y = Math.max(viewportY, lastBottom, TOP_CLAMP);
            adjustedY[id] = y;
            lastBottom = y + height + MIN_SPACING;
        }
    } else {
        // Active card anchors at its natural text Y
        const activeItem = sortedByPos[activeIdx];
        const activeY = activeItem.viewportY;
        adjustedY[activeItem.id] = activeY;

        // Walk cards ABOVE the active card upward (reverse order).
        // Prefer natural Y; push up past the top edge if needed —
        // the scroll container will hide them until the user scrolls.
        {
            let ceiling = activeY - MIN_SPACING;
            for (let i = activeIdx - 1; i >= 0; i--) {
                const { id, viewportY, height } = sortedByPos[i];
                const y = Math.min(viewportY, ceiling - height);
                adjustedY[id] = y;
                ceiling = y - MIN_SPACING;
            }
        }

        // Walk cards BELOW the active card downward.
        // Prefer natural Y; push down past the bottom if needed.
        let lastBottom = activeY + activeItem.height + MIN_SPACING;
        for (let i = activeIdx + 1; i < sortedByPos.length; i++) {
            const { id, viewportY, height } = sortedByPos[i];
            const y = Math.max(viewportY, lastBottom);
            adjustedY[id] = y;
            lastBottom = y + height + MIN_SPACING;
        }
    }

    // Shift all positions so the minimum Y is 0, adding an overhead buffer so
    // cards pushed above the active card are reachable by scrolling.
    const yValues = Object.values(adjustedY);
    const minY = yValues.length ? Math.min(...yValues) : 0;
    const overhead = minY < 0 ? -minY : 0;
    for (const id of Object.keys(adjustedY) as unknown as number[]) {
        adjustedY[id] += overhead;
    }

    // Compute total inner height
    let maxBottom = 0;
    for (const { id, height } of sortedByPos) {
        maxBottom = Math.max(maxBottom, (adjustedY[id] ?? 0) + height + MIN_SPACING);
    }

    return { adjustedY, overhead, maxBottom };
}

/** Shallow equality of two side maps. */
export function sidesEqual(
    a: { [id: number]: ColumnSide },
    b: { [id: number]: ColumnSide },
): boolean {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
        if (a[k as unknown as number] !== b[k as unknown as number]) return false;
    }
    return true;
}

/** Stable signature of an annotation id set (order-independent). */
export function idSignature(ids: number[]): string {
    return [...ids].sort((a, b) => a - b).join(",");
}
