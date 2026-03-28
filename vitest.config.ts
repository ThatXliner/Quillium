import { sveltekit } from "@sveltejs/kit/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [sveltekit(), svelteTesting()],
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["tests/setup.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "clover", "lcov"],
        },
    },
});
