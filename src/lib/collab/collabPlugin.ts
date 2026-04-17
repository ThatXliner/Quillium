/**
 * collabPlugin.ts -- ViewPlugin for collab push/pull loop.
 *
 * Sends local changes via sendableUpdates() on docChanged.
 * Receives remote changes via socket message events.
 * Applies remote changes via receiveUpdates().
 *
 * Per D-51: Static collab extension in stack, enabled/disabled via Compartment.
 * Per D-50: Per-user undo via clientID in collab() config.
 */
import { ViewPlugin, type ViewUpdate, type EditorView } from "@codemirror/view";
import { Compartment, ChangeSet } from "@codemirror/state";
import {
    collab,
    sendableUpdates,
    receiveUpdates,
    getSyncedVersion,
    type Update,
} from "@codemirror/collab";
import { encode, decode, type ServerMessage, type SerializedUpdate } from "./protocol";

/** Compartment for hot-swapping collab extension (per D-51) */
export const collabCompartment = new Compartment();

/**
 * Create the push/pull ViewPlugin for a specific socket connection.
 *
 * The plugin:
 * 1. On docChanged: sends local changes to relay via pushUpdates
 * 2. On socket message: applies remote changes via receiveUpdates
 * 3. Handles push rejection by pulling first, then retrying
 */
export function collabPushPull(socket: WebSocket) {
    return ViewPlugin.fromClass(
        class {
            private pushing = false;
            private destroyed = false;
            private messageHandler: (event: MessageEvent) => void;

            constructor(private view: EditorView) {
                // Set up socket message handler for pulls
                this.messageHandler = (event: MessageEvent) => {
                    this.handleMessage(event.data);
                };
                socket.addEventListener("message", this.messageHandler);

                // Initial pull to sync with server state
                this.pullUpdates();
            }

            update(update: ViewUpdate) {
                if (update.docChanged && !this.pushing) {
                    this.push();
                }
            }

            private push() {
                const updates = sendableUpdates(this.view.state);
                if (!updates.length || this.pushing) return;

                this.pushing = true;
                const version = getSyncedVersion(this.view.state);

                socket.send(
                    encode({
                        type: "pushUpdates",
                        version,
                        updates: updates.map((u) => ({
                            changes: u.changes.toJSON(),
                            clientID: u.clientID,
                        })),
                    }),
                );
            }

            private pullUpdates() {
                const version = getSyncedVersion(this.view.state);
                socket.send(encode({ type: "pullUpdates", version }));
            }

            private handleMessage(raw: string) {
                if (this.destroyed) return;

                let msg: ServerMessage;
                try {
                    msg = decode(raw) as ServerMessage;
                } catch {
                    console.error("[collab] Failed to decode message:", raw);
                    return;
                }

                if (msg.type === "pullUpdates") {
                    // Received updates from server
                    if (msg.updates.length > 0) {
                        const updates: Update[] = msg.updates.map((u: SerializedUpdate) => ({
                            changes: ChangeSet.fromJSON(u.changes),
                            clientID: u.clientID,
                        }));
                        this.view.dispatch(receiveUpdates(this.view.state, updates));
                    }
                    // After applying, check if we have pending local changes
                    if (sendableUpdates(this.view.state).length) {
                        setTimeout(() => this.push(), 100);
                    }
                } else if (msg.type === "pushUpdates") {
                    this.pushing = false;
                    if (!msg.ok) {
                        // Stale base version -- pull first, then retry
                        console.log("[collab] Push rejected, pulling first");
                        this.pullUpdates();
                    } else {
                        // Check for more accumulated updates
                        if (sendableUpdates(this.view.state).length) {
                            setTimeout(() => this.push(), 100);
                        }
                    }
                }
            }

            destroy() {
                this.destroyed = true;
                socket.removeEventListener("message", this.messageHandler);
            }
        },
    );
}

/**
 * Create the collab extension stack for a session.
 * Per D-50: clientID enables per-user undo (author-tagged changes).
 */
export function createCollabExtension(startVersion: number, clientID: string, socket: WebSocket) {
    return [collab({ startVersion, clientID }), collabPushPull(socket)];
}
