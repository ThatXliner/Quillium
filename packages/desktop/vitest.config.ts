import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [sveltekit()],
    // Svelte 5 ships separate client/server builds; component tests must
    // mount the client build, which only resolves under the browser condition.
    resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
    test: {
        exclude: [".worktrees/**", "node_modules/**"],
        environment: "jsdom",
        setupFiles: ["tests/setup.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "clover", "lcov"],
        },
    },
});
