import { randomFillSync } from "node:crypto";
import { cleanup } from "@testing-library/svelte";
import { afterEach, beforeAll } from "vitest";

afterEach(() => cleanup());

// jsdom ships without WebCrypto; CodeMirror / dependencies may reach for
// crypto.getRandomValues. Mirrors packages/desktop/tests/setup.ts.
beforeAll(() => {
    if (!globalThis.crypto?.getRandomValues) {
        Object.defineProperty(globalThis, "crypto", {
            value: { getRandomValues: (buffer: Uint8Array) => randomFillSync(buffer) },
        });
    }

    // jsdom has no Web Animations API; Svelte's fade/fly transitions call
    // element.animate() on mount. A no-op stub is enough for these tests.
    if (typeof Element !== "undefined" && !Element.prototype.animate) {
        Element.prototype.animate = () =>
            ({
                cancel() {},
                finish() {},
                play() {},
                pause() {},
                reverse() {},
                addEventListener() {},
                removeEventListener() {},
                onfinish: null,
                oncancel: null,
                currentTime: 0,
                playState: "finished",
                finished: Promise.resolve(),
            }) as unknown as Animation;
    }

    if (!window.matchMedia) {
        window.matchMedia = (query: string) =>
            ({
                matches: true,
                media: query,
                onchange: null,
                addListener() {},
                removeListener() {},
                addEventListener() {},
                removeEventListener() {},
                dispatchEvent: () => false,
            }) as MediaQueryList;
    }

    if (!globalThis.ResizeObserver) {
        globalThis.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    }

    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = () => {};
    }

    if (!HTMLElement.prototype.scrollTo) {
        HTMLElement.prototype.scrollTo = () => {};
    }
});
