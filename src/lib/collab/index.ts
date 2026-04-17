/**
 * index.ts -- Collab module entry point.
 *
 * Re-exports the public API for collaborative editing:
 *   - collabCompartment: Compartment for hot-swapping collab extension
 *   - enableCollab(): activate collab with socket + version
 *   - disableCollab(): deactivate collab, disconnect socket
 *
 * Key dependencies:
 *   - @codemirror/state (Compartment)
 *   - @codemirror/collab (collab, getSyncedVersion)
 *   - ./socket (connectToCollab, disconnectCollab)
 *   - ./collabPlugin (collabPushPull, createCollabExtension)
 */
import type { EditorView } from "@codemirror/view";
import { connectToCollab, disconnectCollab, getSocket, relayConfigured } from "./socket";
import { collabCompartment, createCollabExtension } from "./collabPlugin";
import { supabase } from "$lib/auth/supabase";

// Re-exports
export { collabCompartment } from "./collabPlugin";
export { relayConfigured, getSocket, connectToCollab, disconnectCollab } from "./socket";
export { collabState } from "./store";
export * from "./types";
export * from "./protocol";

/**
 * Register a document with the relay's sync_documents table.
 * Creates the row if it doesn't exist (upsert).
 * Must be called before connecting to ensure the relay allows the connection.
 */
export async function registerDocumentForCollab(
    docId: string,
    ownerId: string,
    title: string,
): Promise<void> {
    if (!supabase) {
        throw new Error("Supabase not configured");
    }

    const { error } = await supabase.from("sync_documents").upsert(
        {
            id: docId,
            owner_id: ownerId,
            title: title,
        },
        { onConflict: "id" },
    );

    if (error) {
        console.error("[collab] Failed to register document:", error);
        throw new Error(`Failed to register document: ${error.message}`);
    }
}

/**
 * Enable collab for the given editor view.
 * Per D-52: Creates per-document socket instance.
 * Per D-50: clientID enables per-user undo.
 *
 * @param view - The EditorView to enable collab on
 * @param docId - The document ID for the relay room
 * @param clientID - The user's ID for per-user undo (typically Supabase user.id)
 * @throws If connection to relay fails
 */
export async function enableCollab(
    view: EditorView,
    docId: string,
    clientID: string,
    asOwner: boolean = true,
): Promise<void> {
    const { socket, initialState } = await connectToCollab(docId);

    const localDoc = view.state.doc.toString();
    const relayDoc = initialState.doc;
    let startVersion = initialState.version;
    let shouldReplaceLocal = false;

    if (relayDoc !== localDoc) {
        if (asOwner) {
            // Owner: local content is source of truth.
            // If relay is empty, initialize it. If relay has stale content, we force-replace it.
            if (initialState.version === 0 && relayDoc.length === 0) {
                // Empty room — initialize with local content via initDocument.
                console.log("[collab] Owner initializing empty room with local content, length:", localDoc.length);
                const initResult = await new Promise<{ ok: boolean; version?: number }>((resolve) => {
                    socket.emit("initDocument", { content: localDoc }, resolve);
                });
                if (!initResult.ok) {
                    throw new Error("Failed to initialize document on relay");
                }
                startVersion = initResult.version ?? 0;
            } else {
                // Relay has stale content from a previous session — owner's local wins.
                // TODO: Phase 7+ should warn user about this or reset the relay room.
                console.warn(
                    "[collab] Owner has different local content than relay (v" + initialState.version +
                    "). Local content preserved; relay state will be out of sync until next session reset."
                );
                // Don't replace local, don't initDocument (room isn't empty).
                // Owner's future edits will push as diffs from v=initialState.version,
                // which will cause OT errors. User should reset relay room.
            }
        } else {
            // Joiner: relay content is source of truth. Replace local.
            console.log("[collab] Joiner syncing to relay document, length:", relayDoc.length);
            shouldReplaceLocal = true;
        }
    }

    // Apply content replacement AND enable collab extension in a single transaction.
    view.dispatch({
        changes: shouldReplaceLocal
            ? { from: 0, to: view.state.doc.length, insert: relayDoc }
            : undefined,
        effects: collabCompartment.reconfigure(
            createCollabExtension(startVersion, clientID, socket),
        ),
    });
}

/**
 * Disable collab and disconnect from relay.
 * Per D-52: Destroys the per-document socket instance.
 */
export function disableCollab(view: EditorView): void {
    disconnectCollab();
    view.dispatch({
        effects: collabCompartment.reconfigure([]),
    });
}
