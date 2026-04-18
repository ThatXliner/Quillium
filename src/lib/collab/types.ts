/**
 * types.ts — Collab-related types.
 *
 * Per D-70: Clean migration to Yjs — removed OT-specific types.
 * Per D-72: Yjs provider and awareness types.
 * Per D-90/D-92: Annotations are recursive Y.Map nodes (not flat JSON).
 * Per D-93: Comment threads are Y.Array (append-only).
 */
import type * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";

/** Recursive Y.Map node representing a collaborative annotation.
 *
 * Runtime shape (keys and their value types):
 *   "id":                 string
 *   "_type":              "comment" | "suggestion" | "revision"
 *   "startPos":           Uint8Array (encoded RelativePosition)
 *   "endPos":             Uint8Array (encoded RelativePosition)
 *   "thread":             Y.Array<MessageObject>
 *   "annotations":        Y.Map<YjsAnnotationNode>
 *   "replacements"?:      Y.Array<SuggestionReplacement>  (suggestion only)
 *   "author"?:            string                           (suggestion only)
 *   "versions"?:          Y.Map<string, Y.Map<unknown>>    (revision only; key = vIdx string)
 *                            each version Y.Map has { text: Y.Text, label?: string,
 *                                                   annotations: Y.Map<YjsAnnotationNode> }
 *   "activeVersionIndex"?: number                          (revision only)
 *
 * The TypeScript alias is `Y.Map<unknown>` because Yjs does not support
 * discriminated-union typing of child types; runtime validation is the
 * contract. See annotationSchema.ts for the converter invariants.
 */
export type YjsAnnotationNode = Y.Map<unknown>;

/** Append-only comment thread message (D-93). Identical shape to
 * ThreadMessage in $lib/editor/plugins/annotations/models but owned here
 * to prevent a collab -> editor circular import.
 */
export interface MessageObject {
    message: string;
    author: string;
    time: number;
}

/** Active collab session state (Yjs-based) */
export type CollabSession = {
    docId: string;
    clientID: string;
    isOwner: boolean;
    ydoc: Y.Doc;
    provider: WebsocketProvider;
    awareness: Awareness;
    ymap: Y.Map<YjsAnnotationNode>; // Annotation sync map (recursive Y.Map entries)
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
