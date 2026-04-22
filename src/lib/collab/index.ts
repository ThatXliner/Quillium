import { getUser } from "$lib/auth/auth.svelte";
import { supabase } from "$lib/auth/supabase";
import { historyCompartment } from "$lib/editor/extensions";
import { history } from "@codemirror/commands";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
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
import { get } from "svelte/store";
import type * as Y from "yjs";

import {
    addAnnotation,
    annotationField,
    removeAnnotation,
} from "$lib/editor/plugins/annotations/annotationField";
import { AnnotationIdMap } from "./annotationSchema";
import { colorForClient, createAwarenessExtension } from "./awareness";
import { createAnnotationSyncPlugin } from "./yjsAnnotations";
// Yjs modules
import { createYjsBinding } from "./yjsBinding";
import {
    createYjsProvider,
    disconnectYjsProvider,
    getCurrentDocId,
    getYjsProvider,
    handleOwnerLeft,
    relayConfigured,
} from "./yjsProvider";
import { createYjsUndoExtension } from "./yjsUndo";

// Stores
import {
    type JoinerPriorView,
    collabPresenceUsers,
    collabSession,
    collabState,
    followedClientId,
    isCollabJoiner,
    joinerPriorView,
    ownerLeftSignal,
    pendingUpdatesCount,
    reconnectAttempt,
} from "./store";

// Navigation (D-103: restore joiner to prior view)
import { goToEditor, goToLibrary } from "$lib/navigation";
import { currentDraftId } from "$lib/stores";

// Types
export type { CollabSession, CollabState } from "./types";

// Re-exports
export {
    collabState,
    ownerLeftSignal,
    pendingUpdatesCount,
    reconnectAttempt,
    collabSession,
    collabPresenceUsers,
    followedClientId,
    joinerPriorView,
    isCollabJoiner,
    type JoinerPriorView,
} from "./store";
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
    asOwner = true,
): Promise<void> {
    // Connect to Yjs relay
    const { provider, awareness, ydoc, ytext, ymap } = await createYjsProvider(docId);

    // Get local content before connecting
    const localDoc = view.state.doc.toString();

    console.log(`[collab] enableCollab: localDoc.length=${localDoc.length}, asOwner=${asOwner}`);

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
    // Per D-55: Owner's local SQLite is source of truth; relay is broadcast layer
    // Per D-57: Live Room mode — session ends when owner leaves
    const remoteContent = ytext.toString();
    let authoritativeContent: string;

    if (asOwner) {
        // Owner ALWAYS seeds with local content (D-55: owner's local is source of truth)
        // Clear any stale relay content first, then insert local
        if (remoteContent.length > 0 || localDoc.length > 0) {
            console.log(
                `[collab] Owner replacing relay content (remote=${remoteContent.length}, local=${localDoc.length})`,
            );
            ydoc.transact(() => {
                if (ytext.length > 0) {
                    ytext.delete(0, ytext.length);
                }
                if (localDoc.length > 0) {
                    ytext.insert(0, localDoc);
                }
            }, "init");
        }
        authoritativeContent = localDoc;
    } else if (remoteContent.length > 0) {
        // Joiner: relay content is authoritative (owner already seeded it)
        console.log(`[collab] Joiner using relay content (length ${remoteContent.length})`);
        authoritativeContent = remoteContent;
    } else {
        // Joiner connecting to empty room — unusual, but use empty
        console.warn("[collab] Joiner connected to empty room — owner may not have seeded yet");
        authoritativeContent = "";
    }

    // Sync editor to authoritative content (without triggering Yjs update).
    // addToHistory.of(false): the initial doc sync is not a user edit and
    // should not appear in the undo stack — otherwise cmd-z right after
    // connect would revert the sync and strand the editor in a stale state.
    const currentContent = view.state.doc.toString();
    const preJoinLocalAnnotations = !asOwner
        ? Object.values(view.state.field(annotationField, false) ?? {})
        : [];
    if (currentContent !== authoritativeContent || preJoinLocalAnnotations.length > 0) {
        view.dispatch({
            ...(currentContent !== authoritativeContent
                ? {
                      changes: {
                          from: 0,
                          to: view.state.doc.length,
                          insert: authoritativeContent,
                      },
                  }
                : {}),
            effects: preJoinLocalAnnotations.map((annotation) => removeAnnotation.of(annotation)),
            annotations: [Transaction.addToHistory.of(false)],
        });
    }

    // Create Yjs extensions
    const user = getUser();
    const displayName = user?.user_metadata?.full_name ?? user?.email ?? clientID.slice(0, 8);
    const cursorColor = colorForClient(clientID);

    const binding = createYjsBinding(ytext);
    // Per D-83: Pass ymap to UndoManager for unified undo stack
    const { extension: undoExt, undoManager } = createYjsUndoExtension(ytext, ymap);
    const awarenessExt = createAwarenessExtension(awareness, ytext, displayName, cursorColor);

    // Plan 8.5c-02: Caller-owned idMap so subtree controllers can resolve CM ids
    const mainIdMap = new AnnotationIdMap();
    const annotationSync = createAnnotationSyncPlugin(ytext, ymap, clientID, mainIdMap);

    currentUndoManager = undoManager;

    // Plan 8.5c-02: Populate collabSession for subtree helpers
    collabSession.set({
        docId,
        clientID,
        displayName,
        cursorColor,
        isOwner: asOwner,
        ydoc,
        provider,
        awareness,
        ymap,
        ytext,
        undoManager,
        mainIdMap,
    });

    // Install Yjs collab extension - includes annotation sync.
    // Joiners use Y.UndoManager only; owners keep their existing CM history.
    const collabExts = asOwner
        ? [binding, awarenessExt, annotationSync]
        : [binding, undoExt, awarenessExt, annotationSync];
    view.dispatch({
        effects: [
            collabCompartment.reconfigure(collabExts),
            ...(asOwner ? [] : [historyCompartment.reconfigure([])]),
        ],
    });

    // Listen for owner left (custom message from server)
    // y-websocket doesn't have built-in custom messages, so we listen on provider events
    const providerWithConnectionClose = provider as unknown as {
        on(eventName: "connection-close", handler: (event: CloseEvent | null) => void): void;
    };
    providerWithConnectionClose.on("connection-close", (event) => {
        // Check close reason for owner disconnect (event may be null on manual disconnect)
        if (event?.reason === "Owner left") {
            handleOwnerLeft();
        }
    });

    console.log(`[collab] Collab enabled for ${docId.slice(0, 8)}...`);
}

