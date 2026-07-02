/**
 * +layout.ts — SvelteKit routing configuration for Tauri.
 *
 * Tauri embeds the frontend as static files (no Node.js server),
 * so we disable SSR and enable prerendering via the static adapter.
 * This ensures every route is compiled to plain HTML/JS at build
 * time, which Tauri's webview can load directly from disk.
 *
 * See: https://v2.tauri.app/start/frontend/sveltekit/
 */
export const prerender = true;
export const ssr = false;
