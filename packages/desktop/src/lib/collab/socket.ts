import { getSession } from "$lib/auth/auth.svelte";
/**
 * socket.ts -- Socket.io client for collab relay.
 *
 * Module-level singleton. Created on demand when collab is enabled,
 * destroyed when collab is disabled. Uses Socket.io to match relay server.
 *
 * Per D-52: Per-document socket instance -- socket lifecycle tied to collab session.
 * Per D-53: JWT from getSession().access_token passed in auth handshake.
 */
import { type Socket, io } from "socket.io-client";
import { collabState } from "./store";

const RELAY_URL = import.meta.env.PUBLIC_RELAY_URL;

/** True if PUBLIC_RELAY_URL is configured */
export const relayConfigured = !!RELAY_URL;

if (!relayConfigured) {
    console.warn("[collab] Missing PUBLIC_RELAY_URL -- collab features will not work");
}

let socket: Socket | null = null;
let currentDocId: string | null = null;

/** Initial state received from relay on connect */
export type InitialState = {
    version: number;
    doc: string;
};

/**
 * Connect to the relay for a specific document.
 * Per D-53: JWT passed in auth handshake.
 * Returns a Promise that resolves with { socket, initialState } on successful connection,
 * or rejects if connection fails.
 */
export async function connectToCollab(
    docId: string,
): Promise<{ socket: Socket; initialState: InitialState }> {
    if (socket && currentDocId === docId && socket.connected) {
        console.warn("[collab] Socket already connected to", docId);
        // Return existing socket but we don't have initialState cached
        // This shouldn't happen in normal flow
        return { socket, initialState: { version: 0, doc: "" } };
    }

    // Close existing connection if switching documents
    if (socket) {
        disconnectCollab();
    }

    const session = getSession();
    if (!session?.access_token) {
        throw new Error("Not authenticated");
    }

    if (!RELAY_URL) {
        throw new Error("Relay not configured");
    }

    collabState.set("connecting");

    // Create Socket.io connection with auth
    const newSocket = io(RELAY_URL, {
        auth: {
            token: session.access_token,
            documentId: docId,
        },
        // Don't auto-reconnect for now (Phase 7 will add reconnection UX)
        reconnection: false,
    });

    return new Promise((resolve, reject) => {
        // Handle successful connection and initial state
        newSocket.on("init", (data: InitialState) => {
            console.log("[collab] Connected to relay, version:", data.version);
            socket = newSocket;
            currentDocId = docId;
            collabState.set("connected");
            resolve({ socket: newSocket, initialState: data });
        });

        newSocket.on("connect_error", (error) => {
            console.error("[collab] Connection error:", error.message);
            newSocket.close();
            collabState.set("error");
            reject(new Error(`Failed to connect to relay: ${error.message}`));
        });

        newSocket.on("disconnect", (reason) => {
            console.log("[collab] Disconnected from relay:", reason);
            if (socket === newSocket) {
                socket = null;
                currentDocId = null;
                collabState.set("disconnected");
            }
        });
    });
}

/**
 * Disconnect from the relay.
 */
export function disconnectCollab(): void {
    if (socket) {
        socket.disconnect();
        socket = null;
        currentDocId = null;
    }
    collabState.set("disconnected");
}

/**
 * Get the current socket (or null if not connected).
 */
export function getSocket(): Socket | null {
    return socket;
}

/**
 * Get the document ID of the current socket connection.
 */
export function getCurrentDocId(): string | null {
    return currentDocId;
}
