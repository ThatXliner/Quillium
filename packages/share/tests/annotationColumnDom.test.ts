import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationColumnDomController } from "../src/layout/annotationColumnDom";

const originalResizeObserver = globalThis.ResizeObserver;

class FakeResizeObserver {
    public static instances: FakeResizeObserver[] = [];

    public readonly observe = vi.fn();
    public readonly unobserve = vi.fn();
    public readonly disconnect = vi.fn();

    public constructor(public readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this);
    }
}

function card(): HTMLDivElement {
    return { offsetHeight: 80, style: {} } as HTMLDivElement;
}

describe("AnnotationColumnDomController", () => {
    beforeEach(() => {
        FakeResizeObserver.instances = [];
        globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
        vi.useRealTimers();
        if (originalResizeObserver) {
            globalThis.ResizeObserver = originalResizeObserver;
        } else {
            Reflect.deleteProperty(globalThis, "ResizeObserver");
        }
    });

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

    it("updates layout while preserving the current scroll position when requested", () => {
        vi.useFakeTimers();
        const controller = new AnnotationColumnDomController<number>(vi.fn());
        const first = { offsetHeight: 100, style: {} } as HTMLDivElement;
        const inner = { style: {} } as HTMLElement;
        const scrollTo = vi.fn();
        const container = {
            style: {},
            clientHeight: 400,
            scrollTop: 120,
            scrollTo,
            querySelector: () => inner,
        } as unknown as HTMLElement;
        controller.mountCard(first, 1);

        controller.apply({
            container,
            inner,
            items: [{ id: 1, viewportY: 20 }],
            activeId: null,
            geometry: { left: 940, width: 280 },
            preserveScroll: true,
        });

        expect(first.style.top).toBe("64px");
        expect(inner.style.height).toBe("400px");
        expect(container.scrollTop).toBe(120);
        expect(scrollTo).not.toHaveBeenCalled();
        controller.destroy();
    });

    it("uses one observer and observes each of 1000 mounted cards once", () => {
        vi.useFakeTimers();
        const controller = new AnnotationColumnDomController<number>(vi.fn());

        for (let id = 0; id < 1000; id++) controller.mountCard(card(), id);

        expect(FakeResizeObserver.instances).toHaveLength(1);
        expect(FakeResizeObserver.instances[0].observe).toHaveBeenCalledTimes(1000);
        controller.destroy();
    });

    it("keeps observer registration stable across card updates and replacements", () => {
        vi.useFakeTimers();
        const update = vi.fn();
        const controller = new AnnotationColumnDomController<number>(update);
        const first = card();
        const second = card();
        const third = card();
        const mountedFirst = controller.mountCard(first, 1);
        const mountedSecond = controller.mountCard(second, 2);
        controller.mountCard(third, 3);
        const observer = FakeResizeObserver.instances[0];

        mountedFirst.update(1);
        mountedSecond.update(4);

        expect(observer.observe).toHaveBeenCalledTimes(3);
        expect(observer.observe.mock.calls.some(([element]) => element === third)).toBe(true);

        const replacement = card();
        const mountedReplacement = controller.mountCard(replacement, 4);
        expect(observer.observe).toHaveBeenCalledTimes(4);
        expect(observer.unobserve.mock.calls.some(([element]) => element === second)).toBe(true);

        mountedSecond.destroy();
        expect(observer.unobserve.mock.calls.some(([element]) => element === replacement)).toBe(
            false,
        );
        expect(controller.getCardElement(4)).toBe(replacement);

        mountedReplacement.destroy();
        expect(observer.unobserve.mock.calls.some(([element]) => element === replacement)).toBe(
            true,
        );
        controller.destroy();
    });

    it("disconnects the single observer during controller teardown", () => {
        vi.useFakeTimers();
        const controller = new AnnotationColumnDomController<number>(vi.fn());
        controller.mountCard(card(), 1);
        const observer = FakeResizeObserver.instances[0];

        controller.destroy();

        expect(observer.disconnect).toHaveBeenCalledOnce();
    });

    it("does not create an observer when ResizeObserver is unavailable", () => {
        vi.useFakeTimers();
        Reflect.deleteProperty(globalThis, "ResizeObserver");
        const controller = new AnnotationColumnDomController<number>(vi.fn());

        controller.mountCard(card(), 1);

        expect(FakeResizeObserver.instances).toHaveLength(0);
        controller.destroy();
    });
});
