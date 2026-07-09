import { randomFillSync } from "node:crypto";
import { beforeAll } from "vitest";

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
});
