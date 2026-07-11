/**
 * annotationLayout.ts — Pure layout math for floating annotation columns.
 *
 * This package is the source of truth for both the desktop editor and public
 * read-only previews. DOM measurement stays in the host; these functions are
 * deterministic and work with either desktop numeric IDs or serialized IDs.
 */

export type AnnotationLayoutId = string | number;
export type ColumnSide = "left" | "right";

export type LayoutItem<Id extends AnnotationLayoutId = AnnotationLayoutId> = {
    id: Id;
    viewportY: number;
    height: number;
};

export type BalanceItem<Id extends AnnotationLayoutId = AnnotationLayoutId> = LayoutItem<Id> & {
    viewportX: number;
};

export const MIN_SPACING = 8;
export const TOP_CLAMP = 64;
export const COLUMN_BOTTOM_PADDING = 24;
/** Desktop's minimum useful width for a floating annotation column. */
export const MIN_ANNOTATION_COLUMN_WIDTH = 150;
/** Exact motion contract used by both desktop and public read-only columns. */
export const ANNOTATION_CARD_TOP_TRANSITION = "top 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)";

export function compareAnnotationLayoutIds(a: AnnotationLayoutId, b: AnnotationLayoutId): number {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
}

export function canFloatAnnotationColumn(geometry: { width: number }): boolean {
    return geometry.width >= MIN_ANNOTATION_COLUMN_WIDTH;
}

/** Ensure a column can physically scroll by its computed layout overhead. */
export function columnInnerHeight(
    maxBottom: number,
    viewportHeight: number,
    overhead: number,
): number {
    return Math.max(maxBottom + COLUMN_BOTTOM_PADDING, viewportHeight + overhead);
}

export type LayoutValueMap<Id extends AnnotationLayoutId, Value> = Record<Id, Value>;

export function balanceColumns<Id extends AnnotationLayoutId>(
    items: BalanceItem<Id>[],
    viewportCenterX: number,
): LayoutValueMap<Id, ColumnSide> {
    const sorted = [...items].sort((a, b) =>
        a.viewportY !== b.viewportY
            ? a.viewportY - b.viewportY
            : compareAnnotationLayoutIds(a.id, b.id),
    );
    const side = {} as LayoutValueMap<Id, ColumnSide>;
    let leftBottom = TOP_CLAMP;
    let rightBottom = TOP_CLAMP;

    for (const item of sorted) {
        let chosen: ColumnSide;
        if (leftBottom < rightBottom) {
            chosen = "left";
        } else if (rightBottom < leftBottom) {
            chosen = "right";
        } else {
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

export type ColumnLayout<Id extends AnnotationLayoutId = AnnotationLayoutId> = {
    adjustedY: LayoutValueMap<Id, number>;
    overhead: number;
    maxBottom: number;
};

/**
 * Lay out one floating column. The active card is placed at its text anchor;
 * cards before it pack upward and cards after it pack downward. Negative
 * positions are shifted into a scrollable overhead region.
 */
export function layoutColumnPositions<Id extends AnnotationLayoutId>(
    cards: LayoutItem<Id>[],
    activeId: Id | null,
): ColumnLayout<Id> {
    const sortedByPos = [...cards].sort((a, b) =>
        a.viewportY !== b.viewportY
            ? a.viewportY - b.viewportY
            : compareAnnotationLayoutIds(a.id, b.id),
    );
    const adjustedY = {} as LayoutValueMap<Id, number>;
    const activeIdx =
        activeId === null ? -1 : sortedByPos.findIndex((card) => card.id === activeId);

    if (activeIdx === -1) {
        let lastBottom = TOP_CLAMP;
        for (const { id, viewportY, height } of sortedByPos) {
            const y = Math.max(viewportY, lastBottom, TOP_CLAMP);
            adjustedY[id] = y;
            lastBottom = y + height + MIN_SPACING;
        }
    } else {
        const activeItem = sortedByPos[activeIdx];
        const activeY = activeItem.viewportY;
        adjustedY[activeItem.id] = activeY;

        let ceiling = activeY - MIN_SPACING;
        for (let i = activeIdx - 1; i >= 0; i--) {
            const { id, viewportY, height } = sortedByPos[i];
            const y = Math.min(viewportY, ceiling - height);
            adjustedY[id] = y;
            ceiling = y - MIN_SPACING;
        }

        let lastBottom = activeY + activeItem.height + MIN_SPACING;
        for (let i = activeIdx + 1; i < sortedByPos.length; i++) {
            const { id, viewportY, height } = sortedByPos[i];
            const y = Math.max(viewportY, lastBottom);
            adjustedY[id] = y;
            lastBottom = y + height + MIN_SPACING;
        }
    }

    const yValues = sortedByPos.map(({ id }) => adjustedY[id] ?? 0);
    const minY = yValues.length ? Math.min(...yValues) : 0;
    const overhead = minY < 0 ? -minY : 0;
    if (overhead > 0) {
        for (const { id } of sortedByPos) adjustedY[id] = (adjustedY[id] ?? 0) + overhead;
    }

    let maxBottom = 0;
    for (const { id, height } of sortedByPos) {
        maxBottom = Math.max(maxBottom, (adjustedY[id] ?? 0) + height + MIN_SPACING);
    }

    return { adjustedY, overhead, maxBottom };
}

export function sidesEqual<Id extends AnnotationLayoutId>(
    a: Partial<LayoutValueMap<Id, ColumnSide>>,
    b: Partial<LayoutValueMap<Id, ColumnSide>>,
): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => a[key as Id] === b[key as Id]);
}

export function idSignature(ids: AnnotationLayoutId[]): string {
    return [...ids].map(String).sort().join(",");
}
