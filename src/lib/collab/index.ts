/**
 * index.ts -- Collab module entry point (Yjs implementation).
 *
 * Per D-70: Clean migration -- uses Yjs instead of @codemirror/collab.
 * Per D-72: Custom Y.Text <-> CodeMirror binding.
 *
 * Re-exports public API:
 *   - collabCompartment: Compartment for hot-swapping collab extension
 *   - enableCollab(): activate collab with Yjs provider
 *   - disableCollab(): deactivate collab, disconnect provider
 */
import type { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import * as Y from "yjs";
import { supabase } from "$lib/auth/supabase";
import { getUser } from "$lib/auth/auth.svelte";

// Yjs modules
import { createYjsBinding } from "./yjsBinding";
import { createYjsUndoExtension } from "./yjsUndo";
import { createAwarenessExtension, colorForClient } from "./awareness";
import {
    createYjsProvider,
    disconnectYjsProvider,
    handleOwnerLeft,
    relayConfigured,
    getYjsProvider,
    getCurrentDocId,
} from "./yjsProvider";
import { createAnnotationSyncPlugin } from "./yjsAnnotations";

// Stores
import { collabState, ownerLeftSignal, pendingUpdatesCount, reconnectAttempt } from "./store";

// Types
export type { CollabSession, CollabState } from "./types";

// Re-exports
export { collabState, ownerLeftSignal, pendingUpdatesCount, reconnectAttempt } from "./store";
export { colorForClient } from "./awareness";
export { relayConfigured, getYjsProvider, getCurrentDocId } from "./yjsProvider";

/** Compartment for hot-swapping collab extension (per D-51) */
export const collabCompartment = new Compartment();

/** Current Y.UndoManager (for external access if needed) */
let currentUndoManager: Y.UndoManager | null = null;

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
 *
 * Per D-70: Uses Yjs instead of @codemirror/collab.
 * Per D-72: Custom Y.Text <-> CodeMirror binding.
 * Per D-74: UndoManager tracks local changes only.
 *
 * @param view - The EditorView to enable collab on
 * @param docId - The document ID for the relay room
 * @param clientID - The user's ID (typically Supabase user.id)
 * @param asOwner - Whether connecting as document owner
 * @throws If connection to relay fails
 */
export async function enableCollab(
    view: EditorView,
    docId: string,
    clientID: string,
    asOwner: boolean = true,
): Promise<void> {
    // Connect to Yjs relay
    const { provider, awareness, ydoc, ytext, ymap } = await createYjsProvider(docId);

    // Get local content before connecting
    const localDoc = view.state.doc.toString();

    console.log(
        `[collab] enableCollab: localDoc.length=${localDoc.length}, asOwner=${asOwner}`,
    );

    // Wait for initial sync with timeout
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            console.error("[collab] Sync timeout after 10s - provider.synced:", provider.synced);
            reject(new Error("Sync timeout - relay may not be responding correctly"));
        }, 10000);

        const checkSync = () => {
            if (provider.synced) {
                clearTimeout(timeout);
                resolve();
            } else {
                provider.once("sync", () => {
                    clearTimeout(timeout);
                    resolve();
                });
            }
        };
        checkSync();
    });

    // After sync, determine authoritative content
    const remoteContent = ytext.toString();
    let authoritativeContent: string;

    if (asOwner && remoteContent.length === 0 && localDoc.length > 0) {
        // Owner connecting to empty room -- seed with local content
        console.log("[collab] Owner seeding relay with local content, length:", localDoc.length);
        ydoc.transact(() => {
            ytext.insert(0, localDoc);
        }, "init");
        authoritativeContent = localDoc;
    } else if (remoteContent.length > 0) {
        // Relay has content -- use it
        console.log(`[collab] Using relay content (length ${remoteContent.length})`);
        authoritativeContent = remoteContent;
    } else {
        // Both empty -- use local (empty)
        authoritativeContent = localDoc;
    }

    // Sync editor to authoritative content (without triggering Yjs update)
    const currentContent = view.state.doc.toString();
    if (currentContent !== authoritativeContent) {
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: authoritativeContent },
        });
    }

    // Create Yjs extensions
    const user = getUser();
    const displayName = user?.user_metadata?.full_name ?? user?.email ?? clientID.slice(0, 8);
    const cursorColor = colorForClient(clientID);

    const binding = createYjsBinding(ytext);
    // Per D-83: Pass ymap to UndoManager for unified undo stack
    const { extension: undoExt, undoManager } = createYjsUndoExtension(ytext, ymap);
    const awarenessExt = createAwarenessExtension(awareness, displayName, cursorColor);
    // Annotation sync plugin - bidirectional Y.Map <-> annotationField sync
    const annotationSync = createAnnotationSyncPlugin(ytext, ymap, clientID);

    currentUndoManager = undoManager;

    // Install Yjs collab extension - includes annotation sync
    view.dispatch({
        effects: collabCompartment.reconfigure([binding, undoExt, awarenessExt, annotationSync]),
    });

    // Listen for owner left (custom message from server)
    // y-websocket doesn't have built-in custom messages, so we listen on provider events
    provider.on("connection-close" as any, (event: CloseEvent) => {
        // Check close reason for owner disconnect
        if (event.reason === "Owner left") {
            handleOwnerLeft();
        }
    });

    console.log(`[collab] Collab enabled for ${docId.slice(0, 8)}...`);
}

/**
 * Disable collab and disconnect from relay.
 */
export function disableCollab(view: EditorView): void {
    disconnectYjsProvider();
    currentUndoManager = null;

    view.dispatch({
        effects: collabCompartment.reconfigure([]),
    });

    console.log("[collab] Collab disabled");
}

/**
 * Get current UndoManager (or null if not in collab mode).
 */
export function getUndoManager(): Y.UndoManager | null {
    return currentUndoManager;
}
