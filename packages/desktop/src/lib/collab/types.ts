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

/** Recursive Y.Map node representing a collaborative annotation.
 *
 * Runtime shape (keys and their value types):
 *   "id":                 string
 *   "_type":              "comment" | "suggestion" | "revision"
 *   "startPos":           Uint8Array (encoded RelativePosition)
 *   "endPos":             Uint8Array (encoded RelativePosition)
 *   "thread":             Y.Array<ThreadMessage>
 *   "annotations":        Y.Map<YjsAnnotationNode>
 *   "replacements"?:      Y.Array<SuggestionReplacement>  (suggestion only)
 *   "author"?:            string                           (suggestion only)
 *   "versions"?:          Y.Map<string, Y.Map<unknown>>    (revision only; key = version.id)
 *                            each version Y.Map has { text: Y.Text, label?: string,
 *                                                   annotations: Y.Map<YjsAnnotationNode> }
 *   "order"?:             Y.Array<string>                  (revision only; ordered version ids)
 *   "activeVersionId"?:   string                           (revision only)
 *   "activeVersionIndex"?: number                          (legacy revision rooms only)
 *
 * The TypeScript alias is `Y.Map<unknown>` because Yjs does not support
 * discriminated-union typing of child types; runtime validation is the
 * contract. See annotationSchema.ts for the converter invariants.
 */
export type YjsAnnotationNode = Y.Map<unknown>;

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
