/**
 * store.svelte.ts — Svelte 5 rune store for the debug panel.
 *
 * Uses a writable rune so any component can toggle the panel
 * open/closed without importing from stores.ts (which has CodeMirror
 * dependencies that complicate tree-shaking in production).
 */

import { writable } from "svelte/store";

/** Whether the debug panel overlay is currently open. */
export const debugPanelActive = writable(false);
