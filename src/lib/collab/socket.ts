/**
 * socket.ts -- WebSocket client for collab relay.
 *
 * Module-level singleton. Created on demand when collab is enabled,
 * destroyed when collab is disabled. Uses raw WebSocket (relay uses ws,
 * not socket.io).
 *
 * Per D-52: Per-document socket instance -- socket lifecycle tied to collab session.
 * Per D-53: JWT from getSession().access_token passed in URL query param.
 */
import { getSession } from "$lib/auth/auth.svelte";
import { PUBLIC_RELAY_URL } from "$env/static/public";

const RELAY_URL = PUBLIC_RELAY_URL;

/** True if PUBLIC_RELAY_URL is configured */
export const relayConfigured = !!RELAY_URL;

if (!relayConfigured) {
    console.warn("[collab] Missing PUBLIC_RELAY_URL -- collab features will not work");
}

let socket: WebSocket | null = null;
let currentDocId: string | null = null;

/**
 * Connect to the relay for a specific document.
 * Per D-53: JWT passed in query param (relay expects ?token=...).
 */
export function connectToCollab(docId: string): WebSocket {
    if (socket && currentDocId === docId) {
        console.warn("[collab] Socket already connected to", docId);
        return socket;
    }

    // Close existing connection if switching documents
    if (socket) {
        disconnectCollab();
    }

    const session = getSession();
    if (!session?.access_token) {
        throw new Error("Not authenticated");
    }

    // Relay URL pattern: /doc/:docId?token=...
    const url = `${RELAY_URL}/doc/${docId}?token=${session.access_token}`;
    socket = new WebSocket(url);
    currentDocId = docId;

    socket.onopen = () => {
        console.log("[collab] Connected to relay");
    };

    socket.onerror = (error) => {
        console.error("[collab] Socket error:", error);
    };

    socket.onclose = () => {
        console.log("[collab] Disconnected from relay");
        socket = null;
        currentDocId = null;
    };

    return socket;
}

/**
 * Disconnect from the relay.
 */
export function disconnectCollab(): void {
    if (socket) {
        socket.close();
        socket = null;
        currentDocId = null;
    }
}

/**
 * Get the current socket (or null if not connected).
 */
export function getSocket(): WebSocket | null {
    return socket;
}

/**
 * Get the document ID of the current socket connection.
 */
export function getCurrentDocId(): string | null {
    return currentDocId;
}
