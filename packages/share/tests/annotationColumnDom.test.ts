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
});
