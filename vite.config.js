import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import webfontDownload from "vite-plugin-webfont-dl";

const host = process.env.TAURI_DEV_HOST;
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// https://vitejs.dev/config/
export default defineConfig(async () => ({
    plugins: [
        sveltekit(),
        tailwindcss(),
        webfontDownload([
            // Serifs — literary / classic writing
            "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,700;1,400&display=swap",
            "https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap",
            "https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&display=swap",
            // Sans
            "https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,400;0,700;1,400&display=swap",
            // Typewriter
            "https://fonts.googleapis.com/css2?family=Special+Elite&display=swap",
            "https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400&display=swap",
            // Handwriting
            "https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&display=swap",
            "https://fonts.googleapis.com/css2?family=Kalam:wght@300;400;700&display=swap",
        ]),
    ],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
        dedupe: ["@codemirror/state", "@codemirror/view"],
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host
            ? {
                  protocol: "ws",
                  host,
                  port: 1421,
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
