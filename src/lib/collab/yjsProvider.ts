/**
 * yjsProvider.ts -- WebsocketProvider wrapper with Quillium auth.
 *
 * Per D-71: Connects to y-websocket-server with JWT auth in params.
 * Per D-57: Handles owner disconnect by destroying provider.
 * Per D-61: No warning before kick on owner disconnect.
 *
 * Connection lifecycle:
 * 1. createYjsProvider() creates Y.Doc, WebsocketProvider, returns awareness
 * 2. Provider connects with JWT in params
 * 3. Owner disconnect message triggers ownerLeftSignal and provider destroy
 * 4. disconnectYjsProvider() cleans up
 *
 * Key dependencies:
 *   - yjs for Y.Doc and Y.Text
 *   - y-websocket for WebsocketProvider
 *   - y-protocols/awareness for Awareness type
 *
 * Interactions:
 *   - Bridges y-websocket provider to Svelte stores
 *   - yjsBinding.ts uses returned ytext for CodeMirror sync
 *   - awareness.ts uses returned awareness for cursor sync
 *   - yjsUndo.ts uses returned ytext for UndoManager
 */
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";
import { getSession } from "$lib/auth/auth.svelte";
import { PUBLIC_RELAY_URL } from "$env/static/public";
import { collabState, ownerLeftSignal, reconnectAttempt } from "./store";

/** True if PUBLIC_RELAY_URL is configured */
export const relayConfigured = !!PUBLIC_RELAY_URL;

if (!relayConfigured) {
    console.warn("[yjsProvider] Missing PUBLIC_RELAY_URL -- collab features will not work");
}

// ── Module-level state for current connection ───────────────────────────────

let currentProvider: WebsocketProvider | null = null;
let currentYdoc: Y.Doc | null = null;
let currentDocId: string | null = null;

// ── Types ───────────────────────────────────────────────────────────────────

export interface YjsProviderResult {
    provider: WebsocketProvider;
    awareness: Awareness;
    ydoc: Y.Doc;
    ytext: Y.Text;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Connect to Yjs relay server.
 *
 * @param docId - Document ID (becomes room name)
 * @returns Provider, awareness, ydoc, and ytext instances
 * @throws If not authenticated or relay not configured
 */
export async function createYjsProvider(docId: string): Promise<YjsProviderResult> {
    // Cleanup existing connection if any
    if (currentProvider) {
        disconnectYjsProvider();
    }

    const session = getSession();
    if (!session?.access_token) {
        throw new Error("Not authenticated");
    }

    if (!relayConfigured) {
        throw new Error("Relay not configured");
    }

    // Set state to connecting immediately
    collabState.set("connecting");

    // Create Y.Doc and get text shared type
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");

    // Create WebsocketProvider with JWT auth in params (per D-71)
    const provider = new WebsocketProvider(PUBLIC_RELAY_URL, docId, ydoc, {
        params: {
            auth: session.access_token,
        },
        connect: true,
    });

    // Track connection state via provider events
    provider.on("status", ({ status }: { status: string }) => {
        console.log(`[yjsProvider] Status: ${status}`);
        if (status === "connecting") {
            collabState.set("connecting");
        } else if (status === "connected") {
            // Wait for sync before setting connected -- sync event is more reliable
        } else if (status === "disconnected") {
            // Only update state if this provider is still current
            if (currentProvider === provider) {
                collabState.set("reconnecting");
            }
        }
    });

    // Sync event indicates successful initial sync with server
    provider.on("sync", (isSynced: boolean) => {
        console.log(`[yjsProvider] Sync: ${isSynced}`);
        if (isSynced && currentProvider === provider) {
            collabState.set("connected");
            reconnectAttempt.set(0);
        }
    });

    // Handle connection close (may include owner disconnect kick)
    // The server sends close reason when owner leaves (D-57, D-61)
    provider.on("connection-close" as any, (event: any) => {
        console.log("[yjsProvider] Connection closed:", event);
    });

    // Store references for current connection
    currentProvider = provider;
    currentYdoc = ydoc;
    currentDocId = docId;

    return {
        provider,
        awareness: provider.awareness,
        ydoc,
        ytext,
    };
}

/**
 * Disconnect from Yjs relay and cleanup.
 */
export function disconnectYjsProvider(): void {
    if (currentProvider) {
        currentProvider.destroy();
        currentProvider = null;
    }
    if (currentYdoc) {
        currentYdoc.destroy();
        currentYdoc = null;
    }
    currentDocId = null;
    collabState.set("disconnected");
    reconnectAttempt.set(0);
}

/**
 * Get current provider (or null if not connected).
 */
export function getYjsProvider(): WebsocketProvider | null {
    return currentProvider;
}

/**
 * Get current document ID.
 */
export function getCurrentDocId(): string | null {
    return currentDocId;
}

/**
 * Get current Y.Doc (or null if not connected).
 */
export function getYDoc(): Y.Doc | null {
    return currentYdoc;
}

/**
 * Trigger owner left signal (called by server message handler).
 * Per D-61: Immediately disconnect without warning.
 */
export function handleOwnerLeft(): void {
    console.log("[yjsProvider] Owner left, disconnecting");
    ownerLeftSignal.update((n) => n + 1);
    disconnectYjsProvider();
}
