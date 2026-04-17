/**
 * store.ts -- Svelte store for collab connection state.
 *
 * Used by UI components (StatusBar, GoLiveButton) to reflect the current
 * collab session state.
 */
import { writable } from "svelte/store";
import type { CollabState } from "./types";

export const collabState = writable<CollabState>("disconnected");

/**
 * Incremented when the owner ends the session (ownerLeft relay event).
 * GoLiveButton subscribes with $effect to reset its isLive state.
 */
export const ownerLeftSignal = writable(0);
