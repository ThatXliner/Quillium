/**
 * protocol.ts — WebSocket message types and JSON encoding.
 *
 * Client → Server messages:
 *   - pullUpdates: "give me all updates since version N"
 *   - pushUpdates: "here are my local changes, base version N"
 *
 * Server → Client messages:
 *   - pullUpdates: response with array of updates
 *   - pushUpdates: ack (ok: true) or reject (ok: false)
 */

/** A serialized collab update (matches @codemirror/collab wire format). */
export type SerializedUpdate = {
    changes: unknown;
    clientID: string;
};

export type ClientMessage =
    | { type: "pullUpdates"; version: number }
    | { type: "pushUpdates"; version: number; updates: SerializedUpdate[] };

export type ServerMessage =
    | { type: "pullUpdates"; updates: SerializedUpdate[] }
    | { type: "pushUpdates"; ok: boolean };

export function encode(msg: ClientMessage | ServerMessage): string {
    return JSON.stringify(msg);
}

export function decode(raw: string): ClientMessage | ServerMessage {
    return JSON.parse(raw);
}
