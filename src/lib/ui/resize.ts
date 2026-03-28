import { appSettings, persistSettings } from "$lib/settings.svelte";

export type ResizeOptions = {
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    defaultWidth: number;
    defaultHeight: number;
    symmetric: boolean;
    persistKey: string;
};

type Handle = "right" | "left" | "top" | "bottom" | "corner-se" | "corner-sw" | "corner-ne" | "corner-nw";

export function useResize(node: HTMLElement, options: ResizeOptions) {
    let currentWidth = options.defaultWidth;
    let currentHeight = options.defaultHeight;

    const widthKey = (options.persistKey + "Width") as keyof typeof appSettings;
    const heightKey = (options.persistKey + "Height") as keyof typeof appSettings;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = appSettings as any;
    if (settings.persistResizeSizes) {
        const pw = settings[widthKey] as number | undefined;
        const ph = settings[heightKey] as number | undefined;
        if (pw != null) currentWidth = pw;
        if (ph != null) currentHeight = ph;
    }

    applySize(currentWidth, currentHeight);

    const handles: HTMLDivElement[] = [];

    function makeHandle(type: Handle): HTMLDivElement {
        const el = document.createElement("div");
        el.className = `resize-handle resize-handle-${type}`;
        el.setAttribute("role", "separator");
        node.appendChild(el);
        handles.push(el);
        return el;
    }

    if (options.symmetric) {
        makeHandle("right"); makeHandle("left"); makeHandle("top"); makeHandle("bottom");
        makeHandle("corner-se"); makeHandle("corner-sw"); makeHandle("corner-ne"); makeHandle("corner-nw");
    } else {
        makeHandle("right"); makeHandle("bottom"); makeHandle("corner-se");
    }

    let activeHandle: Handle | null = null;
    let startX = 0, startY = 0, startWidth = 0, startHeight = 0;

    function onMouseDown(e: MouseEvent, handle: Handle) {
        e.preventDefault(); e.stopPropagation();
        activeHandle = handle;
        startX = e.clientX; startY = e.clientY;
        startWidth = currentWidth; startHeight = currentHeight;
        document.body.style.userSelect = "none";
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    }

    function onMouseMove(e: MouseEvent) {
        if (!activeHandle) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const mult = options.symmetric ? 2 : 1;

        let newWidth = currentWidth;
        let newHeight = currentHeight;

        if (activeHandle === "right" || activeHandle === "corner-se" || activeHandle === "corner-ne")
            newWidth = clamp(startWidth + dx * mult, options.minWidth, options.maxWidth);
        if (activeHandle === "left" || activeHandle === "corner-sw" || activeHandle === "corner-nw")
            newWidth = clamp(startWidth - dx * mult, options.minWidth, options.maxWidth);
        if (activeHandle === "bottom" || activeHandle === "corner-se" || activeHandle === "corner-sw")
            newHeight = clamp(startHeight + dy * mult, options.minHeight, options.maxHeight);
        if (activeHandle === "top" || activeHandle === "corner-ne" || activeHandle === "corner-nw")
            newHeight = clamp(startHeight - dy * mult, options.minHeight, options.maxHeight);

        currentWidth = newWidth; currentHeight = newHeight;
        applySize(currentWidth, currentHeight);
        dispatch(false);
    }

    function onMouseUp() {
        activeHandle = null;
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        if (settings.persistResizeSizes) {
            settings[widthKey] = currentWidth;
            settings[heightKey] = currentHeight;
            persistSettings();
        }
    }

    handles.forEach((el) => {
        const type = el.className.replace("resize-handle resize-handle-", "") as Handle;
        el.addEventListener("mousedown", (e) => onMouseDown(e, type));
    });

    function applySize(w: number, h: number) {
        node.style.width = `${w}px`;
        node.style.height = `${h}px`;
    }

    function dispatch(isDefault: boolean) {
        node.dispatchEvent(new CustomEvent("resizechange", {
            detail: { width: currentWidth, height: currentHeight, isDefault },
            bubbles: false,
        }));
    }

    function reset() {
        currentWidth = options.defaultWidth;
        currentHeight = options.defaultHeight;
        applySize(currentWidth, currentHeight);
        if (settings.persistResizeSizes) {
            settings[widthKey] = undefined;
            settings[heightKey] = undefined;
            persistSettings();
        }
        dispatch(true);
    }

    function destroy() {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        handles.forEach((el) => el.remove());
        document.body.style.userSelect = "";
    }

    return { reset, destroy, update: (_opts: ResizeOptions) => {} };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
