/**
 * annotationColumnDom.ts — Shared DOM lifecycle for floating annotation columns.
 *
 * Desktop supplies the card rendering and (optionally) two column assignments;
 * Web Preview supplies a single read-only column. Both use this controller for
 * card registration, measurement, resize/scroll scheduling, position writes,
 * scroll overhead, and container geometry.
 */
import {
    type AnnotationLayoutId,
    type LayoutItem,
    columnInnerHeight,
    layoutColumnPositions,
} from "./annotationLayout";

export type AnnotationColumnGeometry = { left: number; width: number; topClamp?: number };

export type ApplyAnnotationColumnOptions<Id extends AnnotationLayoutId> = {
    container: HTMLElement | undefined;
    inner?: HTMLElement | null;
    items: Omit<LayoutItem<Id>, "height">[];
    activeId: Id | null;
    geometry: AnnotationColumnGeometry;
};

export class AnnotationColumnDomController<Id extends AnnotationLayoutId> {
    private readonly elements = new Map<Id, HTMLDivElement>();
    private resizeObserver: ResizeObserver | undefined;
    private timeout: ReturnType<typeof setTimeout> | undefined;
    private eventTargets = new Set<EventTarget>();

    public constructor(private readonly updateLayout: () => void) {}

    public mountCard(node: HTMLDivElement, id: Id) {
        let currentId = id;
        this.elements.set(currentId, node);
        this.observeCards();
        this.schedule();
        return {
            update: (nextId: Id) => {
                if (this.elements.get(currentId) === node) this.elements.delete(currentId);
                currentId = nextId;
                this.elements.set(currentId, node);
                this.observeCards();
                this.schedule();
            },
            destroy: () => {
                if (this.elements.get(currentId) === node) this.elements.delete(currentId);
                this.observeCards();
                this.schedule();
            },
        };
    }

    public getCardElement(id: Id): HTMLDivElement | undefined {
        return this.elements.get(id);
    }

    public getCardHeight(id: Id): number {
        return this.elements.get(id)?.offsetHeight || 80;
    }

    public observeCards(): void {
        if (typeof ResizeObserver === "undefined") return;
        this.resizeObserver?.disconnect();
        this.resizeObserver = new ResizeObserver(() => this.schedule());
        for (const element of this.elements.values()) this.resizeObserver.observe(element);
    }

    public setEventTargets(targets: readonly EventTarget[]): void {
        for (const target of this.eventTargets) target.removeEventListener("scroll", this.schedule);
        this.eventTargets = new Set(targets);
        for (const target of this.eventTargets) target.addEventListener("scroll", this.schedule);
    }

    public schedule = (): void => {
        if (this.timeout !== undefined) clearTimeout(this.timeout);
        this.timeout = setTimeout(this.updateLayout, 16);
    };

    public apply(options: ApplyAnnotationColumnOptions<Id>): void {
        const { container, items, activeId, geometry } = options;
        if (!container) return;
        const inner =
            options.inner ?? container.querySelector<HTMLElement>(".annotation-scroll-inner");
        container.style.left = `${geometry.left}px`;
        container.style.width = `${Math.max(0, geometry.width)}px`;

        const measured = items.map((item) => ({ ...item, height: this.getCardHeight(item.id) }));
        const active =
            activeId !== null && items.some(({ id }) => id === activeId) ? activeId : null;
        const { adjustedY, overhead, maxBottom } = layoutColumnPositions(
            measured,
            active,
            geometry.topClamp,
        );

        if (inner) {
            inner.style.height = `${columnInnerHeight(maxBottom, container.clientHeight, overhead)}px`;
        }
        for (const { id } of items) {
            const element = this.elements.get(id);
            if (!element) continue;
            element.style.top = `${adjustedY[id] ?? 0}px`;
            element.style.left = "0px";
        }

        // `overhead` only accounts for cards packed above the visible top
        // (the boundary/UI-chrome case). Stacking can just as easily push the
        // active card's own top and bottom below the container's visible
        // window (e.g. several tall cards packed after it). Google
        // Docs-style behavior never lets stacking order hide the active
        // comment, so widen the scroll target to keep the active card's full
        // extent on screen, falling back to `overhead` when there is none.
        let targetScrollTop = overhead;
        const activeMeasured =
            active !== null ? measured.find(({ id }) => id === active) : undefined;
        if (active !== null && activeMeasured) {
            const activeTop = adjustedY[active] ?? 0;
            const activeBottom = activeTop + activeMeasured.height;
            const viewportHeight = container.clientHeight;
            if (activeBottom > targetScrollTop + viewportHeight) {
                targetScrollTop = activeBottom - viewportHeight;
            }
            if (activeTop < targetScrollTop) {
                targetScrollTop = activeTop;
            }
        }
        if (Math.abs(container.scrollTop - targetScrollTop) > 1) {
            container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
        }
    }

    public destroy(): void {
        if (this.timeout !== undefined) clearTimeout(this.timeout);
        this.resizeObserver?.disconnect();
        for (const target of this.eventTargets) target.removeEventListener("scroll", this.schedule);
        this.eventTargets.clear();
    }
}
