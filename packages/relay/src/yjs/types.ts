import type { WebSocket } from "ws";
import type { Awareness } from "y-protocols/awareness";
/**
 * types.ts -- Yjs room and connection types.
 *
 * Per D-71: Room holds Y.Doc instead of @codemirror/state Text.
 */
import type * as Y from "yjs";

export interface YjsRoom {
    documentId: string;
    ydoc: Y.Doc;
    awareness: Awareness;
    clients: Set<WebSocket>;
    cleanupTimer: NodeJS.Timeout | null;
    isOwnerConnected: boolean;
    ownerId: string | null;
}

export interface YjsClientData {
    userId: string;
    documentId: string;
    isOwner: boolean;
    isAnonymous: boolean;
}
