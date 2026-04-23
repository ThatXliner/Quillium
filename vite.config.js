import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// https://vitejs.dev/config/
export default defineConfig(async () => ({
    plugins: [sveltekit(), tailwindcss()],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
        dedupe: ["@codemirror/state", "@codemirror/view"],
    },
    // Separate cache dirs when running multiple instances to avoid chunk hash conflicts
    cacheDir: process.env.QUILLIUM_DEV_PORT ? `node_modules/.vite-${process.env.QUILLIUM_DEV_PORT}` : "node_modules/.vite",

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port — can be overridden via QUILLIUM_DEV_PORT for running multiple instances
    server: {
        port: Number(process.env.QUILLIUM_DEV_PORT) || 1420,
        strictPort: true,
        host: host || false,
        hmr: host
            ? {
                  protocol: "ws",
                  host,
                  port: (Number(process.env.QUILLIUM_DEV_PORT) || 1420) + 1,
              }
            : undefined,
        watch: {
            // 3. tell vite to ignore watching `src-tauri`
            ignored: ["**/src-tauri/**"],
        },
    },
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./tests/setup.ts"],
        include: ["tests/**/*.{test,spec}.{js,ts}"],
        exclude: ["src-tauri/**", "node_modules/**"],
    },
}));
