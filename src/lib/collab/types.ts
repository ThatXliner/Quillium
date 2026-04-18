/**
 * types.ts -- Collab-related types.
 *
 * Per D-70: Clean migration to Yjs -- removed OT-specific types.
 * Per D-72: Yjs provider and awareness types.
 */
import type * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";

/** Yjs-stored annotation format for collaborative sync.
 * Uses RelativePosition for anchoring (survives concurrent edits).
 * Thread/versions stored as JSON strings to avoid Yjs bug #642 with nested Y.Arrays.
 * ID is string (client-prefixed) to prevent collisions in collab context.
 */
export interface YjsAnnotation {
    id: string; // Client ID prefixed for uniqueness
    _type: "comment" | "suggestion" | "revision";
    startPos: Uint8Array; // Encoded RelativePosition
    endPos: Uint8Array; // Encoded RelativePosition
    thread: string; // JSON-serialized Thread
    // Suggestion-specific
    replacements?: string; // JSON for SuggestionReplacement[]
    author?: string;
    // Revision-specific
    versions?: string; // JSON for VersionState[]
    activeVersionIndex?: number;
}

/** Active collab session state (Yjs-based) */
export type CollabSession = {
    docId: string;
    clientID: string;
    isOwner: boolean;
    ydoc: Y.Doc;
    provider: WebsocketProvider;
    awareness: Awareness;
    ymap: Y.Map<YjsAnnotation>; // Annotation sync map
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
