/**
 * store.ts -- Svelte store for collab connection state.
 *
 * Used by UI components (StatusBar, GoLiveButton) to reflect the current
 * collab session state.
 */
import { writable } from "svelte/store";
import type { CollabState, CollabSession } from "./types";

export const collabState = writable<CollabState>("disconnected");

/**
 * Active collab session (null when not in collab mode).
 * Plan 8.5c-01: Populated by enableCollab with undoManager + mainIdMap fields.
 */
export const collabSession = writable<CollabSession | null>(null);

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

/**
 * True when this client joined someone else's live session (not the owner).
 * In Live Room mode, joiners are ephemeral viewers -- they should NOT persist
 * anything to the local event log, since the document belongs to the owner.
 * Set true on join, reset to false on disconnect.
 */
export const isCollabJoiner = writable(false);

/**
 * Prior view state for joiner to restore on disconnect (D-103).
 * Captured when joiner enters a room, read when joiner leaves or is kicked.
 * Contains the draftId and view type from before joining.
 */
export interface JoinerPriorView {
    draftId: string | null;
    viewType: "editor" | "library";
}

export const joinerPriorView = writable<JoinerPriorView | null>(null);
