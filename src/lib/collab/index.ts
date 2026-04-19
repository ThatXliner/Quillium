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
import { Compartment, Transaction } from "@codemirror/state";
import * as Y from "yjs";
import { get } from "svelte/store";
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
import { AnnotationIdMap } from "./annotationSchema";
import type { YjsAnnotationNode } from "./types";
import { annotationEventBus } from "$lib/editor/plugins/annotations/eventBus";

// Stores
import {
    collabState,
    ownerLeftSignal,
    pendingUpdatesCount,
    reconnectAttempt,
    collabSession,
    joinerPriorView,
    isCollabJoiner,
} from "./store";

// Navigation (D-103: restore joiner to prior view)
import { goToLibrary, goToEditor } from "$lib/navigation";
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

/** Module-scope listener for stack-item-popped cleanup in disableCollab */
let stackItemPoppedListener:
    | ((event: {
          stackItem: Y.UndoManager extends { undoStack: (infer T)[] } ? T : never;
          type: "undo" | "redo";
          changedParentTypes: Map<Y.AbstractType<unknown>, unknown[]>;
      }) => void)
    | null = null;

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
    if (currentContent !== authoritativeContent) {
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: authoritativeContent },
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
        isOwner: asOwner,
        ydoc,
        provider,
        awareness,
        ymap,
        ytext,
        undoManager,
        mainIdMap,
    });

    // Plan 8.5c-02 (D-96): Wire stack-item-popped → undo-target event
    stackItemPoppedListener = (event) => {
        try {
            const emittedCmIds = new Set<number>();
            for (const yType of event.changedParentTypes.keys()) {
                const owning = findOwningAnnotationId(yType, ymap, mainIdMap);
                if (!owning) continue;
                if (emittedCmIds.has(owning.cmId)) continue;
                emittedCmIds.add(owning.cmId);
                annotationEventBus.emit({
                    type: "undo-target",
                    annotationId: owning.cmId,
                    versionIndex: owning.versionIndex,
                    undoType: event.type,
                });
            }
        } catch (err) {
            // T-08.5-06-04: Don't break UndoManager state on emit error
            console.error("[collab] stack-item-popped listener error:", err);
        }
    };
    undoManager.on("stack-item-popped", stackItemPoppedListener);

    // Install Yjs collab extension - includes annotation sync
    view.dispatch({
        effects: collabCompartment.reconfigure([binding, undoExt, awarenessExt, annotationSync]),
    });

    // Listen for owner left (custom message from server)
    // y-websocket doesn't have built-in custom messages, so we listen on provider events
    provider.on("connection-close" as any, (event: CloseEvent | null) => {
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

/**
 * Disable collab and disconnect from relay.
 */
export function disableCollab(view: EditorView): void {
    // Plan 8.5c-02: Clean up stack-item-popped listener
    if (currentUndoManager && stackItemPoppedListener) {
        currentUndoManager.off("stack-item-popped", stackItemPoppedListener);
        stackItemPoppedListener = null;
    }

    // D-103: Check if this is a joiner before clearing session
    const wasJoiner = get(isCollabJoiner);

    disconnectYjsProvider();
    currentUndoManager = null;
    collabSession.set(null);

    view.dispatch({
        effects: collabCompartment.reconfigure([]),
    });

    console.log("[collab] Collab disabled");

    // D-103: Restore joiner to prior view
    if (wasJoiner) {
        restoreJoinerPriorView();
    }
}

/**
 * Get current UndoManager (or null if not in collab mode).
 */
export function getUndoManager(): Y.UndoManager | null {
    return currentUndoManager;
}

// ── Plan 8.5c-01: Subtree context helpers ─────────────────────────────────

/**
 * Resolve a CM revision ID to its Yjs annotation ID.
 * Returns null if collab is not active or the revision is not yet synced.
 */
export function getRevisionYjsId(cmId: number): string | null {
    const session = get(collabSession);
    if (!session?.mainIdMap) return null;
    return session.mainIdMap.getYjsId(cmId) ?? null;
}

/**
 * Check if a revision has an active Yjs subtree (collab owns its content).
 * Used by annotationField Phase 3 to skip doc-pulling for revisions whose
 * content is managed by Yjs.
 */
export function hasSubtreeForRevision(cmId: number): boolean {
    const yjsId = getRevisionYjsId(cmId);
    if (!yjsId) return false;

    const session = get(collabSession);
    if (!session) return false;

    const revNode = session.ymap.get(yjsId);
    if (!(revNode instanceof Y.Map)) return false;

    const versionsMap = revNode.get("versions");
    return versionsMap instanceof Y.Map && versionsMap.size > 0;
}

/**
 * Get the subtree context (Y.Text + Y.Map<annotations> + UndoManager) for a
 * revision's version. Used by NestedEditorController to wire subtree bindings.
 *
 * Returns null if:
 *   - Collab is not active
 *   - The revision Yjs node doesn't exist
 *   - The version index doesn't have a Y.Text subtree yet
 */
export function getSubtreeContext(
    revisionYjsId: string,
    versionIndex: number,
): {
    subtreeYtext: Y.Text;
    subtreeAnnotations: Y.Map<YjsAnnotationNode>;
    undoManager: Y.UndoManager;
} | null {
    const session = get(collabSession);
    if (!session) return null;

    const revNode = session.ymap.get(revisionYjsId);
    if (!(revNode instanceof Y.Map)) return null;

    const versionsMap = revNode.get("versions");
    if (!(versionsMap instanceof Y.Map)) return null;

    const versionNode = versionsMap.get(String(versionIndex));
    if (!(versionNode instanceof Y.Map)) return null;

    const subtreeYtext = versionNode.get("text");
    const subtreeAnnotations = versionNode.get("annotations");

    if (!(subtreeYtext instanceof Y.Text)) return null;
    if (!(subtreeAnnotations instanceof Y.Map)) return null;
    if (!session.undoManager) return null;

    return {
        subtreeYtext,
        subtreeAnnotations: subtreeAnnotations as Y.Map<YjsAnnotationNode>,
        undoManager: session.undoManager,
    };
}

// ── Plan 8.5c-02: Undo auto-navigation helpers ───────────────────────────────

/**
 * Walk up from a Y.Text/Y.Map/Y.Array inside a subtree until we reach the
 * doc-level ymap, recording the top-level annotation key and (if present)
 * the version index. Returns null if the type does not belong to any
 * annotation subtree in this session.
 *
 * Exported for testing; internal use is via stack-item-popped listener.
 */
export function findOwningAnnotationId(
    yType: Y.AbstractType<unknown>,
    docYmap: Y.Map<unknown>,
    mainIdMap: AnnotationIdMap,
): { cmId: number; versionIndex?: number } | null {
    // T-08.5-06-02: Depth cap to prevent infinite loops on malformed data.
    // Our shape tops out at 4 levels; 16 is generous.
    const MAX_DEPTH = 16;
    let depth = 0;
    type Step = { parent: Y.AbstractType<unknown>; child: Y.AbstractType<unknown> };
    const stack: Step[] = [];
    let current: Y.AbstractType<unknown> = yType;

    while (current.parent && current !== docYmap) {
        if (depth > MAX_DEPTH) {
            console.warn("[collab] findOwningAnnotationId exceeded MAX_DEPTH; aborting walk");
            return null;
        }
        stack.push({ parent: current.parent as Y.AbstractType<unknown>, child: current });
        current = current.parent as Y.AbstractType<unknown>;
        depth += 1;
    }
    if (current !== docYmap) return null;

    // Top step: parent is docYmap, child is the annotation node's Y.Map.
    const topStep = stack[stack.length - 1];
    if (!topStep) return null;

    // Scan docYmap entries for a value === child.
    let annotationYjsId: string | null = null;
    docYmap.forEach((value, key) => {
        if (value === topStep.child) annotationYjsId = key;
    });
    if (!annotationYjsId) return null;

    const cmId = mainIdMap.getCmId(annotationYjsId);
    if (cmId === undefined) return null;

    // Optional: detect a version index by scanning for a step whose parent
    // is the annotation node's `versions` Y.Map.
    const annotationNode = docYmap.get(annotationYjsId) as Y.Map<unknown> | undefined;
    const versionsMap = annotationNode?.get("versions");
    let versionIndex: number | undefined;
    if (versionsMap instanceof Y.Map) {
        for (const step of stack) {
            if (step.parent === versionsMap) {
                // step.child is a version Y.Map; find which key it's under.
                versionsMap.forEach((value, key) => {
                    if (value === step.child) versionIndex = Number(key);
                });
                break;
            }
        }
    }

    return { cmId, versionIndex };
}
