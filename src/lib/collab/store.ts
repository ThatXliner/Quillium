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

/**
 * Count of pending local updates not yet confirmed by relay.
 * Used by StatusBar to show syncing state and by reconnection logic.
 */
export const pendingUpdatesCount = writable(0);

/**
 * Current reconnection attempt number (0 = not reconnecting).
 * Reset to 0 on successful reconnect or manual disconnect.
 */
export const reconnectAttempt = writable(0);
