import { readFileSync } from "node:fs";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const host = process.env.TAURI_DEV_HOST;
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// https://vitejs.dev/config/
export default defineConfig(async ({ command, mode }) => {
    // Supabase config is baked in at build time; a production build without it
    // ships with auth permanently broken ("Supabase not configured") and the gap
    // only surfaces at first sign-in, possibly after a TestFlight round-trip.
    // Fail fast instead. Locally the values come from packages/desktop/.env
    // (loaded by Vite itself); in CI they come from GitHub repo vars.
    if (command === "build" && !process.env.QUILLIUM_ALLOW_MISSING_SUPABASE_ENV) {
        const env = loadEnv(mode, process.cwd(), "PUBLIC_");
        const missing = ["PUBLIC_SUPABASE_URL", "PUBLIC_SUPABASE_PUBLISHABLE_KEY"].filter(
            (key) => !env[key],
        );
        if (missing.length > 0) {
            throw new Error(
                `Missing ${missing.join(", ")} — this build would ship with auth disabled. Copy packages/desktop/.env.example to packages/desktop/.env and fill it in, or set QUILLIUM_ALLOW_MISSING_SUPABASE_ENV=1 to build anyway.`,
            );
        }
    }

    return {
        plugins: [sveltekit(), tailwindcss()],
        define: {
            __APP_VERSION__: JSON.stringify(pkg.version),
        },
        resolve: {
            dedupe: ["@codemirror/state", "@codemirror/view"],
        },
        // Separate cache dirs when running multiple instances to avoid chunk hash conflicts
        cacheDir: process.env.QUILLIUM_DEV_PORT
            ? `node_modules/.vite-${process.env.QUILLIUM_DEV_PORT}`
            : "node_modules/.vite",

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
    };
});
