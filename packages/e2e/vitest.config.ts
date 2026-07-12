import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Cross-package E2E runner. Needs the Svelte plugin to import @quillium/share's
// `.svelte` components, and the browser resolve condition so Svelte 5 mounts its
// client build (mirrors packages/desktop/vitest.config.ts).
export default defineConfig({
    plugins: [svelte()],
    resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
    test: {
        environment: "jsdom",
        include: ["tests/**/*.test.ts"],
        setupFiles: ["tests/setup.ts"],
    },
});
