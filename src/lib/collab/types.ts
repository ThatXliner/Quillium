/**
 * types.ts -- Collab-related types.
 *
 * Per D-70: Clean migration to Yjs -- removed OT-specific types.
 * Per D-72: Yjs provider and awareness types.
 */
import type * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";

/** Active collab session state (Yjs-based) */
export type CollabSession = {
    docId: string;
    clientID: string;
    isOwner: boolean;
    ydoc: Y.Doc;
    provider: WebsocketProvider;
    awareness: Awareness;
};

/** Connection state for UI display */
export type CollabState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "syncing" // Connected but syncing initial state
    | "reconnecting" // Lost connection, attempting to reconnect
    | "error";

/** Awareness user state schema */
export interface AwarenessUserState {
    name: string;
    color: string;
    colorLight: string;
}

/** Awareness cursor state schema */
export interface AwarenessCursorState {
    anchor: number;
    head: number;
}
