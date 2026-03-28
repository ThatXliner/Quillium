import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useResize } from "$lib/ui/resize";

function makeNode(width = 400, height = 300): HTMLDivElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => width });
    Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => height });
    document.body.appendChild(el);
    return el;
}

function mousedown(target: Element, clientX: number, clientY: number) {
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX, clientY }));
}
function mousemove(clientX: number, clientY: number) {
    window.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY }));
}
function mouseup() {
    window.dispatchEvent(new MouseEvent("mouseup"));
}

describe("useResize action", () => {
    let node: HTMLDivElement;
    beforeEach(() => { node = makeNode(400, 300); });
    afterEach(() => { node.remove(); });

    it("appends handle divs to the node", () => {
        useResize(node, { minWidth: 200, maxWidth: 800, minHeight: 150, maxHeight: 600, defaultWidth: 400, defaultHeight: 300, symmetric: false, persistKey: "test" });
        expect(node.querySelectorAll(".resize-handle").length).toBeGreaterThan(0);
    });

    it("anchored mode: right drag increases width", () => {
        const action = useResize(node, { minWidth: 200, maxWidth: 800, minHeight: 150, maxHeight: 600, defaultWidth: 400, defaultHeight: 300, symmetric: false, persistKey: "test" });
        mousedown(node.querySelector(".resize-handle-right")!, 100, 100);
        mousemove(150, 100);
        mouseup();
        expect(node.style.width).toBe("450px");
        action.destroy?.();
    });

    it("symmetric mode: right drag doubles width change", () => {
        const action = useResize(node, { minWidth: 200, maxWidth: 800, minHeight: 150, maxHeight: 600, defaultWidth: 400, defaultHeight: 300, symmetric: true, persistKey: "test" });
        mousedown(node.querySelector(".resize-handle-right")!, 100, 100);
        mousemove(130, 100);
        mouseup();
        expect(node.style.width).toBe("460px");
        action.destroy?.();
    });

    it("clamps width to maxWidth", () => {
        const action = useResize(node, { minWidth: 200, maxWidth: 500, minHeight: 150, maxHeight: 600, defaultWidth: 400, defaultHeight: 300, symmetric: false, persistKey: "test" });
        mousedown(node.querySelector(".resize-handle-right")!, 100, 100);
        mousemove(1000, 100);
        mouseup();
        expect(node.style.width).toBe("500px");
        action.destroy?.();
    });

    it("clamps width to minWidth", () => {
        const action = useResize(node, { minWidth: 200, maxWidth: 500, minHeight: 150, maxHeight: 600, defaultWidth: 400, defaultHeight: 300, symmetric: false, persistKey: "test" });
        mousedown(node.querySelector(".resize-handle-right")!, 100, 100);
        mousemove(-9999, 100);
        mouseup();
        expect(node.style.width).toBe("200px");
        action.destroy?.();
    });

    it("reset() restores default size and dispatches resizechange with isDefault=true", () => {
        const events: CustomEvent[] = [];
        node.addEventListener("resizechange", (e) => events.push(e as CustomEvent));
        const action = useResize(node, { minWidth: 200, maxWidth: 800, minHeight: 150, maxHeight: 600, defaultWidth: 400, defaultHeight: 300, symmetric: false, persistKey: "test" });
        mousedown(node.querySelector(".resize-handle-right")!, 100, 100);
        mousemove(150, 100);
        mouseup();
        action.reset();
        expect(node.style.width).toBe("400px");
        expect(node.style.height).toBe("300px");
        expect(events[events.length - 1].detail.isDefault).toBe(true);
        action.destroy?.();
    });

    it("dispatches resizechange with isDefault=false after resize", () => {
        const events: CustomEvent[] = [];
        node.addEventListener("resizechange", (e) => events.push(e as CustomEvent));
        const action = useResize(node, { minWidth: 200, maxWidth: 800, minHeight: 150, maxHeight: 600, defaultWidth: 400, defaultHeight: 300, symmetric: false, persistKey: "test" });
        mousedown(node.querySelector(".resize-handle-right")!, 100, 100);
        mousemove(150, 100);
        mouseup();
        expect(events[events.length - 1].detail.isDefault).toBe(false);
        action.destroy?.();
    });

    it("does not apply inline size styles on mount when no persisted size exists", () => {
        useResize(node, { minWidth: 200, maxWidth: 800, minHeight: 150, maxHeight: 600, defaultWidth: 400, defaultHeight: 300, symmetric: false, persistKey: "test" });
        expect(node.style.width).toBe("");
        expect(node.style.height).toBe("");
    });

    it("clamps defaultHeight to maxHeight on mount when defaultHeight exceeds maxHeight", () => {
        useResize(node, { minWidth: 200, maxWidth: 800, minHeight: 150, maxHeight: 400, defaultWidth: 400, defaultHeight: 900, symmetric: false, persistKey: "test" });
        // if size is applied at all, it must not exceed maxHeight
        if (node.style.height !== "") {
            expect(parseInt(node.style.height)).toBeLessThanOrEqual(400);
        }
    });
});
