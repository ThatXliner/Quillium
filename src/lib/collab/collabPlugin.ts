/**
 * collabPlugin.ts -- ViewPlugin for collab push/pull loop.
 *
 * Follows the canonical CodeMirror collab pattern:
 * - Push: send local changes when doc changes
 * - Pull: fetch updates from server, ensuring sequential delivery
 *
 * Socket.io broadcasts are used as signals that updates are available,
 * but we always pull to get updates in the correct order.
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
import { ownerLeftSignal, pendingUpdatesCount, collabState } from "./store";
import { flushBufferedUpdates } from "./socket";
import { get } from "svelte/store";
import { removeRemoteCursor, setRemoteCursor } from "./cursors";

/** Compartment for hot-swapping collab extension (per D-51) */
export const collabCompartment = new Compartment();

/**
 * Create the push/pull ViewPlugin for a specific Socket.io connection.
 *
 * Following the canonical CodeMirror collab example:
 * 1. On docChanged: push local changes to relay
 * 2. On broadcast signal: pull updates from relay (ensures sequential delivery)
 * 3. receiveUpdates() handles rebasing local changes against remote
 */
export function collabPushPull(socket: Socket) {
    return ViewPlugin.fromClass(
        class {
            private pushing = false;
            private pulling = false;
            private destroyed = false;
            private pendingCount = 0;

            constructor(private view: EditorView) {
                // Socket.io broadcasts signal that updates are available.
                // Instead of applying directly (which could be out of order),
                // we pull to get updates in the correct sequence.
                socket.on("updates", () => {
                    if (this.destroyed) return;
                    this.pull();
                });

                // Handle owner disconnect (per D-61): defer dispatch to avoid update cycle recursion
                socket.on("ownerLeft", () => {
                    if (this.destroyed) return;
                    setTimeout(() => {
                        if (this.destroyed) return;
                        this.view.dispatch({
                            effects: collabCompartment.reconfigure([]),
                        });
                        ownerLeftSignal.update((n) => n + 1);
                    }, 0);
                });

                // Handle collaborator leaving: remove their cursor from remoteCursorsField
                socket.on("clientLeft", (data: { clientID: string }) => {
                    if (this.destroyed) return;
                    setTimeout(() => {
                        if (this.destroyed) return;
                        this.view.dispatch({
                            effects: removeRemoteCursor.of(data.clientID),
                        });
                    }, 0);
                });

                // Handle remote cursor position updates
                socket.on(
                    "cursorUpdate",
                    (data: { clientID: string; pos: number; name: string; color: string }) => {
                        if (this.destroyed) return;
                        setTimeout(() => {
                            if (this.destroyed) return;
                            this.view.dispatch({
                                effects: setRemoteCursor.of(data),
                            });
                        }, 0);
                    },
                );

                // Handle successful reconnection: pull any missed updates
                socket.on("reconnect", () => {
                    if (this.destroyed) return;
                    console.log("[collab] Reconnected, re-syncing state");
                    this.pull();
                });

                // Discard any buffered updates — we'll pull fresh from relay.
                // This is cleaner than trying to apply potentially stale buffered updates.
                flushBufferedUpdates();

                // Initial pull to catch any updates that happened between init and now.
                // Deferred to avoid nested dispatch during plugin construction.
                setTimeout(() => {
                    if (this.destroyed) return;
                    this.pull();
                }, 0);
            }

            update(update: ViewUpdate) {
                if (update.docChanged && !this.pushing) {
                    this.push();
                }
                this.updatePendingCount();
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
                            console.error("[collab] Push rejected:", response.error);
                            // Pull to re-sync, then retry push
                            this.pull();
                        } else {
                            // Push succeeded. Following the canonical CodeMirror pattern,
                            // we DON'T apply updates from the push callback. Instead, we
                            // pull to get updates in proper sequence. This avoids version
                            // mismatch issues when the server rebases our changes.
                            //
                            // The pull will return our confirmed updates (matched by clientID)
                            // along with any other updates we may have missed.
                            this.pull();
                        }

                        this.updatePendingCount();
                    },
                );
            }

            private pull() {
                // Prevent concurrent pulls
                if (this.pulling || this.destroyed) return;
                this.pulling = true;

                const version = getSyncedVersion(this.view.state);
                console.log(`[collab] Pulling updates from v${version}`);

                socket.emit(
                    "pullUpdates",
                    { version },
                    (response: { updates: SerializedUpdate[] }) => {
                        this.pulling = false;
                        if (this.destroyed) return;

                        if (response.updates && response.updates.length > 0) {
                            console.log(`[collab] Received ${response.updates.length} updates from pull`);
                            this.applyUpdates(response.updates);

                            // After applying, push any pending local changes
                            if (sendableUpdates(this.view.state).length) {
                                setTimeout(() => this.push(), 100);
                            }
                        }

                        this.updatePendingCount();
                    },
                );
            }

            /**
             * Apply updates received from the relay via receiveUpdates().
             * This handles both remote updates and confirmation of our own updates.
             */
            private applyUpdates(updates: SerializedUpdate[]) {
                if (this.destroyed || updates.length === 0) return;

                const syncedVersion = getSyncedVersion(this.view.state);
                const docLength = this.view.state.doc.length;

                console.log(
                    `[collab] Applying ${updates.length} updates, ` +
                        `syncedVersion=${syncedVersion}, doc.length=${docLength}`,
                );

                const parsed: Update[] = updates.map((u) => ({
                    changes: ChangeSet.fromJSON(u.changes),
                    clientID: u.clientID,
                }));

                // Log changeset details for debugging
                for (let i = 0; i < parsed.length; i++) {
                    const cs = parsed[i].changes;
                    console.log(
                        `[collab] Update ${i}: changeset.length=${cs.length}, ` +
                            `changeset.newLength=${cs.newLength}, clientID=${parsed[i].clientID}`,
                    );
                }

                // Log pending updates for debugging
                const pendingBefore = sendableUpdates(this.view.state);
                if (pendingBefore.length > 0) {
                    console.log(`[collab] Before receiveUpdates: ${pendingBefore.length} pending`);
                    for (let i = 0; i < pendingBefore.length; i++) {
                        console.log(
                            `[collab] Pending[${i}]: changes.length=${pendingBefore[i].changes.length}, ` +
                                `changes.newLength=${pendingBefore[i].changes.newLength}, ` +
                                `clientID=${pendingBefore[i].clientID}`,
                        );
                    }
                }

                try {
                    this.view.dispatch(receiveUpdates(this.view.state, parsed));
                } catch (e) {
                    console.error("[collab] receiveUpdates failed:", e);
                    console.error(
                        "[collab] State at failure: syncedVersion=",
                        syncedVersion,
                        ", docLength=",
                        docLength,
                    );
                    // Don't rethrow — log and continue. The user can reload if needed.
                }
            }

            private updatePendingCount() {
                const pending = sendableUpdates(this.view.state).length;
                if (pending !== this.pendingCount) {
                    this.pendingCount = pending;
                    pendingUpdatesCount.set(pending);

                    const currentState = get(collabState);
                    if (pending > 0 && currentState === "connected") {
                        collabState.set("syncing");
                    } else if (pending === 0 && currentState === "syncing") {
                        collabState.set("connected");
                    }
                }
            }

            destroy() {
                this.destroyed = true;
                pendingUpdatesCount.set(0);
                socket.off("updates");
                socket.off("ownerLeft");
                socket.off("clientLeft");
                socket.off("cursorUpdate");
                socket.off("reconnect");
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
