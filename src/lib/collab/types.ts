/**
 * types.ts -- Collab-related types.
 *
 * Per D-52: Socket lifecycle is per-document, so CollabSession tracks the active document.
 * Per D-50: clientID is the user's Supabase user ID (for per-user undo).
 */

/** Active collab session state */
export type CollabSession = {
    docId: string;
    version: number;
    clientID: string;
    isOwner: boolean;
};

/** Connection state for UI display */
export type CollabState = "disconnected" | "connecting" | "connected" | "error";
