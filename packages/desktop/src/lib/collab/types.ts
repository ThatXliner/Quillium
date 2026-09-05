import type { Awareness } from "y-protocols/awareness";
import type { WebsocketProvider } from "y-websocket";
/**
 * types.ts — Collab-related types.
 *
 * Per D-70: Clean migration to Yjs — removed OT-specific types.
 * Per D-72: Yjs provider and awareness types.
 * Per D-90/D-92: Annotations are recursive Y.Map nodes (not flat JSON).
 * Per D-93: Comment threads are Y.Array (append-only).
 */
import type * as Y from "yjs";
import type { AnnotationIdMap } from "./annotationSchema";

import type { YjsAnnotationNode } from "@quillium/share/collab-contract/annotations";
export type { YjsAnnotationNode } from "@quillium/share/collab-contract/annotations";

/** Stable wire representation. Revision ids are Yjs annotation keys, never peer-local CM ids. */
export type YjsVersionGroup = {
    id: string;
    label: string;
    members: Array<{ revisionId: string; versionId: string }>;
};

/** Active collab session state (Yjs-based) */
export type CollabSession = {
    docId: string;
    clientID: string;
    displayName: string;
    cursorColor: string;
    isOwner: boolean;
    ydoc: Y.Doc;
    provider: WebsocketProvider;
    awareness: Awareness;
    ytext: Y.Text; // Main document Y.Text
    ymap: Y.Map<YjsAnnotationNode>; // Annotation sync map (recursive Y.Map entries)
    yVersionGroups: Y.Map<YjsVersionGroup>; // Version-group sync map (plain JSON entries)
    undoManager: Y.UndoManager; // Plan 8.5c-02: For subtree undo scope registration
    mainIdMap: AnnotationIdMap; // Plan 8.5c-02: For CM ID ↔ Yjs ID resolution
};

/** Connection state for UI display */
export type CollabState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "syncing"
    | "reconnecting"
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
