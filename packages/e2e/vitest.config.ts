import { createRequire } from "node:module";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

// Cross-package E2E runner. Needs the Svelte plugin to import @quillium/share's
// `.svelte` components, and the browser resolve condition so Svelte 5 mounts its
// client build (mirrors packages/desktop/vitest.config.ts).
export default defineConfig({
    plugins: [svelte()],
    resolve: process.env.VITEST
        ? {
              // Svelte needs its browser condition in jsdom, but the relay contract
              // must retain ws's Node server entry instead of its browser shim.
              alias: {
                  ws: require.resolve("ws"),
              },
              conditions: ["browser"],
          }
        : undefined,
    test: {
        environment: "jsdom",
        include: ["tests/**/*.test.ts"],
        setupFiles: ["tests/setup.ts"],
    },
});
