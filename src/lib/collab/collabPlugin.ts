/**
 * collabPlugin.ts -- ViewPlugin for collab push/pull loop.
 *
 * Sends local changes via sendableUpdates() on docChanged.
 * Receives remote changes via Socket.io events.
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
import type { Socket } from "socket.io-client";
import type { SerializedUpdate } from "./protocol";
import { ownerLeftSignal } from "./store";
import { removeRemoteCursor } from "./cursors";

/** Compartment for hot-swapping collab extension (per D-51) */
export const collabCompartment = new Compartment();

/**
 * Create the push/pull ViewPlugin for a specific Socket.io connection.
 *
 * The plugin:
 * 1. On docChanged: sends local changes to relay via pushUpdates
 * 2. On socket pullUpdates event: applies remote changes via receiveUpdates
 * 3. Handles push rejection by pulling first, then retrying
 */
export function collabPushPull(socket: Socket) {
    return ViewPlugin.fromClass(
        class {
            private pushing = false;
            private destroyed = false;

            constructor(private view: EditorView) {
                // Set up Socket.io event handler for receiving broadcast updates from other clients.
                socket.on("updates", (data: { updates: SerializedUpdate[] }) => {
                    this.handlePullResponse(data.updates);
                });

                // Handle owner disconnect (per D-61): defer dispatch to avoid update cycle recursion
                socket.on("ownerLeft", () => {
                    if (this.destroyed) return;
                    setTimeout(() => {
                        if (this.destroyed) return;
                        // Reconfigure compartment to empty (same as disableCollab's dispatch step).
                        // Socket disconnect is handled separately by GoLiveButton after signal fires.
                        this.view.dispatch({
                            effects: collabCompartment.reconfigure([]),
                        });
                        ownerLeftSignal.update((n) => n + 1);
                    }, 0);
                });

                // Handle collaborator leaving: remove their cursor from remoteCursorsField
                socket.on("clientLeft", (data: { clientID: string }) => {
                    if (this.destroyed) return;
                    // clientLeft may arrive while a transaction is processing — defer to be safe
                    setTimeout(() => {
                        if (this.destroyed) return;
                        this.view.dispatch({
                            effects: removeRemoteCursor.of(data.clientID),
                        });
                    }, 0);
                });

                // Initial pull to catch any updates that happened between init and now.
                // This handles the race where owner types while joiner is setting up.
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

                console.log(
                    `[collab] Pushing ${updates.length} updates from v${version}, ` +
                    `doc.length=${this.view.state.doc.length}, changes.length=${updates[0]?.changes.length}`,
                );

                socket.emit(
                    "pushUpdates",
                    {
                        version,
                        updates: updates.map((u) => ({
                            changes: u.changes.toJSON(),
                            clientID: u.clientID,
                        })),
                    },
                    (response: { version?: number; updates?: SerializedUpdate[]; error?: string }) => {
                        this.pushing = false;
                        if (response.error) {
                            // Log the error. Don't retry automatically — if the server
                            // rejects our push, the documents are out of sync and we
                            // need user intervention (reload) rather than infinite retry.
                            console.error("[collab] Push rejected:", response.error);
                        } else if (response.updates && response.updates.length > 0) {
                            // Server returns our confirmed updates — apply them to advance synced version
                            this.handlePullResponse(response.updates);
                        }
                    },
                );
            }

            private pullUpdates() {
                const version = getSyncedVersion(this.view.state);
                socket.emit(
                    "pullUpdates",
                    { version },
                    (response: { updates: SerializedUpdate[] }) => {
                        this.handlePullResponse(response.updates);
                    },
                );
            }

            private handlePullResponse(updates: SerializedUpdate[]) {
                if (this.destroyed) return;

                if (updates.length > 0) {
                    const parsed: Update[] = updates.map((u) => ({
                        changes: ChangeSet.fromJSON(u.changes),
                        clientID: u.clientID,
                    }));
                    this.view.dispatch(receiveUpdates(this.view.state, parsed));
                }

                // After applying, check if we have pending local changes
                if (sendableUpdates(this.view.state).length) {
                    setTimeout(() => this.push(), 100);
                }
            }

            destroy() {
                this.destroyed = true;
                socket.off("updates");
                socket.off("ownerLeft");
                socket.off("clientLeft");
            }
        },
    );
}

/**
 * Create the collab extension stack for a session.
 * Per D-50: clientID enables per-user undo (author-tagged changes).
 */
export function createCollabExtension(startVersion: number, clientID: string, socket: Socket) {
    return [collab({ startVersion, clientID }), collabPushPull(socket)];
}
