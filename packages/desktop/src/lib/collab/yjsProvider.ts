import { getSession } from "$lib/auth/auth.svelte";
import type { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
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
import { collabState, ownerLeftSignal, reconnectAttempt } from "./store";
import type { YjsAnnotationNode } from "./types";

function getRelayUrl(): string | undefined {
    return import.meta.env.PUBLIC_RELAY_URL;
}

/** True if PUBLIC_RELAY_URL is configured */
export const relayConfigured = !!getRelayUrl();

if (!relayConfigured) {
    console.warn("[yjsProvider] Missing PUBLIC_RELAY_URL -- collab features will not work");
}

// ── Module-level state for current connection ───────────────────────────────

let currentProvider: WebsocketProvider | null = null;
let currentYdoc: Y.Doc | null = null;
let currentDocId: string | null = null;

// ── Reconnection tracking ───────────────────────────────────────────────────

export const MAX_RECONNECT_ATTEMPTS = 5;
let currentAttemptCount = 0;

// ── Types ───────────────────────────────────────────────────────────────────

export interface YjsProviderResult {
    provider: WebsocketProvider;
    awareness: Awareness;
    ydoc: Y.Doc;
    ytext: Y.Text;
    ymap: Y.Map<YjsAnnotationNode>;
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

    const relayUrl = getRelayUrl();
    if (!relayUrl) {
        throw new Error("Relay not configured");
    }

    // Set state to connecting immediately
    collabState.set("connecting");

    // Create Y.Doc and get text shared type
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

    // Create WebsocketProvider with JWT auth in params (per D-71)
    const provider = new WebsocketProvider(relayUrl, docId, ydoc, {
        params: {
            auth: session.access_token,
        },
        connect: true,
        maxBackoffTime: 5000, // 5 seconds max between retries (default is 2.5s)
    });

    // Track connection state via provider events
    provider.on("status", ({ status }: { status: string }) => {
        console.log(`[yjsProvider] Status: ${status}`);
        if (status === "connecting") {
            // Only set "connecting" on initial connection, not during reconnection
            if (currentAttemptCount === 0) {
                collabState.set("connecting");
            }
            // During reconnection, keep "reconnecting" state (set by connection-close handler)
        } else if (status === "connected") {
            // Wait for sync before setting connected -- sync event is more reliable
        } else if (status === "disconnected") {
            // First disconnect only - subsequent failures go through connection-close
            if (currentProvider === provider && currentAttemptCount === 0) {
                currentAttemptCount = 1;
                reconnectAttempt.set(1);
                collabState.set("reconnecting");
            }
        }
    });

    // Sync event indicates successful initial sync with server
    provider.on("sync", (isSynced: boolean) => {
        console.log(`[yjsProvider] Sync: ${isSynced}`);
        if (isSynced && currentProvider === provider) {
            collabState.set("connected");
            currentAttemptCount = 0;
            reconnectAttempt.set(0);
        }
    });

    // Handle connection close - fires on EVERY close including failed retry attempts
    // y-websocket only emits "disconnected" status on first disconnect, but connection-close
    // fires each time, so we track retry attempts here
    const providerWithConnectionClose = provider as unknown as {
        on(event: "connection-close", handler: (event: unknown) => void): void;
    };
    providerWithConnectionClose.on("connection-close", () => {
        console.log(`[yjsProvider] Connection closed (attempt ${currentAttemptCount})`);
        if (currentProvider === provider && currentAttemptCount > 0) {
            // Already in reconnection mode, increment attempt
            currentAttemptCount += 1;
            reconnectAttempt.set(currentAttemptCount);

            if (currentAttemptCount >= MAX_RECONNECT_ATTEMPTS) {
                // Per D-104: Exhausted retries, set error state
                collabState.set("error");
                // Per D-105: Stop reconnection - user must manually Go Live again
                // Use setTimeout to avoid calling disconnect inside close handler (stack overflow)
                setTimeout(() => provider.disconnect(), 0);
            }
        }
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
        ymap,
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
    currentAttemptCount = 0;
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
