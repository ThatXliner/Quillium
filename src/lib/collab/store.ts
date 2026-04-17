/**
 * store.ts -- Svelte store for collab connection state.
 *
 * Used by UI components (StatusBar, GoLiveButton) to reflect the current
 * collab session state.
 */
import { writable } from "svelte/store";
import type { CollabState } from "./types";

export const collabState = writable<CollabState>("disconnected");
