import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationColumnDomController } from "../src/layout/annotationColumnDom";

describe("AnnotationColumnDomController", () => {
    afterEach(() => vi.useRealTimers());

    it("shares measurement, positioning, overhead, and geometry writes", () => {
        vi.useFakeTimers();
        const update = vi.fn();
        const controller = new AnnotationColumnDomController<number>(update);
        const first = { offsetHeight: 100, style: {} } as HTMLDivElement;
        const second = { offsetHeight: 100, style: {} } as HTMLDivElement;
        const inner = { style: {} } as HTMLElement;
        const scrollTo = vi.fn();
        const container = {
            style: {},
            clientHeight: 720,
            scrollTop: 0,
            scrollTo,
            querySelector: () => inner,
        } as unknown as HTMLElement;

        controller.mountCard(first, 1);
        controller.mountCard(second, 2);
        vi.advanceTimersByTime(16);
        expect(update).toHaveBeenCalledOnce();

        controller.apply({
            container,
            items: [
                { id: 1, viewportY: 10 },
                { id: 2, viewportY: 20 },
            ],
            activeId: 2,
            geometry: { left: 940, width: 280 },
        });

        expect(container.style.left).toBe("940px");
        expect(container.style.width).toBe("280px");
        expect(first.style.top).toBe("0px");
        expect(second.style.top).toBe("108px");
        expect(inner.style.height).toBe("808px");
        expect(scrollTo).toHaveBeenCalledWith({ top: 88, behavior: "smooth" });
        controller.destroy();
    });

    it("scrolls to reveal the active card when stacking pushes it below the visible window", () => {
        vi.useFakeTimers();
        const update = vi.fn();
        const controller = new AnnotationColumnDomController<number>(update);
        // Four tall cards (e.g. revisions) stacked above a short active card
        // (e.g. a comment). The active card's own natural position is well
        // within the viewport, but the stack above it pushes it far enough
        // down that it falls below the container's visible window.
        const cards = [1, 2, 3, 4, 5].map(
            () => ({ offsetHeight: 150, style: {} }) as HTMLDivElement,
        );
        const inner = { style: {} } as HTMLElement;
        const scrollTo = vi.fn();
        const container = {
            style: {},
            clientHeight: 400,
            scrollTop: 0,
            scrollTo,
            querySelector: () => inner,
        } as unknown as HTMLElement;

        cards.forEach((card, i) => controller.mountCard(card, i + 1));
        vi.advanceTimersByTime(16);

        controller.apply({
            container,
            items: [1, 2, 3, 4, 5].map((id) => ({ id, viewportY: 500 })),
            activeId: 5,
            geometry: { left: 940, width: 280 },
        });

        // Active card (id 5) is last in the stack: top = 4*(150+8) = 632,
        // bottom = 782. That's beyond the 400px-tall viewport, so the
        // controller must scroll down to bring its full extent into view.
        expect(scrollTo).toHaveBeenCalledWith({ top: 782 - 400, behavior: "smooth" });
        controller.destroy();
    });
});