/**
 * Restore joiner to their prior view after leaving/being kicked (D-103).
 * Called by disableCollab when isCollabJoiner is true.
 */
export function restoreJoinerPriorView(): void {
    const prior = get(joinerPriorView);

    // Clear joiner state first
    joinerPriorView.set(null);
    isCollabJoiner.set(false);

    if (!prior) {
        // No prior view recorded, go to library
        goToLibrary();
        return;
    }

    if (prior.draftId) {
        // Restore to previous document
        currentDraftId.set(prior.draftId);
        goToEditor();
    } else {
        // Was in library before
        goToLibrary();
    }
}

function restoreJoinerEditorSnapshot(view: EditorView, prior: JoinerPriorView | null) {
    if (!prior?.editorStateJson) return;

    let restoredState: EditorState;
    try {
        restoredState = EditorState.fromJSON(
            prior.editorStateJson,
            { extensions: [annotationField] },
            { annotationField },
        );
    } catch (err) {
        console.warn("[collab] Failed to restore joiner editor snapshot:", err);
        return;
    }

    const currentAnnotations = Object.values(view.state.field(annotationField, false) ?? {});
    const restoredAnnotations = Object.values(restoredState.field(annotationField, false) ?? {});
    const restoredDoc = restoredState.doc.toString();

    view.dispatch({
        ...(view.state.doc.toString() !== restoredDoc
            ? {
                  changes: {
                      from: 0,
                      to: view.state.doc.length,
                      insert: restoredDoc,
                  },
              }
            : {}),
        selection: restoredState.selection,
        effects: currentAnnotations.map((annotation) => removeAnnotation.of(annotation)),
        annotations: [Transaction.addToHistory.of(false)],
    });

    if (restoredAnnotations.length > 0) {
        view.dispatch({
            effects: restoredAnnotations.map((annotation) => addAnnotation.of(annotation)),
            annotations: [Transaction.addToHistory.of(false)],
        });
    }
}

/**
 * Disable collab and disconnect from relay.
 */
export function disableCollab(view: EditorView): void {
    // D-103: Check if this is a joiner before clearing session
    const wasJoiner = get(isCollabJoiner);
    const prior = wasJoiner ? get(joinerPriorView) : null;

    disconnectYjsProvider();
    currentUndoManager = null;
    collabSession.set(null);
    collabPresenceUsers.set([]);
    followedClientId.set(null);

    // Restore CM history() on disconnect. NOTE: rebuilt with empty stack;
    // joiner->owner mid-session is not supported (see CONTEXT.md).
    view.dispatch({
        effects: [
            collabCompartment.reconfigure([]),
            historyCompartment.reconfigure(history({ newGroupDelay: 250 })),
        ],
    });

    console.log("[collab] Collab disabled");

    // D-103: Restore joiner to prior view
    if (wasJoiner) {
        restoreJoinerEditorSnapshot(view, prior);
        restoreJoinerPriorView();
    }
}

/**
 * Get current UndoManager (or null if not in collab mode).
 */
export function getUndoManager(): Y.UndoManager | null {
    return currentUndoManager;
}
