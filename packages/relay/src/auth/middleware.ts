import { HandshakeAuthSchema } from "@quillium/share/collab-contract";
import { LiveRoomAccessService } from "../access/index.js";
import { createLogger } from "../logger.js";
import { getYjsRoom } from "../yjs/rooms.js";
import type { YjsClientData } from "../yjs/types.js";
/**
 * middleware.ts -- JWT validation for WebSocket upgrade.
 *
 * Per D-71: Auth in WebSocket upgrade handler (not Socket.io middleware).
 * Validates JWT and document permissions.
 */
import { supabase, supabaseConfigured } from "./supabase.js";

const logger = createLogger("auth");

/**
 * Extended socket data with user info.
 * @deprecated Use YjsClientData for native WebSocket
 */
export interface AuthenticatedSocketData {
    userId: string;
    documentId: string;
    isAnonymous: boolean;
    isOwner: boolean;
}

/**
 * Authentication result for WebSocket upgrade.
 */
export interface AuthResult {
    success: boolean;
    data?: YjsClientData;
    error?: string;
}

/**
 * Validate JWT and document permissions for WebSocket upgrade.
 *
 * @param token - JWT access token
 * @param documentId - Document ID being accessed
 */
export async function authenticateWebSocket(
    token: string | null,
    documentId: string,
    invitation?: string | null,
): Promise<AuthResult> {
    if (!token) {
        return { success: false, error: "Missing auth token" };
    }

    if (!documentId) {
        return { success: false, error: "Missing document ID" };
    }

    if (!HandshakeAuthSchema.safeParse({ token, documentId }).success) {
        return { success: false, error: "Invalid handshake" };
    }

    if (!supabaseConfigured || !supabase) {
        logger.error("Supabase not configured");
        return { success: false, error: "Server misconfigured" };
    }

    try {
        // Verify JWT with Supabase
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser(token);

        if (authError || !user) {
            return { success: false, error: "Invalid token" };
        }

        // Check document access. This uses the service_role client, so the relay
        // must enforce the same ownership boundary that Postgres RLS enforces
        // for browser/desktop clients.
        const { data: doc, error: docError } = await supabase
            .from("sync_documents")
            .select("owner_id")
            .eq("id", documentId)
            .maybeSingle();

        if (docError) {
            return { success: false, error: "Database error" };
        }

        if (!doc) {
            return { success: false, error: "Permission denied" };
        }

        const isOwner = doc?.owner_id === user.id;
        const isAnonymous = user.is_anonymous ?? false;
        const name = user.user_metadata?.display_name;
        const displayName =
            typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : undefined;

        let grant:
            | { grantId: string; role: "viewer" | "commenter" | "editor"; expiresAt: string }
            | undefined;
        if (!isOwner) {
            if (!invitation) return { success: false, error: "Invitation required" };
            grant = await new LiveRoomAccessService({ supabase, onGrantChanged: () => {} }).resolve(
                invitation,
                user,
                documentId,
            );
            const room = getYjsRoom(documentId);
            const ownerIsLive = room?.isOwnerConnected === true && room.ownerId === doc.owner_id;

            if (!ownerIsLive) {
                return { success: false, error: "Permission denied" };
            }
        }

        return {
            success: true,
            data: {
                userId: user.id,
                documentId,
                isOwner,
                isAnonymous,
                ...(displayName ? { displayName } : {}),
                role: grant?.role ?? "editor",
                ...(grant ? { grantId: grant.grantId, expiresAt: grant.expiresAt } : {}),
            },
        };
    } catch (e) {
        logger.error("Error:", e);
        return { success: false, error: "Auth error" };
    }
}

// NOTE: Socket.io authMiddleware removed as part of Yjs migration (D-70)
// Use authenticateWebSocket() for native WebSocket connections
